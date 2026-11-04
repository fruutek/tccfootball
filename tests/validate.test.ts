import { describe, expect, it } from 'vitest';
import { accountGoals } from '../src/shared/events';
import { canonicalContent } from '../src/shared/fingerprint';
import { validateMatchContent } from '../src/shared/validate';
import { assist, goal, mkMatch, ownGoal } from './helpers';

const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);
const wcodes = (r: { warnings: { code: string }[] }) => r.warnings.map((e) => e.code);

const base = () =>
  mkMatch({
    date: '2026-11-02', // a Monday
    a: ['peter', 'adam', 'james', 'chris', 'arun'],
    b: ['alex', 'brownie', 'avalon', 'josh', 'tom'],
    score: [3, 0],
    events: [goal('a', 'peter'), goal('a', 'peter'), goal('a', 'james'), assist('a', 'adam')],
    potm: 'peter',
  });

describe('validateMatchContent', () => {
  it('accepts a fully consistent result', () => {
    const r = validateMatchContent(base(), { today: '2026-11-04' });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('rejects a score with goals nobody has accounted for — never inventing scorers', () => {
    const m = base();
    m.events = [goal('a', 'peter'), goal('a', 'james')];
    const r = validateMatchContent(m);
    expect(codes(r)).toEqual(['GOALS_UNACCOUNTED']);
    expect(r.errors[0]!.message).toContain('1 missing');
    expect(r.errors[0]!.message).toContain('"player":null');
  });

  it('accepts explicit unknown-scorer goals, with a warning', () => {
    const m = base();
    m.events = [goal('a', 'peter'), goal('a', 'james'), goal('a', null)];
    const r = validateMatchContent(m);
    expect(r.errors).toEqual([]);
    expect(wcodes(r)).toContain('UNKNOWN_SCORER');
  });

  it('rejects more goals than the score allows', () => {
    const m = base();
    m.events = [...m.events, goal('b', 'alex')];
    expect(codes(validateMatchContent(m))).toContain('GOALS_EXCEED_SCORE');
  });

  it('rejects a scorer who is not on the team', () => {
    const m = base();
    m.events = [goal('a', 'alex'), goal('a', 'peter'), goal('a', 'james')];
    expect(codes(validateMatchContent(m))).toContain('SCORER_NOT_IN_TEAM');
  });

  describe('own goals', () => {
    it('counts an own goal toward the opposition score', () => {
      const m = mkMatch({ a: ['peter'], b: ['tom'], score: [1, 0], events: [ownGoal('a', 'tom')] });
      expect(validateMatchContent(m).errors).toEqual([]);
      expect(accountGoals(m).a).toMatchObject({ ownGoalsFor: 1, recorded: 1, unaccounted: 0 });
    });

    it('rejects an own goal by a player on the credited team', () => {
      const m = mkMatch({ a: ['peter'], b: ['tom'], score: [1, 0], events: [ownGoal('a', 'peter')] });
      expect(codes(validateMatchContent(m))).toContain('OWN_GOAL_WRONG_TEAM');
    });

    it('allows an own goal whose scorer is unknown', () => {
      const m = mkMatch({ a: ['peter'], b: ['tom'], score: [1, 0], events: [ownGoal('a', null)] });
      expect(validateMatchContent(m).ok).toBe(true);
    });

    it('cannot be the source of an assist', () => {
      const m = mkMatch({
        a: ['peter', 'adam'],
        b: ['tom', 'alex'],
        score: [1, 0],
        events: [ownGoal('a', 'tom'), assist('a', 'adam')],
      });
      expect(codes(validateMatchContent(m))).toContain('ASSISTS_EXCEED_GOALS');
    });
  });

  describe('assists', () => {
    it('rejects more assists than goals', () => {
      const m = base();
      m.events = [...m.events, assist('a', 'chris')]; // 3 goals, 2 assists
      expect(validateMatchContent(m).ok).toBe(true);
      m.events = [...m.events, assist('a', 'arun'), assist('a', 'james')]; // now 4
      expect(codes(validateMatchContent(m))).toContain('ASSISTS_EXCEED_GOALS');
    });

    it('rejects self-assists and assists from the other team', () => {
      const m = mkMatch({
        a: ['peter', 'adam'],
        b: ['alex', 'tom'],
        score: [2, 0],
        events: [goal('a', 'peter', { assistId: 'peter' }), goal('a', 'adam', { assistId: 'alex' })],
      });
      expect(codes(validateMatchContent(m))).toEqual(expect.arrayContaining(['ASSIST_SELF', 'ASSIST_NOT_IN_TEAM']));
    });
  });

  it('rejects a player on both teams, duplicates and empty teams', () => {
    const m = mkMatch({ a: ['peter', 'peter', 'adam'], b: ['adam', 'tom'] });
    expect(codes(validateMatchContent(m))).toEqual(expect.arrayContaining(['PLAYER_DUPLICATE_IN_TEAM', 'PLAYER_ON_BOTH_TEAMS']));
    expect(codes(validateMatchContent(mkMatch({ a: [], b: ['tom'] })))).toContain('TEAM_EMPTY');
  });

  it('rejects identical team names but supports distinct per-fixture names', () => {
    expect(codes(validateMatchContent(mkMatch({ names: ['Reds', 'reds'] })))).toContain('TEAM_NAME_DUPLICATE');
    expect(validateMatchContent(mkMatch({ names: ['Bibs', 'Skins'] })).ok).toBe(true);
  });

  it('requires player of the match to have played', () => {
    const m = base();
    m.playerOfTheMatch = 'zed';
    expect(codes(validateMatchContent(m))).toContain('POTM_NOT_PARTICIPANT');
  });

  it('rejects future dates, warns on non-Mondays and rejects impossible dates', () => {
    const future = base();
    future.date = '2026-11-09';
    expect(codes(validateMatchContent(future, { today: '2026-11-04' }))).toContain('DATE_FUTURE');
    const tuesday = base();
    tuesday.date = '2026-11-03';
    expect(wcodes(validateMatchContent(tuesday, { today: '2026-11-04' }))).toContain('DATE_NOT_MONDAY');
    const bad = base();
    bad.date = '2026-02-30';
    expect(codes(validateMatchContent(bad))).toContain('DATE_INVALID');
  });

  it('flags player ids that are not registered', () => {
    const known = new Set(['peter', 'adam', 'james', 'chris', 'arun', 'alex', 'brownie', 'avalon', 'josh']);
    expect(codes(validateMatchContent(base(), { knownPlayerIds: known }))).toContain('PLAYER_UNKNOWN'); // tom
  });
});

describe('fingerprint (duplicate detection)', () => {
  const fp = (m: ReturnType<typeof mkMatch>, includeDate = true) => canonicalContent(m, { includeDate });

  it('is identical for the same result however it is entered', () => {
    const one = base();
    const swapped = base();
    // Same match, but the sides are labelled the other way round, events reordered, names and minutes different.
    swapped.teams = { a: { ...one.teams.b, name: 'Bibs' }, b: { ...one.teams.a, name: 'Skins' } };
    swapped.score = { a: 0, b: 3 };
    swapped.events = [assist('b', 'adam'), goal('b', 'james'), goal('b', 'peter', { minute: 9 }), goal('b', 'peter')];
    swapped.playerOfTheMatch = 'james';
    expect(fp(swapped)).toBe(fp(one));
  });

  it('differs when a scorer, score, lineup or date differs', () => {
    const one = base();
    const other = base();
    other.events = [goal('a', 'peter'), goal('a', 'james'), goal('a', 'james'), assist('a', 'adam')];
    expect(fp(other)).not.toBe(fp(one));
    const moved = base();
    moved.date = '2026-11-09';
    expect(fp(moved)).not.toBe(fp(one));
    expect(fp(moved, false)).toBe(fp(one, false)); // used for the "possible date typo" warning
  });
});
