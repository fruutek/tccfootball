import { randomUUID } from 'node:crypto';
import {
  COLLECTIONS,
  DEFAULT_SETTINGS,
  SITE_SETTINGS_ID,
  type Article,
  type AuditEntry,
  type Match,
  type Player,
  type SiteSettings,
} from '../src/shared/schema';
import type { Doc, DocCollection, PlannedOp } from './types';

export interface Snapshot {
  players: Player[];
  matches: Match[];
  articles: Article[];
  settings: SiteSettings | null;
}

export interface CommitInput {
  opId: string;
  actor: string;
  command: string;
  instruction?: string;
  ops: PlannedOp[];
  now: Date;
  /** Marks audit entries as undone by this operation (used by `revert`). */
  markReverted?: { entryIds: string[] };
}

export type AuditRecord = AuditEntry & { id: string };

export class ConflictError extends Error {
  override name = 'ConflictError';
}

export interface Store {
  /** Human-readable description of the target, shown on every run. */
  readonly label: string;
  load(): Promise<Snapshot>;
  /** Applies all ops atomically (all or nothing), writing audit entries and bumping dataRevision. */
  commit(input: CommitInput): Promise<{ dataRevision: number }>;
  listAudit(opts?: { opId?: string; limit?: number }): Promise<AuditRecord[]>;
}

export const newOpId = () => `op_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}_${randomUUID().slice(0, 6)}`;

/** Fields of `after` that differ from `before` — used for field-level merges of the settings doc. */
export function diffFields(before: Doc | null, after: Doc): Doc {
  const out: Doc = {};
  for (const [k, v] of Object.entries(after)) {
    if (!before || JSON.stringify(before[k]) !== JSON.stringify(v)) out[k] = v;
  }
  return out;
}

export function freshSettings(now: Date): SiteSettings {
  return { ...DEFAULT_SETTINGS, dataRevision: 0, updatedAt: now.toISOString() };
}

export function nextRevision(prev: number | undefined, now: Date): number {
  return Math.max((prev ?? 0) + 1, now.getTime());
}

/** Shared precondition check so both stores behave identically. */
export function checkPrecondition(op: PlannedOp, current: Doc | undefined | null): void {
  const where = `${op.collection}/${op.id}`;
  if (op.action === 'create') {
    if (current) throw new ConflictError(`${where} already exists — refusing to overwrite it.`);
    return;
  }
  if (!current) throw new ConflictError(`${where} no longer exists — it was changed by someone else since this plan was made.`);
  if (op.collection !== 'settings' && op.before && current['revision'] !== op.before['revision']) {
    throw new ConflictError(
      `${where} was modified by someone else since this plan was made (revision ${String(op.before['revision'])} → ${String(current['revision'])}). Re-run the command.`,
    );
  }
}

/* ------------------------------------------------------------------ memory */

/** Faithful in-memory implementation, used by service tests and `--dry` experiments. */
export class MemoryStore implements Store {
  readonly label = 'in-memory store';
  data: Record<DocCollection, Map<string, Doc>> = {
    players: new Map(),
    matches: new Map(),
    articles: new Map(),
    settings: new Map(),
  };
  audit: AuditRecord[] = [];

  async load(): Promise<Snapshot> {
    const all = <T>(c: DocCollection) => [...this.data[c].values()].map((d) => structuredClone(d) as T);
    return {
      players: all<Player>('players'),
      matches: all<Match>('matches'),
      articles: all<Article>('articles'),
      settings: (structuredClone(this.data.settings.get(SITE_SETTINGS_ID)) as SiteSettings | undefined) ?? null,
    };
  }

  async commit(input: CommitInput): Promise<{ dataRevision: number }> {
    // Validate every precondition first so the commit is all-or-nothing.
    for (const op of input.ops) checkPrecondition(op, this.data[op.collection].get(op.id));

    for (const op of input.ops) {
      const bucket = this.data[op.collection];
      if (op.action === 'delete') bucket.delete(op.id);
      else if (op.collection === 'settings') {
        const cur = bucket.get(op.id) ?? (freshSettings(input.now) as unknown as Doc);
        bucket.set(op.id, { ...cur, ...diffFields(op.before, op.after!) });
      } else bucket.set(op.id, structuredClone(op.after!));
      this.audit.push({
        id: `a${this.audit.length + 1}`,
        opId: input.opId,
        at: input.now.toISOString(),
        actor: input.actor,
        command: input.command,
        summary: op.summary,
        collection: op.collection,
        docId: op.id,
        action: op.action,
        before: structuredClone(op.before),
        after: structuredClone(op.after),
        ...(input.instruction ? { instruction: input.instruction } : {}),
      } as AuditRecord);
    }
    for (const id of input.markReverted?.entryIds ?? []) {
      const e = this.audit.find((a) => a.id === id);
      if (e) e.revertedBy = input.opId;
    }
    const cur = (this.data.settings.get(SITE_SETTINGS_ID) ?? freshSettings(input.now)) as unknown as SiteSettings;
    const dataRevision = nextRevision(cur.dataRevision, input.now);
    this.data.settings.set(SITE_SETTINGS_ID, { ...cur, dataRevision, updatedAt: input.now.toISOString() } as unknown as Doc);
    return { dataRevision };
  }

  async listAudit(opts: { opId?: string; limit?: number } = {}): Promise<AuditRecord[]> {
    let rows = [...this.audit];
    if (opts.opId) rows = rows.filter((r) => r.opId === opts.opId);
    rows.reverse();
    return rows.slice(0, opts.limit ?? 50);
  }
}

export { COLLECTIONS };
