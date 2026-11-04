/**
 * "Firestore-based content rendering": real documents are written with the admin
 * tooling, read back through the SAME client code the browser uses (Firestore Lite
 * SDK, security rules enforced) and rendered to HTML by the real page components.
 */
import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore/lite';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connect } from '../cli/firebase';
import { seedDemo } from '../cli/services/demo';
import { execute } from '../cli/services/execute';
import { planMatchStatus } from '../cli/services/matches';
import type { Ctx } from '../cli/types';
import { ArchiveView } from '../src/components/ArchiveView';
import { HomeView } from '../src/components/HomeView';
import { LeaderboardView } from '../src/components/LeaderboardView';
import { MatchCentre } from '../src/components/MatchViews';
import { ArticleView, NewsIndex } from '../src/components/NewsViews';
import { PlayerProfile, PlayersDirectory } from '../src/components/PlayerViews';
import { loadSiteDataFromFirestore, resetSiteStore, startLoading, getState, type SiteData } from '../src/lib/data';
import { getIndex } from '../src/lib/view';
import { clearEmulator, emulatorHostPort } from './emulator-helpers';

const PROJECT = 'demo-mnf';
const ctx: Ctx = { now: new Date('2026-11-04T10:00:00Z'), today: '2026-11-04', actor: 'test' };
const { store } = connect({ project: PROJECT });

const { host, port } = emulatorHostPort();
const clientDb = getFirestore(initializeApp({ projectId: PROJECT, apiKey: 'demo' }, 'render-test'));
connectFirestoreEmulator(clientDb, host, port);

const text = (node: React.ReactElement) => renderToStaticMarkup(node).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

let data: SiteData;

beforeAll(async () => {
  await clearEmulator(PROJECT);
  const r = await seedDemo(store, ctx);
  expect(r.ok, r.lines.join('\n')).toBe(true);
  data = await loadSiteDataFromFirestore(clientDb);
});

describe('reading Firestore as an anonymous visitor (rules enforced)', () => {
  it('returns the published content and the revision marker', () => {
    expect(data.matches).toHaveLength(10);
    expect(data.players).toHaveLength(12);
    expect(data.articles.length).toBeGreaterThanOrEqual(7);
    expect(data.settings?.dataRevision).toBeGreaterThan(0);
    expect(data.revision).toBe(data.settings!.dataRevision);
  });

  it('never returns an unpublished match', async () => {
    const latest = [...data.matches].sort((a, b) => (a.date < b.date ? 1 : -1))[0]!;
    await execute(store, planMatchStatus(await store.load(), latest.id, 'unpublish', ctx), ctx, true);
    const after = await loadSiteDataFromFirestore(clientDb);
    expect(after.matches).toHaveLength(9);
    expect(after.matches.some((m) => m.id === latest.id)).toBe(false);
    expect(after.articles.every((a) => a.matchId !== latest.id)).toBe(true); // its report went with it
    expect(after.revision).toBeGreaterThan(data.revision);
    await execute(store, planMatchStatus(await store.load(), latest.id, 'republish', ctx), ctx, true);
  });
});

