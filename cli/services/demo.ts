/**
 * Fictional demo data: 12 invented players, 10 invented Monday matches and a
 * handful of invented articles. Every document is flagged `fictional: true`,
 * the site shows a DEMO banner while any exist, and `demo purge` removes
 * exactly those documents — nothing else — before launch.
 *
 * The data goes through the SAME publish pipeline as real results, and report
 * text is generated from the computed fact sheets, so the demo can never drift
 * from the numbers the site shows.
 */
import { addDays, weekdayOf } from '../../src/shared/dates';
import { buildMatchFacts, buildRoundupFacts, type MatchFacts } from '../../src/shared/facts';
import { SITE_SETTINGS_ID, type SiteSettings } from '../../src/shared/schema';
import { computeStats, statsFor } from '../../src/shared/stats';
import { freshSettings, MemoryStore, type Snapshot, type Store } from '../store';
import type { Ctx, Doc } from '../types';
import { planPublishArticle } from './articles';
import { op, nameLookup } from './common';
import { execute } from './execute';
import { planPublishMatch } from './matches';
import { planAddPlayer } from './players';
import { planSetFixture } from './settings';

export const DEMO_FIXTURE_NOTE = 'Demo fixture (fictional)';

const PLAYERS: { name: string; nickname?: string; bio?: string }[] = [
  { name: 'Marco Rinaldi', nickname: 'The Maestro', bio: 'Fictional demo player. Plays like he has somewhere better to be.' },
  { name: 'Danny Okafor', nickname: 'Big Dan', bio: 'Fictional demo player. Will pass to you. Will tell you about it afterwards.' },
  { name: 'Leo Hartmann', bio: 'Fictional demo player. Never walks when he can press.' },
  { name: 'Sami Haddad' },
  { name: 'Jack Whitlow', nickname: 'Whit' },
  { name: 'Tomás Beltrán' },
  { name: 'Kofi Mensah', bio: 'Fictional demo player. Left foot only, by choice.' },
  { name: 'Ravi Chandra' },
  { name: 'Eddie Marsh', nickname: 'Fast Eddie' },
  { name: 'Luca Ferreira' },
  { name: 'Ben Calloway' },
  { name: 'Yusuf Demir', bio: 'Fictional demo player. Joined mid-season and has not stopped scoring.' },
];

type Ev = { type: 'goal' | 'own_goal' | 'assist'; player: string | null; team?: string; assist?: string; minute?: number; count?: number };
interface WeekSpec {
  teams: [{ name: string; colour: string; players: string[] }, { name: string; colour: string; players: string[] }];
  score: [number, number];
  events: Ev[];
  potm?: string;
  venue?: string;
}

