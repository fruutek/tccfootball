import { TEAM_KEYS, type TeamKey } from './constants';
import type { Match, MatchEvent } from './schema';

/** The parts of a match that describe what happened on the pitch. */
export type MatchContent = Pick<Match, 'date' | 'teams' | 'score' | 'events' | 'playerOfTheMatch'>;

export interface TeamAccounting {
  team: TeamKey;
  /** Final score as declared. */
  declared: number;
  /** Goals with a named scorer from this team. */
  knownGoals: number;
  /** Goals for this team explicitly recorded with an unknown scorer. */
  unknownGoals: number;
  /** Own goals scored by the opposition that count for this team. */
  ownGoalsFor: number;
  /** knownGoals + unknownGoals + ownGoalsFor */
  recorded: number;
  /** declared - recorded. Zero for a valid match. */
  unaccounted: number;
  /** Goals that can carry an assist (everything except own goals). */
  assistableGoals: number;
  linkedAssists: number;
  unlinkedAssists: number;
}

export function accountGoals(m: Pick<Match, 'score' | 'events'>): Record<TeamKey, TeamAccounting> {
  const out = {} as Record<TeamKey, TeamAccounting>;
  for (const team of TEAM_KEYS) {
    let knownGoals = 0;
    let unknownGoals = 0;
    let ownGoalsFor = 0;
    let linkedAssists = 0;
    let unlinkedAssists = 0;
    for (const e of m.events) {
      if (e.team !== team) continue;
      if (e.type === 'goal') {
        if (e.playerId === null) unknownGoals++;
        else knownGoals++;
        if (e.assistId) linkedAssists++;
      } else if (e.type === 'own_goal') {
        ownGoalsFor++;
      } else if (e.type === 'assist') {
        unlinkedAssists++;
      }
    }
    const recorded = knownGoals + unknownGoals + ownGoalsFor;
    out[team] = {
      team,
      declared: m.score[team],
      knownGoals,
      unknownGoals,
      ownGoalsFor,
      recorded,
      unaccounted: m.score[team] - recorded,
      assistableGoals: knownGoals + unknownGoals,
      linkedAssists,
      unlinkedAssists,
    };
  }
  return out;
}

export function teamOfPlayer(m: Pick<Match, 'teams'>, playerId: string): TeamKey | null {
  for (const k of TEAM_KEYS) if (m.teams[k].playerIds.includes(playerId)) return k;
  return null;
}

export function participantIds(m: Pick<Match, 'teams'>): string[] {
  return [...new Set([...m.teams.a.playerIds, ...m.teams.b.playerIds])].sort();
}

export type Outcome = 'a' | 'b' | 'draw';
export function outcomeOf(score: { a: number; b: number }): Outcome {
  return score.a > score.b ? 'a' : score.b > score.a ? 'b' : 'draw';
}

/** Per-player line for a match: what each participant did in it. */
export interface PlayerMatchLine {
  playerId: string;
  team: TeamKey;
  goals: number;
  assists: number;
  ownGoals: number;
  potm: boolean;
}

export function matchLines(m: MatchContent): PlayerMatchLine[] {
  const lines = new Map<string, PlayerMatchLine>();
  for (const team of TEAM_KEYS) {
    for (const playerId of m.teams[team].playerIds) {
      lines.set(playerId, { playerId, team, goals: 0, assists: 0, ownGoals: 0, potm: m.playerOfTheMatch === playerId });
    }
  }
  const bump = (id: string | null | undefined, field: 'goals' | 'assists' | 'ownGoals') => {
    if (!id) return;
    const line = lines.get(id);
    if (line) line[field]++;
  };
  for (const e of m.events as MatchEvent[]) {
    if (e.type === 'goal') {
      bump(e.playerId, 'goals');
      bump(e.assistId, 'assists');
    } else if (e.type === 'own_goal') {
      bump(e.playerId, 'ownGoals');
    } else if (e.type === 'assist') {
      bump(e.playerId, 'assists');
    }
  }
  return [...lines.values()];
}
