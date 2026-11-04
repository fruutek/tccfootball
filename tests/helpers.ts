import type { Match, MatchEvent, Player } from '../src/shared/schema';

const NOW = '2026-01-01T12:00:00.000Z';

export interface MatchSpec {
  id?: string;
  date?: string;
  a?: string[];
  b?: string[];
  score?: [number, number];
  events?: MatchEvent[];
  potm?: string | null;
  status?: Match['status'];
  names?: [string, string];
}

/** Builds a full match document without going through the CLI. */
export function mkMatch(s: MatchSpec = {}): Match {
  const date = s.date ?? '2026-01-05';
  return {
    schemaVersion: 1,
    id: s.id ?? date,
    status: s.status ?? 'published',
    date,
    teams: {
      a: { name: s.names?.[0] ?? 'Red Team', colour: 'red', playerIds: s.a ?? ['peter', 'adam'] },
      b: { name: s.names?.[1] ?? 'Blue Team', colour: 'blue', playerIds: s.b ?? ['alex', 'tom'] },
    },
    score: { a: s.score?.[0] ?? 0, b: s.score?.[1] ?? 0 },
    events: s.events ?? [],
    playerOfTheMatch: s.potm ?? null,
    playerIds: [],
    fingerprint: '0'.repeat(64),
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

export const goal = (team: 'a' | 'b', playerId: string | null, extra: { assistId?: string; minute?: number } = {}): MatchEvent => ({
  type: 'goal',
  team,
  playerId,
  ...extra,
});
export const ownGoal = (creditedTeam: 'a' | 'b', playerId: string | null): MatchEvent => ({
  type: 'own_goal',
  team: creditedTeam,
  playerId,
});
export const assist = (team: 'a' | 'b', playerId: string): MatchEvent => ({ type: 'assist', team, playerId });

export function mkPlayer(id: string, displayName: string, extra: Partial<Player> = {}): Player {
  return {
    schemaVersion: 1,
    id,
    displayName,
    aliases: [],
    status: 'active',
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

export const ROSTER: Player[] = [
  mkPlayer('peter', 'Peter'),
  mkPlayer('adam', 'Adam'),
  mkPlayer('james', 'James'),
  mkPlayer('chris', 'Chris'),
  mkPlayer('arun', 'Arun'),
  mkPlayer('alex', 'Alex'),
  mkPlayer('brownie', 'Brownie'),
  mkPlayer('avalon', 'Avalon'),
  mkPlayer('josh', 'Josh'),
  mkPlayer('tom', 'Tom'),
];
