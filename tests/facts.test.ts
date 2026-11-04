import { describe, expect, it } from 'vitest';
import { buildMatchFacts, buildRoundupFacts } from '../src/shared/facts';
import { assist, goal, mkMatch, ownGoal, ROSTER } from './helpers';

const history = [
  mkMatch({ date: '2026-10-05', a: ['peter', 'adam'], b: ['alex', 'tom'], score: [2, 1], events: [goal('a', 'peter'), goal('a', 'peter'), goal('b', 'alex')] }),
  mkMatch({ date: '2026-10-12', a: ['peter', 'tom'], b: ['alex', 'adam'], score: [1, 0], events: [goal('a', 'peter')] }),
  mkMatch({ date: '2026-10-19', a: ['peter', 'adam'], b: ['alex', 'tom'], score: [1, 0], events: [goal('a', 'adam')] }),
];
const newest = mkMatch({
  date: '2026-10-26',
  a: ['peter', 'adam', 'josh'],
  b: ['alex', 'tom', 'james'],
  score: [4, 0],
  events: [goal('a', 'peter', { minute: 3 }), goal('a', 'peter'), goal('a', 'peter'), ownGoal('a', 'tom'), assist('a', 'adam')],
  potm: 'peter',
});

describe('buildMatchFacts', () => {
  const facts = buildMatchFacts(newest.id, [...history, newest], ROSTER, {});

  it('reports the result and scorers from recorded data only', () => {
    expect(facts.result).toMatchObject({ winner: 'a', margin: 4, totalGoals: 4, line: 'Red Team 4–0 Blue Team' });
    expect(facts.scorers).toEqual([{ player: 'Peter', goals: 3, minutes: [3] }]);
    expect(facts.ownGoals).toEqual([{ player: 'Tom', creditedTo: 'Red Team' }]);
    expect(facts.assists).toEqual([{ player: 'Adam', assists: 1 }]);
    expect(facts.playerOfTheMatch).toBe('Peter');
  });

  it('spots hat-tricks, debuts and career totals', () => {
    const peter = facts.players.find((p) => p.playerId === 'peter')!;
    expect(peter).toMatchObject({ hatTrick: true, goals: 3, careerGoals: 6, careerAppearances: 4, winStreak: 4 });
    expect(facts.players.find((p) => p.playerId === 'josh')).toMatchObject({ debut: true });
    expect(facts.statements).toContain('Peter scored a hat-trick.');
    expect(facts.statements).toContain("It was Josh's first appearance.");
  });

  it('detects milestones crossed in this match', () => {
    const peter = facts.players.find((p) => p.playerId === 'peter')!;
    expect(peter.milestones).toContain('5th career goal'); // 3 before + 3 now = 6
  });

  it('flags records only when they are genuinely records', () => {
    expect(facts.records.join(' ')).toContain('biggest winning margin on record (previous best: 1)');
  });

  it('states what is not recorded so writers do not invent it', () => {
    expect(facts.notRecorded).toEqual(expect.arrayContaining(['The venue was not recorded.']));
  });

  it('uses only matches up to the one being described (edits to history stay correct)', () => {
    const early = buildMatchFacts('2026-10-12', [...history, newest], ROSTER, {});
    expect(early.players.find((p) => p.playerId === 'peter')).toMatchObject({ careerGoals: 3, careerAppearances: 2 });
  });

  it('throws for a match that is not published', () => {
    expect(() => buildMatchFacts('nope', history, ROSTER)).toThrow(/not among the published/);
  });
});

describe('buildRoundupFacts', () => {
  it('summarises the Monday–Sunday week containing a date', () => {
    const r = buildRoundupFacts('2026-10-28', [...history, newest], ROSTER, { date: '2026-11-02', kickoff: '19:30' });
    expect(r).toMatchObject({ from: '2026-10-26', to: '2026-11-01' });
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({ line: 'Red Team 4–0 Blue Team', potm: 'Peter' });
    expect(r.topPerformers[0]).toMatchObject({ player: 'Peter', goals: 3 });
    expect(r.streaks[0]).toMatchObject({ player: 'Peter', streak: 4 });
    expect(r.nextFixture).toContain('2 November 2026 at 19:30');
  });

  it('says so when nothing was played', () => {
    const r = buildRoundupFacts('2026-12-01', history, ROSTER, null);
    expect(r.statements[0]).toMatch(/No match was recorded/);
  });
});