/** Oldest → newest. The last one gets minutes, linked assists and a full report. */
const WEEKS: WeekSpec[] = [
  { teams: [{ name: 'Red Team', colour: 'red', players: ['Marco', 'Danny', 'Leo', 'Sami', 'Jack'] }, { name: 'Blue Team', colour: 'blue', players: ['Tomás', 'Kofi', 'Ravi', 'Eddie', 'Luca'] }], score: [4, 2],
    events: [{ type: 'goal', player: 'Marco', count: 2 }, { type: 'goal', player: 'Leo' }, { type: 'goal', player: 'Sami' }, { type: 'goal', player: 'Kofi' }, { type: 'goal', player: 'Eddie' }, { type: 'assist', player: 'Danny', count: 2 }, { type: 'assist', player: 'Ravi' }], potm: 'Marco' },
  { teams: [{ name: 'Whites', colour: 'white', players: ['Marco', 'Kofi', 'Ben', 'Eddie', 'Jack'] }, { name: 'Blacks', colour: 'black', players: ['Danny', 'Leo', 'Ravi', 'Luca', 'Tomás'] }], score: [2, 2],
    events: [{ type: 'goal', player: 'Marco' }, { type: 'goal', player: 'Ben' }, { type: 'goal', player: 'Leo' }, { type: 'goal', player: 'Luca' }, { type: 'assist', player: 'Kofi' }, { type: 'assist', player: 'Danny' }], potm: 'Ben' },
  { teams: [{ name: 'Bibs', colour: 'yellow', players: ['Danny', 'Sami', 'Kofi', 'Luca', 'Ben'] }, { name: 'Skins', colour: 'grey', players: ['Marco', 'Leo', 'Jack', 'Ravi', 'Tomás'] }], score: [5, 1],
    events: [{ type: 'goal', player: 'Danny', count: 3 }, { type: 'goal', player: 'Kofi' }, { type: 'goal', player: 'Sami' }, { type: 'goal', player: 'Marco' }, { type: 'assist', player: 'Luca', count: 2 }, { type: 'assist', player: 'Ben' }], potm: 'Danny' },
  { teams: [{ name: 'Red Team', colour: 'red', players: ['Marco', 'Eddie', 'Ravi', 'Jack', 'Luca'] }, { name: 'Blue Team', colour: 'blue', players: ['Leo', 'Danny', 'Sami', 'Kofi', 'Tomás'] }], score: [1, 0],
    events: [{ type: 'goal', player: 'Eddie', assist: 'Marco' }], potm: 'Eddie' },
  { teams: [{ name: 'Greens', colour: 'green', players: ['Leo', 'Kofi', 'Tomás', 'Ben', 'Jack'] }, { name: 'Oranges', colour: 'orange', players: ['Marco', 'Danny', 'Sami', 'Eddie', 'Luca'] }], score: [3, 3],
    events: [{ type: 'goal', player: 'Leo', count: 2 }, { type: 'goal', player: 'Kofi', assist: 'Ben' }, { type: 'goal', player: 'Marco' }, { type: 'goal', player: 'Danny' }, { type: 'goal', player: null, team: 'Oranges' }], potm: 'Leo' },
  { teams: [{ name: 'Red Team', colour: 'red', players: ['Danny', 'Ravi', 'Sami', 'Tomás', 'Luca'] }, { name: 'Blue Team', colour: 'blue', players: ['Marco', 'Leo', 'Kofi', 'Eddie', 'Ben'] }], score: [0, 2],
    events: [{ type: 'goal', player: 'Leo' }, { type: 'own_goal', player: 'Tomás' }], potm: 'Leo' },
  { teams: [{ name: 'Red Team', colour: 'red', players: ['Marco', 'Danny', 'Yusuf', 'Sami', 'Jack'] }, { name: 'Blue Team', colour: 'blue', players: ['Leo', 'Kofi', 'Ravi', 'Eddie', 'Luca'] }], score: [3, 1],
    events: [{ type: 'goal', player: 'Marco' }, { type: 'goal', player: 'Yusuf', count: 2 }, { type: 'goal', player: 'Eddie' }, { type: 'assist', player: 'Danny', count: 2 }], potm: 'Yusuf' },
  { teams: [{ name: 'Whites', colour: 'white', players: ['Marco', 'Leo', 'Ravi', 'Tomás', 'Ben'] }, { name: 'Blacks', colour: 'black', players: ['Danny', 'Sami', 'Kofi', 'Yusuf', 'Eddie'] }], score: [2, 4],
    events: [{ type: 'goal', player: 'Marco' }, { type: 'goal', player: 'Leo' }, { type: 'goal', player: 'Yusuf', count: 2 }, { type: 'goal', player: 'Danny' }, { type: 'goal', player: 'Kofi' }, { type: 'assist', player: 'Eddie', count: 2 }, { type: 'assist', player: 'Ben' }], potm: 'Yusuf' },
  { teams: [{ name: 'Bibs', colour: 'yellow', players: ['Marco', 'Danny', 'Kofi', 'Tomás', 'Luca'] }, { name: 'Skins', colour: 'grey', players: ['Leo', 'Sami', 'Yusuf', 'Ravi', 'Jack'] }], score: [1, 1],
    events: [{ type: 'goal', player: 'Marco' }, { type: 'goal', player: 'Yusuf' }] },
  { teams: [{ name: 'Red Team', colour: 'red', players: ['Marco', 'Danny', 'Leo', 'Sami', 'Jack'] }, { name: 'Blue Team', colour: 'blue', players: ['Tomás', 'Kofi', 'Ravi', 'Eddie', 'Yusuf'] }], score: [3, 0],
    events: [{ type: 'goal', player: 'Marco', assist: 'Danny', minute: 12 }, { type: 'goal', player: 'Marco', minute: 31 }, { type: 'goal', player: 'Leo', minute: 47 }], potm: 'Marco', venue: 'Demo Pitch 2' },
];

const wk = (i: number) => ((i % 7) + 7) % 7;
void wk;

