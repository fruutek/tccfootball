import { participantIds } from '../../src/shared/events';
import { normaliseName } from '../../src/shared/ids';
import { articleSchema, matchSchema, playerSchema, siteSettingsSchema } from '../../src/shared/schema';
import { computeStats } from '../../src/shared/stats';
import { validateMatchContent, type Issue } from '../../src/shared/validate';
import type { Snapshot } from '../store';
import type { Ctx } from '../types';
import { fingerprintOf, nameLookup } from './common';

export interface IntegrityReport {
  ok: boolean;
  problems: Issue[];
  notes: string[];
  totals: { players: number; matches: number; publishedMatches: number; articles: number; goals: number; assists: number; appearances: number };
  table: { player: string; id: string; apps: number; goals: number; assists: number; w: number; d: number; l: number; potm: number }[];
}

/**
 * Re-derives every statistic from the raw matches and cross-checks the data.
 * Statistics are never stored, so there is nothing to "repair" — this proves
 * that the stored matches are internally consistent and that the engine's
 * output adds up.
 */
export function auditData(snap: Snapshot, ctx: Ctx): IntegrityReport {
  const problems: Issue[] = [];
  const notes: string[] = [];
  const bad = (code: string, message: string) => problems.push({ level: 'error', code, message });
  const nameOf = nameLookup(snap.players);
  const playerIds = new Set(snap.players.map((p) => p.id));

  /* players */
  const seenNames = new Map<string, string>();
  for (const p of snap.players) {
    const r = playerSchema.safeParse(p);
    if (!r.success) bad('PLAYER_SCHEMA', `players/${p.id}: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    const n = normaliseName(p.displayName);
    if (seenNames.has(n)) bad('PLAYER_NAME_DUPLICATE', `Players ${seenNames.get(n)} and ${p.id} share the display name "${p.displayName}".`);
    seenNames.set(n, p.id);
  }
  const firsts = new Map<string, string[]>();
  for (const p of snap.players) {
    const f = normaliseName(p.displayName).split(' ')[0] ?? '';
    firsts.set(f, [...(firsts.get(f) ?? []), p.displayName]);
  }
  for (const [f, names] of firsts) if (names.length > 1) notes.push(`"${f}" is the first name of ${names.join(', ')} — plain "${f}" is ambiguous when publishing results.`);

  /* matches */
  const fps = new Map<string, string>();
  for (const m of snap.matches) {
    const r = matchSchema.safeParse(m);
    if (!r.success) {
      bad('MATCH_SCHEMA', `matches/${m.id}: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      continue;
    }
    const v = validateMatchContent(m, { knownPlayerIds: playerIds, playerName: nameOf });
    for (const e of v.errors) bad(e.code, `matches/${m.id}: ${e.message}`);
    if (JSON.stringify(m.playerIds) !== JSON.stringify(participantIds(m))) bad('INDEX_MISMATCH', `matches/${m.id}: the derived playerIds index does not match the line-ups.`);
    if (m.fingerprint !== fingerprintOf(m)) bad('FINGERPRINT_MISMATCH', `matches/${m.id}: stored fingerprint does not match its content (edited outside the CLI?).`);
    const other = fps.get(fingerprintOf(m));
    if (other) bad('DUPLICATE_MATCH', `matches/${m.id} duplicates matches/${other} (identical result).`);
    fps.set(fingerprintOf(m), m.id);
    if (!m.id.startsWith(m.date)) notes.push(`matches/${m.id}: date is ${m.date} — the id keeps the original date by design (ids are stable).`);
  }

  /* articles */
  for (const a of snap.articles) {
    const r = articleSchema.safeParse(a);
    if (!r.success) bad('ARTICLE_SCHEMA', `articles/${a.id}: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    if (a.slug !== a.id) bad('ARTICLE_SLUG', `articles/${a.id}: slug "${a.slug}" differs from the document id.`);
    if (a.matchId && !snap.matches.some((m) => m.id === a.matchId)) bad('ARTICLE_ORPHAN', `articles/${a.id}: refers to missing match ${a.matchId}.`);
    for (const pid of a.playerIds ?? []) if (!playerIds.has(pid)) bad('ARTICLE_PLAYER', `articles/${a.id}: refers to missing player ${pid}.`);
    const m = a.matchId ? snap.matches.find((x) => x.id === a.matchId) : undefined;
    if (a.status === 'published' && m && m.status !== 'published') bad('ARTICLE_MATCH_HIDDEN', `articles/${a.id} is published but its match ${m.id} is not.`);
  }

  /* settings */
  if (!snap.settings) notes.push('settings/site does not exist yet — it is created by the first write.');
  else {
    const r = siteSettingsSchema.safeParse(snap.settings);
    if (!r.success) bad('SETTINGS_SCHEMA', `settings/site: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    if (snap.settings.nextFixture && snap.settings.nextFixture.date < ctx.today) notes.push(`The next fixture (${snap.settings.nextFixture.date}) is in the past — set a new one or clear it.`);
    const fict = snap.matches.some((m) => m.fictional) || snap.players.some((p) => p.fictional) || snap.articles.some((a) => a.fictional);
    if (fict !== snap.settings.demoData) bad('DEMO_FLAG', `settings.demoData is ${snap.settings.demoData} but fictional documents ${fict ? 'exist' : 'do not exist'}. Run "demo purge" or "demo seed".`);
  }

  /* statistics cross-checks */
  const published = snap.matches.filter((m) => m.status === 'published');
  const stats = computeStats(published);
  let goals = 0, assists = 0, apps = 0;
  for (const s of stats.values()) {
    goals += s.goals;
    assists += s.assists;
    apps += s.appearances;
    if (s.wins + s.draws + s.losses !== s.appearances) bad('STATS_WDL', `${nameOf(s.playerId)}: W+D+L (${s.wins + s.draws + s.losses}) ≠ appearances (${s.appearances}).`);
    if (!playerIds.has(s.playerId)) bad('STATS_UNKNOWN_PLAYER', `Statistics exist for unregistered player id "${s.playerId}".`);
  }
  const expectedGoals = published.reduce((n, m) => n + m.events.filter((e) => e.type === 'goal' && e.playerId !== null).length, 0);
  const expectedAssists = published.reduce((n, m) => n + m.events.filter((e) => (e.type === 'goal' && e.assistId) || e.type === 'assist').length, 0);
  const expectedApps = published.reduce((n, m) => n + participantIds(m).length, 0);
  if (goals !== expectedGoals) bad('STATS_GOALS', `Sum of player goals (${goals}) ≠ named goal events (${expectedGoals}).`);
  if (assists !== expectedAssists) bad('STATS_ASSISTS', `Sum of player assists (${assists}) ≠ assist events (${expectedAssists}).`);
  if (apps !== expectedApps) bad('STATS_APPS', `Sum of appearances (${apps}) ≠ sum of line-up sizes (${expectedApps}).`);
  const declared = published.reduce((n, m) => n + m.score.a + m.score.b, 0);
  const unknown = published.reduce((n, m) => n + m.events.filter((e) => e.type === 'goal' && e.playerId === null).length, 0);
  const own = published.reduce((n, m) => n + m.events.filter((e) => e.type === 'own_goal').length, 0);
  if (declared !== expectedGoals + unknown + own) bad('STATS_SCORE_SUM', `Total goals in scores (${declared}) ≠ named (${expectedGoals}) + unknown (${unknown}) + own goals (${own}).`);
  if (unknown) notes.push(`${unknown} goal(s) across all matches have an unknown scorer and are not credited to anyone.`);

  const table = [...stats.values()]
    .map((s) => ({ player: nameOf(s.playerId), id: s.playerId, apps: s.appearances, goals: s.goals, assists: s.assists, w: s.wins, d: s.draws, l: s.losses, potm: s.potm }))
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.player.localeCompare(b.player));

  return {
    ok: problems.length === 0,
    problems,
    notes,
    totals: { players: snap.players.length, matches: snap.matches.length, publishedMatches: published.length, articles: snap.articles.length, goals, assists, appearances: apps },
    table,
  };
}
