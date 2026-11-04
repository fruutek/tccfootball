/**
 * Connects the CLI to Firestore with the Admin SDK.
 *
 * Credential discovery, in order:
 *   1. FIRESTORE_EMULATOR_HOST set  → local emulator, no credentials needed.
 *   2. MNF_SERVICE_ACCOUNT_JSON     → service-account JSON (raw or base64), for
 *                                      cloud sessions where it is stored as a secret.
 *   3. GOOGLE_APPLICATION_CREDENTIALS / gcloud Application Default Credentials
 *                                   → a key file path, or `gcloud auth application-default login`
 *                                      (optionally impersonating the least-privilege publisher account).
 * No credential is ever read from, or written to, the repository.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  SITE_SETTINGS_ID,
  type Article,
  type Match,
  type Player,
  type SiteSettings,
} from '../src/shared/schema';
import {
  checkPrecondition,
  diffFields,
  freshSettings,
  nextRevision,
  type AuditRecord,
  type CommitInput,
  type Snapshot,
  type Store,
} from './store';
import type { Doc } from './types';

export interface Connection {
  store: Store;
  db: Firestore;
  projectId: string;
  emulator: boolean;
}

function projectFromFirebaserc(): string | undefined {
  try {
    const rc = JSON.parse(readFileSync(resolve(process.cwd(), '.firebaserc'), 'utf8')) as { projects?: { default?: string } };
    return rc.projects?.default;
  } catch {
    return undefined;
  }
}

function parseServiceAccount(raw: string): Record<string, unknown> {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(text) as Record<string, unknown>;
}

export class SetupError extends Error {
  override name = 'SetupError';
}

export function connect(opts: { project?: string } = {}): Connection {
  const emulatorHost = process.env['FIRESTORE_EMULATOR_HOST'];
  const emulator = Boolean(emulatorHost);
  const projectId =
    opts.project ??
    process.env['MNF_PROJECT'] ??
    process.env['GCLOUD_PROJECT'] ??
    process.env['GOOGLE_CLOUD_PROJECT'] ??
    (emulator ? 'demo-mnf' : projectFromFirebaserc());
  if (!projectId) throw new SetupError('No Firebase project id. Pass --project, set MNF_PROJECT, or run `npm run setup:firebase`.');

  if (!getApps().length) {
    if (emulator) {
      // No credentials are needed for the emulator; don't let the auth library probe for a cloud metadata server.
      process.env['METADATA_SERVER_DETECTION'] ??= 'none';
      initializeApp({ projectId });
    } else if (process.env['MNF_SERVICE_ACCOUNT_JSON']) {
      let sa: Record<string, unknown>;
      try {
        sa = parseServiceAccount(process.env['MNF_SERVICE_ACCOUNT_JSON']);
      } catch {
        throw new SetupError('MNF_SERVICE_ACCOUNT_JSON is set but is not valid JSON (or base64-encoded JSON).');
      }
      initializeApp({ credential: cert(sa as never), projectId });
    } else {
      initializeApp({ credential: applicationDefault(), projectId });
    }
  }
  const db = getFirestore();
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    /* already configured in this process */
  }
  const label = emulator ? `EMULATOR ${emulatorHost} (project ${projectId})` : `PRODUCTION project ${projectId}`;
  return { store: new FirestoreStore(db, label), db, projectId, emulator };
}

export class FirestoreStore implements Store {
  constructor(
    private readonly db: Firestore,
    readonly label: string,
  ) {}

  async load(): Promise<Snapshot> {
    const [players, matches, articles, settings] = await Promise.all([
      this.db.collection(COLLECTIONS.players).get(),
      this.db.collection(COLLECTIONS.matches).get(),
      this.db.collection(COLLECTIONS.articles).get(),
      this.db.collection(COLLECTIONS.settings).doc(SITE_SETTINGS_ID).get(),
    ]);
    return {
      players: players.docs.map((d) => d.data() as Player),
      matches: matches.docs.map((d) => d.data() as Match),
      articles: articles.docs.map((d) => d.data() as Article),
      settings: settings.exists ? (settings.data() as SiteSettings) : null,
    };
  }

  async commit(input: CommitInput): Promise<{ dataRevision: number }> {
    const { db } = this;
    const settingsRef = db.collection(COLLECTIONS.settings).doc(SITE_SETTINGS_ID);
    return db.runTransaction(async (tx) => {
      // --- all reads first (Firestore requirement) ---
      const refs = input.ops.map((op) => db.collection(op.collection).doc(op.id));
      const snaps = await Promise.all(refs.map((r) => tx.get(r)));
      const settingsSnap = refs.some((r) => r.path === settingsRef.path)
        ? snaps[refs.findIndex((r) => r.path === settingsRef.path)]!
        : await tx.get(settingsRef);
      const revertedRefs = (input.markReverted?.entryIds ?? []).map((id) => db.collection(COLLECTIONS.audit).doc(id));

      // --- preconditions: refuse to clobber anything that changed since the plan ---
      input.ops.forEach((op, i) => checkPrecondition(op, snaps[i]!.exists ? (snaps[i]!.data() as Doc) : null));

      // --- writes ---
      input.ops.forEach((op, i) => {
        const ref = refs[i]!;
        if (op.action === 'delete') tx.delete(ref);
        else if (op.collection === 'settings') tx.set(ref, diffFields(op.before, op.after!), { merge: true });
        else tx.set(ref, op.after!);
        tx.set(db.collection(COLLECTIONS.audit).doc(), {
          opId: input.opId,
          at: input.now.toISOString(),
          actor: input.actor,
          command: input.command,
          summary: op.summary,
          collection: op.collection,
          docId: op.id,
          action: op.action,
          before: op.before,
          after: op.after,
          ...(input.instruction ? { instruction: input.instruction } : {}),
        });
      });
      for (const r of revertedRefs) tx.update(r, { revertedBy: input.opId });

      // --- tell browsers their cached copy is stale ---
      const current = (settingsSnap.exists ? settingsSnap.data() : freshSettings(input.now)) as SiteSettings;
      const dataRevision = nextRevision(current.dataRevision, input.now);
      const bump = { dataRevision, updatedAt: input.now.toISOString() };
      const settingsOp = input.ops.find((o) => o.collection === 'settings');
      if (settingsOp) tx.set(settingsRef, bump, { merge: true });
      else if (settingsSnap.exists) tx.update(settingsRef, bump);
      else tx.set(settingsRef, { ...freshSettings(input.now), ...bump });
      return { dataRevision };
    });
  }

  async listAudit(opts: { opId?: string; limit?: number } = {}): Promise<AuditRecord[]> {
    let q = this.db.collection(COLLECTIONS.audit) as FirebaseFirestore.Query;
    if (opts.opId) q = q.where('opId', '==', opts.opId);
    else q = q.orderBy('at', 'desc').limit(opts.limit ?? 50);
    const snap = await q.get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as AuditRecord);
    return rows.sort((x, y) => (x.at < y.at ? 1 : -1));
  }
}

export { FieldValue };