export function lastMondayBefore(today: string): string {
  const back = ((weekdayOf(today) + 6) % 7) || 7;
  return addDays(today, -back);
}
export function nextMondayOnOrAfter(today: string): string {
  const fwd = (8 - weekdayOf(today)) % 7;
  return addDays(today, fwd);
}

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Writes a report using only numbers from the fact sheet. */
function reportFromFacts(f: MatchFacts, flavour: { headline: string; opener: string }) {
  const scorers = f.scorers.map((s) => `${s.player}${s.goals > 1 ? ` (${s.goals})` : ''}`);
  const paragraphs: string[] = [flavour.opener];
  const winner = f.result.winnerName;
  paragraphs.push(
    winner
      ? `${winner} won ${f.result.line.replace(/–/g, '-')}. ${scorers.length ? `The goals came from ${list(scorers)}.` : ''}`
      : `Honours were even: ${f.result.line.replace(/–/g, '-')}. ${scorers.length ? `${list(scorers)} got the goals.` : ''}`,
  );
  const extras: string[] = [];
  for (const u of f.unknownScorerGoals) extras.push(`${u.count === 1 ? 'One' : u.count} of ${u.team}'s goals went down as scorer-unknown.`);
  for (const o of f.ownGoals) extras.push(`${o.player ?? 'An own goal'} found the wrong net, with the goal counting for ${o.creditedTo}.`);
  if (f.linkedAssists.length) extras.push(`Assists: ${list(f.linkedAssists)}.`);
  else if (f.assists.length) extras.push(`${list(f.assists.map((a) => `${a.player}${a.assists > 1 ? ` (${a.assists})` : ''}`))} provided the assists.`);
  if (extras.length) paragraphs.push(extras.join(' '));
  const notes = f.players.flatMap((p) => [
    ...(p.debut ? [`${p.name} made a first appearance.`] : []),
    ...(p.hatTrick ? [`${p.name} scored a hat-trick.`] : []),
    ...p.milestones.map((m) => `${p.name} reached a milestone: ${m}.`),
  ]);
  if (notes.length) paragraphs.push(`## Worth noting\n\n${notes.join(' ')}`);
  if (f.playerOfTheMatch) paragraphs.push(`${f.playerOfTheMatch} took the player of the match award.`);
  const lead = f.standings.topScorersSeason[0];
  if (lead) paragraphs.push(`${lead.player} leads the ${f.season} scoring chart on ${lead.goals}.`);
  paragraphs.push('*Demo data — this match report is fictional.*');
  return {
    title: flavour.headline,
    standfirst: `${f.result.line.replace(/–/g, '-')}${f.playerOfTheMatch ? `, with ${f.playerOfTheMatch} named player of the match` : ''}. Fictional demo match.`,
    body: paragraphs.join('\n\n'),
  };
}

export interface SeedResult {
  ok: boolean;
  lines: string[];
}

async function must<T extends { ok: boolean; errors: { message: string }[]; clarifications: { question: string }[]; warnings?: { code: string; message: string }[] }>(plan: T, what: string): Promise<T> {
  if (!plan.ok) {
    throw new Error(`Demo seed failed at ${what}: ${[...plan.errors.map((e) => e.message), ...plan.clarifications.map((c) => c.question)].join(' | ')}`);
  }
  return plan;
}

