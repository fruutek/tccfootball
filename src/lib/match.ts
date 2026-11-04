import { matchLines, outcomeOf, type PlayerMatchLine } from '../shared/events';
import type { Match, TeamKey } from '../shared/schema';

export interface ScorerLine {
  key: string;
  playerId: string | null;
  name: string;
  goals: number;
  minutes: number[];
  own: boolean;
  unknown: boolean;
}

/** Who scored for `team`, grouped by player. Own goals appear under the team they count for. */
export function scorerLines(m: Match, team: TeamKey, nameOf: (id: string) => string): ScorerLine[] {
  const lines = new Map<string, ScorerLine>();
  for (const e of m.events) {
    if (e.team !== team || e.type === 'assist') continue;
    const own = e.type === 'own_goal';
    const key = `${own ? 'og' : 'g'}:${e.playerId ?? '?'}`;
    const line = lines.get(key) ?? {
      key,
      playerId: e.playerId,
      name: e.playerId ? nameOf(e.playerId) : own ? 'Own goal' : 'Scorer not recorded',
      goals: 0,
      minutes: [],
      own,
      unknown: e.playerId === null,
    };
    line.goals++;
    if (e.minute !== undefined) line.minutes.push(e.minute);
    lines.set(key, line);
  }
  return [...lines.values()].sort((a, b) => b.goals - a.goals || Number(a.unknown) - Number(b.unknown));
}

export interface AssistLine {
  playerId: string;
  name: string;
  count: number;
}

export function assistLines(m: Match, team: TeamKey, nameOf: (id: string) => string): AssistLine[] {
  const map = new Map<string, number>();
  for (const e of m.events) {
    if (e.team !== team) continue;
    const id = e.type === 'assist' ? e.playerId : e.type === 'goal' ? e.assistId : undefined;
    if (id) map.set(id, (map.get(id) ?? 0) + 1);
  }
  return [...map].map(([playerId, count]) => ({ playerId, name: nameOf(playerId), count })).sort((a, b) => b.count - a.count);
}

export const outcome = (m: Match) => outcomeOf(m.score);
export const linesFor = (m: Match): PlayerMatchLine[] => matchLines(m);

/** True when every goal has a minute, so a real timeline can be drawn. */
export function hasTimeline(m: Match): boolean {
  const goals = m.events.filter((e) => e.type !== 'assist');
  return goals.length > 0 && goals.every((e) => 'minute' in e && e.minute !== undefined);
}

export const minuteLabel = (minutes: number[]) => minutes.map((x) => `${x}'`).join(' ');
