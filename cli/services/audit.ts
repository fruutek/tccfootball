import { SITE_SETTINGS_ID } from '../../src/shared/schema';
import type { AuditRecord, Snapshot } from '../store';
import type { Ctx, Doc, DocCollection, Plan } from '../types';
import { err, newPlan, op, seal } from './common';

export interface RevertDetails {
  opId: string;
  entryIds: string[];
  reverted: string[];
}

const IGNORED_SETTINGS_KEYS = new Set(['dataRevision', 'updatedAt']);

function currentDoc(snap: Snapshot, collection: DocCollection, id: string): Doc | null {
  if (collection === 'settings') return (snap.settings as unknown as Doc) ?? null;
  const list = { players: snap.players, matches: snap.matches, articles: snap.articles }[collection] as unknown as (Doc & { id: string })[];
  return list.find((d) => d.id === id) ?? null;
}

/**
 * Builds the inverse of every change made by one earlier operation.
 * Refuses if a later change touched the same document, unless forced.
 */
export function planRevert(
  snap: Snapshot,
  entries: AuditRecord[],
  opId: string,
  ctx: Ctx,
  opts: { force?: boolean } = {},
): Plan<RevertDetails> {
  const plan = newPlan<RevertDetails>('revert', { opId, entryIds: [], reverted: [] });
  const live = entries.filter((e) => !e.revertedBy);
  if (entries.length === 0) {
    plan.errors.push(err('OP_NOT_FOUND', `No audit entries found for operation "${opId}". Run "audit" to list recent operations.`));
    return seal(plan);
  }
  if (live.length === 0) {
    plan.errors.push(err('ALREADY_REVERTED', `Operation ${opId} has already been reverted.`));
    return seal(plan);
  }
  const now = ctx.now.toISOString();

  // Undo in reverse order of the original writes.
  for (const e of [...live].reverse()) {
    const cur = currentDoc(snap, e.collection, e.docId);
    const where = `${e.collection}/${e.docId}`;

    if (e.collection === 'settings') {
      if (!cur) continue;
      const before = (e.before ?? {}) as Doc;
      const after = (e.after ?? {}) as Doc;
      const next: Doc = { ...cur };
      let touched = false;
      for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (IGNORED_SETTINGS_KEYS.has(k)) continue;
        if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
          if (!opts.force && JSON.stringify(cur[k]) !== JSON.stringify(after[k])) {
            plan.errors.push(err('CHANGED_SINCE', `${where}.${k} has changed since that operation. Use --force to overwrite it.`));
          }
          next[k] = before[k];
          touched = true;
        }
      }
      if (touched) {
        next['updatedAt'] = now;
        plan.ops.push(op('settings', SITE_SETTINGS_ID, 'update', cur, next, `Reverted settings change from ${e.opId}`));
        plan.details.reverted.push(`restored settings (${e.summary})`);
        plan.details.entryIds.push(e.id);
      }
      continue;
    }

    const stale = (expectedRevision: unknown) =>
      !opts.force && cur !== null && cur['revision'] !== expectedRevision;

    if (e.action === 'create') {
      if (!cur) {
        plan.errors.push(err('CHANGED_SINCE', `${where} no longer exists, so its creation cannot be reverted.`));
        continue;
      }
      if (stale(e.after?.['revision'])) {
        plan.errors.push(err('CHANGED_SINCE', `${where} was edited after it was created (revision ${String(cur['revision'])}). Use --force to delete it anyway, or revert the later operation first.`));
        continue;
      }
      plan.ops.push(op(e.collection, e.docId, 'delete', cur, null, `Reverted: removed ${where}`));
      plan.details.reverted.push(`removed ${where}`);
    } else if (e.action === 'update') {
      if (!cur) {
        plan.errors.push(err('CHANGED_SINCE', `${where} no longer exists.`));
        continue;
      }
      if (stale(e.after?.['revision'])) {
        plan.errors.push(err('CHANGED_SINCE', `${where} was changed again after that operation (revision ${String(cur['revision'])}). Revert the later operation first, or use --force.`));
        continue;
      }
      const restored: Doc = { ...(e.before as Doc), revision: Number(cur['revision']) + 1, updatedAt: now };
      plan.ops.push(op(e.collection, e.docId, 'update', cur, restored, `Reverted: restored ${where}`));
      plan.details.reverted.push(`restored ${where}`);
    } else {
      if (cur) {
        plan.errors.push(err('CHANGED_SINCE', `${where} exists again, so the deletion cannot be undone automatically.`));
        continue;
      }
      const restored: Doc = { ...(e.before as Doc), revision: Number((e.before as Doc)['revision']) + 1, updatedAt: now };
      plan.ops.push(op(e.collection, e.docId, 'create', null, restored, `Reverted: recreated ${where}`));
      plan.details.reverted.push(`recreated ${where}`);
    }
    plan.details.entryIds.push(e.id);
  }
  plan.summary = `Revert operation ${opId} (${live[0]!.command}): ${plan.details.reverted.join(', ') || 'nothing to do'}`;
  return seal(plan);
}
