/**
 * The "spec" is what Claude writes after reading the user's plain-English
 * message: names, not ids. This module validates its shape and resolves it to
 * a match draft (ids), collecting anything that needs asking about instead of
 * guessing.
 */
import { z } from 'zod';
import { isValidDate } from '../src/shared/dates';
import { teamOfPlayer, type MatchContent } from '../src/shared/events';
import { normaliseName } from '../src/shared/ids';
import { resolveName, type Resolution } from '../src/shared/names';
import { colour, otherTeam, type MatchEvent, type Player, type TeamKey } from '../src/shared/schema';
import type { Issue } from '../src/shared/validate';
import type { Clarification } from './types';

const minute = z.number().int().min(0).max(130);
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use 24-hour HH:MM');

export const reportSpecSchema = z
  .object({
    title: z.string().trim().min(1).max(140),
    standfirst: z.string().trim().min(1).max(320),
    body: z.string().trim().min(1).max(20_000),
    slug: z.string().optional(),
    author: z.string().trim().min(1).max(60).optional(),
    featuredImage: z
      .object({ src: z.string(), alt: z.string(), credit: z.string().optional() })
      .strict()
      .optional(),
  })
  .strict();
export type ReportSpec = z.infer<typeof reportSpecSchema>;

const teamSpec = z
  .object({
    name: z.string().trim().min(1).max(30),
    colour: colour.optional(),
    players: z.array(z.string().trim().min(1)).min(1).max(20),
  })
  .strict();

const eventSpec = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('goal'),
      /** Scorer's name, or null when the scorer is explicitly unknown. The key is required. */
      player: z.string().trim().min(1).nullable(),
      /** Needed only for unknown scorers. Otherwise inferred from the scorer. */
      team: z.string().optional(),
      assist: z.string().trim().min(1).optional(),
      minute: minute.optional(),
      /** Shorthand: "scored twice" → count: 2 (cannot be combined with minute/assist). */
      count: z.number().int().min(1).max(20).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('own_goal'),
      player: z.string().trim().min(1).nullable(),
      /** The team the goal counts FOR. Inferred from the scorer when given. */
      team: z.string().optional(),
      minute: minute.optional(),
      count: z.number().int().min(1).max(20).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('assist'),
      player: z.string().trim().min(1),
      team: z.string().optional(),
      count: z.number().int().min(1).max(20).optional(),
    })
    .strict(),
]);

export const matchSpecSchema = z
  .object({
    date: z.string().refine(isValidDate, 'must be a real date, YYYY-MM-DD'),
    /** Only for a second (third…) game on the same day. */
    sequence: z.number().int().min(2).max(9).optional(),
    kickoff: timeOfDay.optional(),
    venue: z.string().trim().min(1).max(80).optional(),
    teams: z.object({ a: teamSpec, b: teamSpec }).strict(),
    score: z.object({ a: z.number().int().min(0).max(99), b: z.number().int().min(0).max(99) }).strict(),
    events: z.array(eventSpec).max(120).default([]),
    playerOfTheMatch: z.string().trim().min(1).nullable().optional(),
    report: reportSpecSchema.optional(),
    /** Marks demo data so it can be purged before launch. */
    fictional: z.boolean().optional(),
    /** The user's original message, kept in the audit log. */
    instruction: z.string().max(4000).optional(),
  })
  .strict();
export type MatchSpec = z.infer<typeof matchSpecSchema>;

export function parseMatchSpec(input: unknown): { spec: MatchSpec; errors: Issue[] } | { spec: null; errors: Issue[] } {
  const r = matchSpecSchema.safeParse(input);
  if (r.success) return { spec: r.data, errors: [] };
  return {
    spec: null,
    errors: r.error.issues.map((i) => ({
      level: 'error' as const,
      code: 'SPEC_INVALID',
      message: `${i.path.join('.') || '(root)'}: ${i.message}`,
    })),
  };
}

export interface ResolvedName {
  input: string;
  playerId: string;
  displayName: string;
  via: string;
}

export interface SpecResolution {
  draft: (MatchContent & { teams: MatchContent['teams'] }) | null;
  resolved: ResolvedName[];
  clarifications: Clarification[];
  errors: Issue[];
}

const DEFAULT_COLOURS: Record<TeamKey, string> = { a: 'red', b: 'blue' };