export async function seedDemo(store: Store, ctx: Ctx): Promise<SeedResult> {
  const lines: string[] = [];
  const snap0 = await store.load();
  if (snap0.players.some((p) => p.fictional)) {
    return { ok: false, lines: ['Demo data is already present. Run "demo purge --apply" first if you want to re-seed.'] };
  }
  if (snap0.matches.some((m) => !m.fictional)) {
    return { ok: false, lines: ['Real (non-fictional) matches exist. Demo data would pollute the real statistics, so seeding is refused.'] };
  }

  /* players -------------------------------------------------------------- */
  for (const p of PLAYERS) {
    const plan = await must(planAddPlayer(await store.load(), { ...p, fictional: true, instruction: 'demo seed' }, ctx), `player ${p.name}`);
    await execute(store, plan, ctx, true);
  }
  lines.push(`Created ${PLAYERS.length} fictional players.`);

  /* matches --------------------------------------------------------------- */
  const latest = lastMondayBefore(ctx.today);
  const flavour: Record<number, { headline: string; opener: string }> = {
    2: { headline: 'Danny hat-trick as Bibs run riot', opener: 'It was one-way traffic on Monday night as the Bibs put five past the Skins.' },
    6: { headline: 'Yusuf announces himself with a debut brace', opener: 'A new name entered the books on Monday night, and it did not take long for it to make an impression.' },
    9: { headline: 'Marco double keeps Red Team in front', opener: "Marco Rinaldi set the tone early as Red Team won again on Monday night." },
  };
  for (let i = 0; i < WEEKS.length; i++) {
    const w = WEEKS[i]!;
    const date = addDays(latest, -7 * (WEEKS.length - 1 - i));
    const base = {
      date,
      ...(w.venue ? { venue: w.venue } : {}),
      kickoff: '19:30',
      teams: { a: w.teams[0], b: w.teams[1] },
      score: { a: w.score[0], b: w.score[1] },
      events: w.events,
      ...(w.potm ? { playerOfTheMatch: w.potm } : {}),
      fictional: true,
      instruction: 'demo seed',
    };
    let spec: Record<string, unknown> = base;
    const f = flavour[i];
    if (f) {
      const dry = await must(planPublishMatch(await store.load(), base, ctx), `match ${date}`);
      spec = { ...base, report: reportFromFacts(dry.details.facts!, f) };
    }
    const plan = await must(planPublishMatch(await store.load(), spec, ctx), `match ${date}`);
    const bad = plan.warnings.filter((x) => x.code.startsWith('REPORT_'));
    if (bad.length) throw new Error(`Demo report for ${date} tripped the fact-check: ${bad.map((b) => b.message).join(' | ')}`);
    await execute(store, plan, ctx, true);
  }
  lines.push(`Published ${WEEKS.length} fictional matches (${addDays(latest, -7 * (WEEKS.length - 1))} → ${latest}) with 3 match reports.`);

  /* articles -------------------------------------------------------------- */
  const snap = await store.load();
  const nameOf = nameLookup(snap.players);
  const stats = computeStats(snap.matches);
  const yusuf = statsFor(stats, 'yusuf-demir');
  const danny = statsFor(stats, 'danny-okafor');
  const marco = statsFor(stats, 'marco-rinaldi');
  const roundup = buildRoundupFacts(latest, snap.matches, snap.players, null);
  void nameOf;

  const articles = [
    {
      title: `Yusuf Demir: ${yusuf.goals} goals in ${yusuf.appearances} games`,
      standfirst: 'The newest name in the books has barely stopped scoring since arriving.',
      category: 'spotlight',
      players: ['id:yusuf-demir'],
      body: `Some players ease into the group. Yusuf Demir did not.\n\nSince his first appearance on ${yusuf.firstAppearance} he has played ${yusuf.appearances} matches, scored ${yusuf.goals} goals, won ${yusuf.wins} of them and collected ${yusuf.potm} player of the match award${yusuf.potm === 1 ? '' : 's'}.\n\n## By the numbers\n\n- Goals per game: ${yusuf.goalsPerGame.toFixed(2)}\n- Win rate: ${yusuf.winPct.toFixed(0)}%\n- Form: ${yusuf.form.join(' ')}\n\n*Demo data — this article is fictional.*`,
    },
    {
      title: 'Records watch: the five-goal win that still stands',
      standfirst: 'A look at the biggest result in the books so far, and who is closing in on the scoring chart.',
      category: 'records',
      players: ['id:danny-okafor', 'id:marco-rinaldi'],
      body: `The biggest winning margin on record is four goals, set when the Bibs beat the Skins 5-1 with Danny Okafor scoring a hat-trick.\n\nDanny has ${danny.goals} goals and ${danny.assists} assists in ${danny.appearances} appearances. Marco Rinaldi is the leading scorer on ${marco.goals} from ${marco.appearances} games.\n\n> Records are made to be broken. Usually by the team that was already winning.\n\n*Demo data — this article is fictional.*`,
    },
    {
      title: 'Official statement from the bib bag',
      standfirst: 'It has been carried, thrown, sat on and left in a car boot. It would like a word.',
      category: 'humour',
      body: `We, the bibs, wish to place the following on record.\n\nWe are yellow. We are always yellow. Nobody has ever asked how we feel about it.\n\nWe have been:\n\n- Worn inside out to avoid a debate\n- Used as a goalpost\n- Declared "basically the same colour as the skins" by someone who was wrong\n\nWe ask only for a wash, an apology and to be handed out *before* the argument starts.\n\nYours in polyester, The Bibs.\n\n*Demo data — this article is entirely fictional, as are the bibs' feelings.*`,
    },
    {
      title: `Weekly roundup: ${roundup.matches[0]?.line.replace(/–/g, '-') ?? 'quiet week'}`,
      standfirst: 'The week in Monday night football, from the results to the scoring chart.',
      category: 'roundup',
      body: `${roundup.statements.join(' ')}\n\n## Scoring chart (${roundup.seasonLabel})\n\n${(roundup.leaderboards['Top scorers'] ?? []).map((r) => `- ${r.rank}. ${r.player} — ${r.value}`).join('\n')}\n\n${roundup.streaks.length ? `## Streaks\n\n${roundup.streaks.map((s) => `- ${s.player}: ${s.streak} wins in a row`).join('\n')}\n\n` : ''}*Demo data — this roundup is fictional.*`,
    },
  ];
  for (const a of articles) {
    const plan = await must(planPublishArticle(await store.load(), { ...a, fictional: true, instruction: 'demo seed' }, ctx), `article ${a.title}`);
    await execute(store, plan, ctx, true);
  }
  lines.push(`Published ${articles.length} fictional articles.`);

  /* fixture + flag -------------------------------------------------------------- */
  const fixture = planSetFixture(await store.load(), { date: nextMondayOnOrAfter(ctx.today), kickoff: '19:30', venue: 'Demo Pitch 2', note: DEMO_FIXTURE_NOTE }, ctx);
  await must(fixture, 'fixture');
  await execute(store, fixture, ctx, true);
  const cur = (await store.load()).settings!;
  await store.commit({
    opId: `demo_${ctx.now.getTime()}`,
    actor: ctx.actor,
    command: 'demo seed',
    now: ctx.now,
    ops: [op('settings', SITE_SETTINGS_ID, 'update', cur, { ...cur, demoData: true, updatedAt: ctx.now.toISOString() } satisfies SiteSettings, 'Marked site as containing demo data')],
  });
  lines.push(`Set the next fixture to ${nextMondayOnOrAfter(ctx.today)} 19:30 and switched on the DEMO banner.`);
  return { ok: true, lines };
}

