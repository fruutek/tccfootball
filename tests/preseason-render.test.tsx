/** How preseason results (no line-ups, no statistics) look on the pages. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ArchiveView } from '../src/components/ArchiveView';
import { HomeView } from '../src/components/HomeView';
import { LeaderboardView } from '../src/components/LeaderboardView';
import { MatchCentre } from '../src/components/MatchViews';
import { PlayersDirectory } from '../src/components/PlayerViews';
import type { SiteData } from '../src/lib/data';
import { getIndex } from '../src/lib/view';
import type { Match, Player } from '../src/shared/schema';
import { goal, mkMatch, mkPlayer } from './helpers';

const text = (node: React.ReactElement) => renderToStaticMarkup(node).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

const players: Player[] = [
  { ...mkPlayer('peter', 'Peter'), startingTotals: { appearances: 4, goals: 3 } },
  { ...mkPlayer('kj', 'KJ'), startingTotals: { appearances: 4, goals: 3 } },
  { ...mkPlayer('andrew', 'Andrew'), startingTotals: { appearances: 4, goals: 1 } },
];
const pre = (id: string, date: string, score: [number, number], events: Match['events']): Match => ({
  ...mkMatch({ id, date, a: [], b: [], score, events, names: ['Team 1', 'Team 2'] }),
  preseason: true,
});
const matches: Match[] = [
  pre('2026-10-26', '2026-10-26', [1, 0], [goal('a', 'peter')]),
  pre('2026-11-02', '2026-11-02', [2, 1], [goal('a', 'kj'), goal('a', 'kj'), goal('b', 'andrew')]),
];
const data: SiteData = { settings: null, players, matches, articles: [], revision: 0 };
const idx = getIndex(data);

describe('preseason results on the pages', () => {
  it('Results lists them, newest first, with their scorers', () => {
    const t = text(<ArchiveView idx={idx} />);
    expect(t).toContain('Team 1');
    expect(t).toContain('Team 2');
    expect(t).toContain('Peter');
    expect(t).toContain('KJ ×2');
    expect(t).toContain('2 matches');
    expect(t.indexOf('Nov 2026')).toBeGreaterThan(-1);
    expect(t.indexOf('Nov 2026')).toBeLessThan(t.indexOf('Oct 2026'));
    expect(t).not.toContain('The first result will appear here');
  });

  it('the match page has a scoreboard and goals but no line-ups and no player counts', () => {
    const html = renderToStaticMarkup(<MatchCentre idx={idx} matchId="2026-11-02" />);
    const t = text(<MatchCentre idx={idx} matchId="2026-11-02" />);
    expect(html).toContain('aria-label="Team 1 2, Team 2 1"');
    expect(t).toContain('Preseason');
    expect(t).not.toContain('Full time');
    expect(t).toContain('KJ');
    expect(t).toContain('Andrew');
    expect(t).not.toContain('Line-ups');
    expect(t).not.toContain('Starting line-ups');
    expect(t).not.toMatch(/\b0 players\b/);
    expect(t).toContain('Previous match');
  });

  it('home shows the latest preseason result and ranks the goals on All, not an empty season', () => {
    const t = text(<HomeView idx={idx} today="2026-11-05" />);
    expect(t).toContain('Latest result');
    expect(t).toContain('Preseason');
    expect(t).toContain('KJ');
    // KJ 3 and Peter 3 are on the Top scorers list straight away (preseason goals live in the All view).
    expect(t).toMatch(/Top scorers[^]*KJ[^]*3/);
    // No recorded line-ups → no "recent form" block full of nobody.
    expect(t).not.toContain('Recent player form');
  });

  it('changes nothing about the players, the leaderboards or the match counts', () => {
    const withoutResults = getIndex({ ...data, matches: [] });
    expect(idx.matchCount({ kind: 'all' })).toBe(0);
    const board = (i: typeof idx) => text(<LeaderboardView idx={i} />);
    expect(board(idx)).toBe(board(withoutResults));
    expect(text(<PlayersDirectory idx={idx} />)).toBe(text(<PlayersDirectory idx={withoutResults} />));
    expect(board(idx)).toContain('0 matches');
  });
});