/** Resolves all names in a spec to ids. Never guesses: anything uncertain becomes a clarification. */
export function resolveSpec(spec: MatchSpec, players: readonly Player[]): SpecResolution {
  const clarifications: Clarification[] = [];
  const resolved: ResolvedName[] = [];
  const errors: Issue[] = [];
  const err = (code: string, message: string) => errors.push({ level: 'error', code, message });
  const asked = new Set<string>();

  const pick = (input: string, where: string): string | null => {
    const r: Resolution = resolveName(input, players);
    if (r.kind === 'resolved') {
      if (!resolved.some((x) => x.input === input && x.playerId === r.playerId)) {
        resolved.push({ input, playerId: r.playerId, displayName: r.displayName, via: r.via });
      }
      return r.playerId;
    }
    const key = `${r.kind}:${normaliseName(input)}`;
    if (!asked.has(key)) {
      asked.add(key);
      if (r.kind === 'ambiguous') {
        clarifications.push({
          kind: 'ambiguous',
          input,
          where,
          candidates: r.candidates.map((c) => ({ playerId: c.playerId, displayName: c.displayName })),
          question: `"${input}" (${where}) could be ${r.candidates.map((c) => `${c.displayName} (use "id:${c.playerId}")`).join(' or ')}. Which one?`,
        });
      } else {
        clarifications.push({
          kind: 'unknown',
          input,
          where,
          suggestions: r.suggestions,
          question: r.suggestions.length
            ? `No player called "${input}" (${where}). Did you mean ${r.suggestions.map((s) => `${s.displayName} (use "id:${s.playerId}")`).join(' or ')} — or should I create "${input}" as a new player?`
            : `No player called "${input}" (${where}). Should I create "${input}" as a new player?`,
        });
      }
    }
    return null;
  };

  const rosterIds: Record<TeamKey, (string | null)[]> = {
    a: spec.teams.a.players.map((n) => pick(n, `${spec.teams.a.name} line-up`)),
    b: spec.teams.b.players.map((n) => pick(n, `${spec.teams.b.name} line-up`)),
  };

  const teamRef = (ref: string | undefined): TeamKey | null | 'bad' => {
    if (ref === undefined) return null;
    const q = normaliseName(ref);
    if (q === 'a' || q === 'b') return q;
    for (const k of ['a', 'b'] as const) {
      const t = spec.teams[k];
      const n = normaliseName(t.name);
      const short = n.replace(/ team$/, '');
      if (q === n || q === short || (t.colour && q === normaliseName(t.colour))) return k;
    }
    return 'bad';
  };

  // Team membership by resolved id (for inferring event teams).
  const members = (id: string): TeamKey | null => {
    for (const k of ['a', 'b'] as const) if (rosterIds[k].includes(id)) return k;
    return null;
  };

  const events: MatchEvent[] = [];
  spec.events.forEach((e, i) => {
    const at = `events[${i}]`;
    const times = e.count ?? 1;
    if (e.count && e.count > 1 && (('minute' in e && e.minute !== undefined) || ('assist' in e && e.assist))) {
      err('SPEC_COUNT_CONFLICT', `${at}: "count" cannot be combined with "minute" or "assist". List each goal separately.`);
      return;
    }
    const declared = teamRef(e.team);
    if (declared === 'bad') {
      err('EVENT_TEAM_UNKNOWN', `${at}: team "${e.team}" is not one of this match's teams ("a", "b", "${spec.teams.a.name}", "${spec.teams.b.name}").`);
      return;
    }
    const pid = e.player === null ? null : pick(e.player, `${at} ${e.type.replace('_', ' ')}`);
    if (e.player !== null && pid === null) return; // needs clarification

    // Which team does this event count for?
    let team: TeamKey | null = declared;
    if (pid !== null) {
      const home = members(pid);
      if (home === null) {
        err('EVENT_PLAYER_NOT_IN_MATCH', `${at}: ${e.player} is named as a ${e.type.replace('_', ' ')} ${e.type === 'assist' ? 'provider' : 'scorer'} but is not in either line-up.`);
        return;
      }
      const inferred = e.type === 'own_goal' ? otherTeam(home) : home;
      if (declared && declared !== inferred) {
        err('EVENT_TEAM_MISMATCH', `${at}: ${e.player} plays for ${spec.teams[home].name}, so this ${e.type.replace('_', ' ')} counts for ${spec.teams[inferred].name}, not ${spec.teams[declared].name}.`);
        return;
      }
      team = inferred;
    }
    if (team === null) {
      err('EVENT_TEAM_REQUIRED', `${at}: an unknown-scorer ${e.type.replace('_', ' ')} needs "team" ("a" or "b") so it can be counted.`);
      return;
    }

    for (let n = 0; n < times; n++) {
      if (e.type === 'assist') {
        events.push({ type: 'assist', team, playerId: pid! });
      } else if (e.type === 'own_goal') {
        events.push({ type: 'own_goal', team, playerId: pid, ...(e.minute !== undefined ? { minute: e.minute } : {}) });
      } else {
        const assistId = e.assist ? pick(e.assist, `${at} assist`) : undefined;
        if (e.assist && !assistId) return;
        events.push({
          type: 'goal',
          team,
          playerId: pid,
          ...(assistId ? { assistId } : {}),
          ...(e.minute !== undefined ? { minute: e.minute } : {}),
        });
      }
    }
  });

  const potm = spec.playerOfTheMatch ? pick(spec.playerOfTheMatch, 'player of the match') : null;

  if (clarifications.length || errors.length || rosterIds.a.includes(null) || rosterIds.b.includes(null)) {
    return { draft: null, resolved, clarifications, errors };
  }
  const ids = (k: TeamKey) => rosterIds[k] as string[];
  return {
    draft: {
      date: spec.date,
      teams: {
        a: { name: spec.teams.a.name, colour: spec.teams.a.colour ?? DEFAULT_COLOURS.a, playerIds: ids('a') },
        b: { name: spec.teams.b.name, colour: spec.teams.b.colour ?? DEFAULT_COLOURS.b, playerIds: ids('b') },
      },
      score: spec.score,
      // If every event has a minute, store chronologically. Otherwise keep the order given — never imply a timeline.
      events: events.every((e) => 'minute' in e && e.minute !== undefined)
        ? [...events].sort((x, y) => (('minute' in x ? x.minute : 0) ?? 0) - (('minute' in y ? y.minute : 0) ?? 0))
        : events,
      playerOfTheMatch: potm,
    },
    resolved,
    clarifications,
    errors,
  };
}