describe('pages rendered from Firestore data', () => {
  beforeEach(async () => {
    data = await loadSiteDataFromFirestore(clientDb);
  });

  it('home: latest result, fixture, scorers, assists, player of the week, news and form', () => {
    const idx = getIndex(data);
    const html = renderToStaticMarkup(<HomeView idx={idx} today="2026-11-04" />);
    const t = text(<HomeView idx={idx} today="2026-11-04" />);
    expect(html).toContain('aria-label="Red Team 3, Blue Team 0"');
    expect(t).toContain('Marco Rinaldi');
    expect(t).toContain("12' 31'");
    expect(t).toContain('Next Monday');
    expect(t).toContain('9 November 2026');
    for (const section of ['Latest result', 'Recent results', 'Featured match report', 'Player of the week', 'Top scorers', 'Top assists', 'Recent player form', 'Latest news']) {
      expect(t, section).toContain(section);
    }
  });

  it('home: hides a fixture date that has already passed', () => {
    const t = text(<HomeView idx={getIndex(data)} today="2026-11-10" />);
    expect(t).not.toContain('Next Monday');
  });

  it('match centre: scoreboard, goals with minutes, line-ups, report, previous/next', () => {
    const idx = getIndex(data);
    const t = text(<MatchCentre idx={idx} matchId="2026-11-02" />);
    expect(t).toContain('Red Team');
    expect(t).toContain('Blue Team');
    expect(t).toContain('Assist: Danny Okafor');
    expect(t).toContain('Starting line-ups');
    expect(t).toContain('Tomás Beltrán'); // accents survive the round trip
    expect(t).toContain('Marco double keeps Red Team in front');
    expect(t).toContain('Previous match');
    expect(t).toContain('Latest match');
  });

  it('match centre: an unknown id is a friendly "not found", not a crash', () => {
    expect(text(<MatchCentre idx={getIndex(data)} matchId="1999-01-01" />)).toContain('Match not found');
    expect(text(<MatchCentre idx={getIndex(data)} matchId={null} />)).toContain('Match not found');
  });

  it('player profile: stats are derived from the matches', () => {
    const t = text(<PlayerProfile idx={getIndex(data)} playerId="marco-rinaldi" />);
    expect(t).toContain('Marco Rinaldi');
    expect(t).toContain('The Maestro');
    expect(t).toMatch(/Appearances\s*10/);
    expect(t).toMatch(/Goals\s*10/);
    expect(t).toContain('First appearance');
    expect(t).toContain('2026'); // season row
    expect(text(<PlayerProfile idx={getIndex(data)} playerId="nobody" />)).toContain('Player not found');
  });

  it('players directory lists everyone', () => {
    const t = text(<PlayersDirectory idx={getIndex(data)} />);
    for (const n of ['Marco Rinaldi', 'Yusuf Demir', 'Tomás Beltrán', 'Ben Calloway']) expect(t).toContain(n);
  });

  it('leaderboards: every board renders from the same data', () => {
    const idx = getIndex(data);
    const goals = text(<LeaderboardView idx={idx} initial={{ board: 'goals' }} />);
    expect(goals).toMatch(/LEADER\s*MR\s*Marco Rinaldi\s*10/);
    const assists = text(<LeaderboardView idx={idx} initial={{ board: 'assists' }} />);
    expect(assists).toMatch(/LEADER\s*DO\s*Danny Okafor\s*6/);
    const rate = text(<LeaderboardView idx={idx} initial={{ board: 'winPct' }} />);
    expect(rate).toContain('minimum 5 appearances');
    expect(rate).not.toContain('Yusuf Demir'); // only 4 appearances
    const season = text(<LeaderboardView idx={idx} initial={{ board: 'goals', period: { kind: 'season', id: '2026' } }} />);
    expect(season).toContain('10 matches');
    const month = text(<LeaderboardView idx={idx} initial={{ board: 'goals', period: { kind: 'month', id: '2026-11' } }} />);
    expect(month).toContain('1 match');
  });

  it('results archive filters by season', () => {
    const idx = getIndex(data);
    expect(text(<ArchiveView idx={idx} initialSeason="2026" />)).toContain('10 matches');
    expect(text(<ArchiveView idx={idx} initialSeason="1999" />)).toContain('No matches here');
  });

  it('news index and article page', () => {
    const idx = getIndex(data);
    const t = text(<NewsIndex idx={idx} />);
    expect(t).toContain('Marco double keeps Red Team in front');
    expect(t).toContain('Official statement from the bib bag');
    const slug = idx.articlesDesc.find((a) => a.category === 'humour')!.id;
    const a = text(<ArticleView idx={idx} slug={slug} />);
    expect(a).toContain('Humour');
    expect(a).toContain('We, the bibs');
    expect(text(<ArticleView idx={idx} slug="nope" />)).toContain('Article not found');
  });

  it('a custom season start re-buckets history without touching any match', async () => {
    const m = await store.load();
    const settings = { ...m.settings!, seasonStartMonth: 9 };
    const idx = getIndex({ ...data, settings });
    expect(idx.seasons).toEqual(['2026-27', '2025-26']); // Aug 31 falls in the previous season
  });
});

describe('the browser store: revision-checked cache', () => {
  const memory = new Map<string, string>();
  let reads = 0;
  const realFetch = globalThis.fetch;

  beforeAll(() => {
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) },
    };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('runQuery')) reads++;
      return realFetch(input, init);
    }) as typeof fetch;
  });

  it('fetches collections once, then only the small revision document until something is published', async () => {
    resetSiteStore();
    memory.clear();
    reads = 0;
    await startLoading(clientDb);
    expect(getState().status).toBe('ready');
    const firstReads = reads;
    expect(firstReads).toBeGreaterThan(0);

    // Second visit, nothing changed → served from the cache, no collection queries.
    resetSiteStore();
    await startLoading(clientDb);
    expect(reads).toBe(firstReads);
    expect(getState()).toMatchObject({ status: 'ready', refreshing: false });

    // Something is published → the revision moves → the next visit refetches.
    const latest = getState().data!.matches.sort((a, b) => (a.date < b.date ? 1 : -1))[0]!;
    await execute(store, planMatchStatus(await store.load(), latest.id, 'unpublish', ctx), ctx, true);
    resetSiteStore();
    await startLoading(clientDb);
    expect(reads).toBeGreaterThan(firstReads);
    expect(getState().data!.matches).toHaveLength(9);
  });
});
