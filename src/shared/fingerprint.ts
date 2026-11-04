import type { MatchContent } from './events';
import { TEAM_KEYS } from './constants';

/**
 * A canonical string describing WHAT HAPPENED in a match, ignoring cosmetics.
 *
 * Ignored on purpose: team names and colours, which side is called "a", venue,
 * minutes, player of the match, and event order. Two submissions that differ
 * only in those are the same result and must not both be published — the
 * correct way to change them is to edit the existing match.
 */
export function canonicalContent(m: MatchContent, opts: { includeDate: boolean }): string {
  const sides = TEAM_KEYS.map((k) => ({ key: k, players: [...m.teams[k].playerIds].sort(), score: m.score[k] }));
  sides.sort((x, y) => x.players.join(',').localeCompare(y.players.join(',')));
  const index = new Map(sides.map((s, i) => [s.key, i]));

  const events = m.events
    .map((e) => {
      const side = index.get(e.team);
      const assist = e.type === 'goal' ? (e.assistId ?? '') : '';
      return `${e.type}|${side}|${e.playerId ?? '?'}|${assist}`;
    })
    .sort();

  return JSON.stringify({
    date: opts.includeDate ? m.date : null,
    sides: sides.map((s) => ({ players: s.players, score: s.score })),
    events,
  });
}
