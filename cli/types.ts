import type { Issue } from '../src/shared/validate';

export type DocCollection = 'players' | 'matches' | 'articles' | 'settings';
export type Doc = Record<string, unknown>;

/** One document write, with enough information to reverse it. */
export interface PlannedOp {
  collection: DocCollection;
  id: string;
  action: 'create' | 'update' | 'delete';
  before: Doc | null;
  after: Doc | null;
  summary: string;
}

/** A question that must be put to the user before anything can be written. */
export interface Clarification {
  kind: 'ambiguous' | 'unknown';
  input: string;
  /** Where in the request the name appeared, e.g. "Red Team line-up". */
  where: string;
  candidates?: { playerId: string; displayName: string }[];
  suggestions?: { playerId: string; displayName: string }[];
  question: string;
}

export interface Plan<D = Record<string, unknown>> {
  command: string;
  /** True only when it is safe to apply. */
  ok: boolean;
  status: 'ready' | 'needs-clarification' | 'invalid';
  summary: string;
  errors: Issue[];
  warnings: Issue[];
  clarifications: Clarification[];
  ops: PlannedOp[];
  details: D;
  instruction?: string;
}

export interface Outcome<D = Record<string, unknown>> {
  plan: Plan<D>;
  applied: boolean;
  opId?: string;
}

export interface Ctx {
  now: Date;
  /** Today's date (YYYY-MM-DD) in the group's time zone. */
  today: string;
  actor: string;
}
