import { newOpId, type Store } from '../store';
import type { Ctx, Outcome, Plan } from '../types';

/**
 * Applies a plan — only if it is ready, has something to write, and `apply` is true.
 * Everything else is a dry run that touches nothing.
 */
export async function execute<D>(
  store: Store,
  plan: Plan<D>,
  ctx: Ctx,
  apply: boolean,
  extra: { markReverted?: string[] } = {},
): Promise<Outcome<D> & { dataRevision?: number }> {
  if (!apply || !plan.ok || plan.ops.length === 0) return { plan, applied: false };
  const opId = newOpId();
  const { dataRevision } = await store.commit({
    opId,
    actor: ctx.actor,
    command: plan.command,
    ...(plan.instruction ? { instruction: plan.instruction } : {}),
    ops: plan.ops,
    now: ctx.now,
    ...(extra.markReverted?.length ? { markReverted: { entryIds: extra.markReverted } } : {}),
  });
  return { plan, applied: true, opId, dataRevision };
}