/** Converts a stored match back to a name-based spec, so an edit starts from the current truth. */
export function matchToSpec(
  m: { id: string; date: string; kickoff?: string | undefined; venue?: string | undefined; teams: MatchContent['teams']; score: MatchContent['score']; events: MatchEvent[]; playerOfTheMatch: string | null },
  players: readonly Player[],
): MatchSpec {
  const name = (id: string) => players.find((p) => p.id === id)?.displayName ?? id;
  // Use ids wherever a display name could be ambiguous.
  const ref = (id: string) => {
    const n = name(id);
    const r = resolveName(n, players);
    return r.kind === 'resolved' && r.playerId === id ? n : `id:${id}`;
  };
  const sequence = /-(\d)$/.exec(m.id.slice(10))?.[1];
  const events: MatchSpec['events'] = m.events.map((e) => {
    if (e.type === 'goal') {
      return {
        type: 'goal' as const,
        player: e.playerId === null ? null : ref(e.playerId),
        ...(e.playerId === null ? { team: e.team } : {}),
        ...(e.assistId ? { assist: ref(e.assistId) } : {}),
        ...(e.minute !== undefined ? { minute: e.minute } : {}),
      };
    }
    if (e.type === 'own_goal') {
      return {
        type: 'own_goal' as const,
        player: e.playerId === null ? null : ref(e.playerId),
        team: e.team,
        ...(e.minute !== undefined ? { minute: e.minute } : {}),
      };
    }
    return { type: 'assist' as const, player: ref(e.playerId), team: e.team };
  });
  return {
    date: m.date,
    ...(sequence ? { sequence: Number(sequence) } : {}),
    ...(m.kickoff ? { kickoff: m.kickoff } : {}),
    ...(m.venue ? { venue: m.venue } : {}),
    teams: {
      a: { name: m.teams.a.name, colour: m.teams.a.colour, players: m.teams.a.playerIds.map(ref) },
      b: { name: m.teams.b.name, colour: m.teams.b.colour, players: m.teams.b.playerIds.map(ref) },
    },
    score: m.score,
    events,
    playerOfTheMatch: m.playerOfTheMatch === null ? null : ref(m.playerOfTheMatch),
  };
}

export { teamOfPlayer };
