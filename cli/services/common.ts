import { createHash } from 'node:crypto';
import type { MatchContent } from '../../src/shared/events';
import { participantIds } from '../../src/shared/events';
import { canonicalContent } from '../../src/shared/fingerprint';
import { computeStats, startingTotalsOf, statsFor } from '../../src/shared/stats';
import type { Match, Player, SiteSettings } from '../../src/shared/schema';
import type { Issue } from '../../src/shared/validate';
import type { Clarification, Ctx, Doc, Plan, PlannedOp } from '../types';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const fingerprintOf = (m: MatchContent) => sha256(canonicalContent(m, { includeDate: true }));
export const contentKeyWithoutDate = (m: MatchContent) => canonicalContent(m, { includeDate: false });

export function newPlan<D>(command: string, details: D, instruction?: string): Plan<D> {
  return {
    command,
    ok: false,
    status: 'invalid',
    summary: '',
    errors: [],
    warnings: [],
    clarifications: [],
    ops: [],
    details,
    ...(instruction ? { instruction } : {}),
  };
}

/** Sets ok/status from the accumulated errors and clarifications. Drops ops if not ok. */
export function seal<D>(plan: Plan<D>): Plan<D> {
  if (plan.clarifications.length) plan.status = 'needs-clarification';
  else if (plan.errors.length) plan.status = 'invalid';
  else plan.status = 'ready';
  plan.ok = plan.status === 'ready';
  if (!plan.ok) plan.ops = [];
  return plan;
}

export const err = (code: string, message: string): Issue => ({ level: 'error', code, message });
export const warn = (code: string, message: string): Issue => ({ level: 'warning', code, message });

export function op(
  collection: PlannedOp['collection'],
  id: string,
  action: PlannedOp['action'],
  before: unknown,
  after: unknown,
  summary: string,
): PlannedOp {
  return { collection, id, action, before: (before as Doc | null) ?? null, after: (after as Doc | null) ?? null, summary };
}

export const nameLookup = (players: readonly Player[]) => (id: string) =>
  players.find((p) => p.id === id)?.displayName ?? id;

export function describeMatch(m: Pick<Match, 'date' | 'teams' | 'score'>): string {
  return `${m.teams.a.name} ${m.score.a}–${m.score.b} ${m.teams.b.name} (${m.date})`;
}

/* ----------------------------------------------------------- stat deltas */

export interface StatLine {
  appearances: number;
  goals: number;
  assists: number;
  wins: number;
  draws: number;
  losses: number;
  potm: number;
}
export interface StatChange {
  playerId: string;
  name: string;
  before: StatLine;
  after: StatLine;
  changed: (keyof StatLine)[];
}

const KEYS: (keyof StatLine)[] = ['appearances', 'goals', 'assists', 'wins', 'draws', 'losses', 'potm'];
const line = (s: ReturnType<typeof statsFor>): StatLine => ({
  appearances: s.totalAppearances,
  goals: s.goals,
  assists: s.assists,
  wins: s.wins,
  draws: s.draws,
  losses: s.losses,
  potm: s.potm,
});

/** All-time stat differences between two sets of matches — "what did this change?" */
export function statChanges(
  before: readonly Match[],
  after: readonly Match[],
  players: readonly Player[],
): StatChange[] {
  const startingTotals = startingTotalsOf(players);
  const b = computeStats(before, { startingTotals });
  const a = computeStats(after, { startingTotals });
  const ids = new Set([...b.keys(), ...a.keys()]);
  const nameOf = nameLookup(players);
  const out: StatChange[] = [];
  for (const id of ids) {
    const x = line(statsFor(b, id));
    const y = line(statsFor(a, id));
    const changed = KEYS.filter((k) => x[k] !== y[k]);
    if (changed.length) out.push({ playerId: id, name: nameOf(id), before: x, after: y, changed });
  }
  return out.sort((p, q) => p.name.localeCompare(q.name));
}

export function formatStatChange(c: StatChange): string {
  const parts = c.changed.map((k) => `${k} ${c.before[k]}→${c.after[k]}`);
  return `${c.name}: ${parts.join(', ')}`;
}

export function settingsOrDefault(s: SiteSettings | null) {
  return { seasonStartMonth: s?.seasonStartMonth ?? 1, minAppearances: s?.minAppearances ?? 5, formLength: s?.formLength ?? 5, byline: s?.byline ?? 'MNF Match Desk' };
}

export const participants = (m: MatchContent) => participantIds(m);

export type { Clarification, Ctx };