/** Removes exactly the documents flagged fictional — and nothing else — in one reversible operation. */
export async function purgeDemo(store: Store, ctx: Ctx, apply: boolean): Promise<SeedResult & { counts: Record<string, number> }> {
  const snap = await store.load();
  const ops = [
    ...snap.matches.filter((m) => m.fictional).map((m) => op('matches', m.id, 'delete', m, null, `Purged demo match ${m.id}`)),
    ...snap.articles.filter((a) => a.fictional).map((a) => op('articles', a.id, 'delete', a, null, `Purged demo article ${a.id}`)),
    ...snap.players.filter((p) => p.fictional).map((p) => op('players', p.id, 'delete', p, null, `Purged demo player ${p.id}`)),
  ];
  const counts = {
    players: snap.players.filter((p) => p.fictional).length,
    matches: snap.matches.filter((m) => m.fictional).length,
    articles: snap.articles.filter((a) => a.fictional).length,
  };
  const realRemaining = {
    players: snap.players.length - counts.players,
    matches: snap.matches.length - counts.matches,
    articles: snap.articles.length - counts.articles,
  };
  const s = snap.settings;
  if (s && (s.demoData || s.nextFixture?.note === DEMO_FIXTURE_NOTE)) {
    ops.push(
      op('settings', SITE_SETTINGS_ID, 'update', s, { ...s, demoData: false, nextFixture: s.nextFixture?.note === DEMO_FIXTURE_NOTE ? null : s.nextFixture, updatedAt: ctx.now.toISOString() }, 'Switched off the demo banner'),
    );
  }
  const lines = [
    `${apply ? 'Removed' : 'Would remove'} ${counts.players} players, ${counts.matches} matches and ${counts.articles} articles flagged fictional.`,
    `Real data left untouched: ${realRemaining.players} players, ${realRemaining.matches} matches, ${realRemaining.articles} articles.`,
  ];
  if (apply && ops.length) {
    // Chunk to stay below Firestore's 500-write transaction limit (each op also writes an audit entry).
    for (let i = 0; i < ops.length; i += 150) {
      await store.commit({ opId: `purge_${ctx.now.getTime()}_${i / 150}`, actor: ctx.actor, command: 'demo purge', now: ctx.now, ops: ops.slice(i, i + 150) });
    }
  }
  return { ok: true, lines, counts };
}

/** Runs a seed against a throw-away copy of the data, to preview it. */
export async function seedDemoDryRun(realStore: Store, ctx: Ctx): Promise<SeedResult> {
  const snap: Snapshot = await realStore.load();
  const mem = new MemoryStore();
  for (const p of snap.players) mem.data.players.set(p.id, p as unknown as Doc);
  for (const m of snap.matches) mem.data.matches.set(m.id, m as unknown as Doc);
  for (const a of snap.articles) mem.data.articles.set(a.id, a as unknown as Doc);
  mem.data.settings.set(SITE_SETTINGS_ID, (snap.settings ?? freshSettings(ctx.now)) as unknown as Doc);
  return seedDemo(mem, ctx);
}

export { buildMatchFacts };
