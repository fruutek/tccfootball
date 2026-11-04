import { daysBetween } from '../../src/shared/dates';
import { participantIds } from '../../src/shared/events';
import { buildMatchFacts, type MatchFacts } from '../../src/shared/facts';
import { matchIdFor } from '../../src/shared/ids';
import {
  matchSchema,
  articleSchema,
  SCHEMA_VERSION,
  type Article,
  type Match,
} from '../../src/shared/schema';
import { validateMatchContent } from '../../src/shared/validate';
import type { Snapshot } from '../store';
import type { Ctx, Plan, PlannedOp } from '../types';
import { matchToSpec, parseMatchSpec, resolveSpec, type MatchSpec, type ResolvedName } from '../spec';
import { defaultSlug, makeArticleDoc } from './articles';
import {
  contentKeyWithoutDate,
  describeMatch,
  err,
  fingerprintOf,
  formatStatChange,
  nameLookup,
  newPlan,
  op,
  seal,
  settingsOrDefault,
  statChanges,
  warn,
  type StatChange,
} from './common';
import { lintReport } from './lint';

export interface MatchDetails {
  matchId: string | null;
  match: string | null;
  resolved: ResolvedName[];
  changes: string[];
  statChanges: StatChange[];
  statChangeLines: string[];
  facts: MatchFacts | null;
  article: { slug: string; title: string; action: 'create' | 'update'; url: string } | null;
  linkedArticles: { slug: string; title: string; status: string }[];
  fixtureCleared: boolean;
  /** The edited-match spec so Claude can see exactly what is stored. */
  spec?: MatchSpec;
}

const emptyDetails = (): MatchDetails => ({
  matchId: null,
  match: null,
  resolved: [],
  changes: [],
  statChanges: [],
  statChangeLines: [],
  facts: null,
  article: null,
  linkedArticles: [],
  fixtureCleared: false,
});

const linkedReports = (snap: Snapshot, matchId: string): Article[] =>
  snap.articles.filter((a) => a.matchId === matchId && a.category === 'match-report');

function buildMatchDoc(
  content: NonNullable<ReturnType<typeof resolveSpec>['draft']>,
  spec: MatchSpec,
  id: string,
  ctx: Ctx,
  existing?: Match,
): Match {
  const now = ctx.now.toISOString();
  const fictional = spec.fictional ?? existing?.fictional ?? false;
  const doc: Match = {
    schemaVersion: SCHEMA_VERSION,
    id,
    status: existing?.status ?? 'published',
    date: content.date,
    ...(spec.kickoff ? { kickoff: spec.kickoff } : {}),
    ...(spec.venue ? { venue: spec.venue } : {}),
    teams: content.teams,
    score: content.score,
    events: content.events,
    playerOfTheMatch: content.playerOfTheMatch,
    playerIds: participantIds(content),
    fingerprint: fingerprintOf(content),
    ...(fictional ? { fictional: true as const } : {}),
    revision: (existing?.revision ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return doc;
}

/** Shared by publish and edit: resolves, validates and builds the match document. */
function prepare(
  snap: Snapshot,
  spec: MatchSpec,
  plan: Plan<MatchDetails>,
  ctx: Ctx,
  id: string,
  existing?: Match,
): Match | null {
  const res = resolveSpec(spec, snap.players);
  plan.details.resolved = res.resolved;
  plan.clarifications.push(...res.clarifications);
  plan.errors.push(...res.errors);
  if (!res.draft) return null;

  const nameOf = nameLookup(snap.players);
  const v = validateMatchContent(res.draft, {
    knownPlayerIds: new Set(snap.players.map((p) => p.id)),
    playerName: nameOf,
    today: ctx.today,
  });
  plan.errors.push(...v.errors);
  plan.warnings.push(...v.warnings);

  for (const pid of participantIds(res.draft)) {
    const p = snap.players.find((x) => x.id === pid);
    if (p?.status === 'archived') plan.warnings.push(warn('PLAYER_ARCHIVED', `${p.displayName} is archived but is listed in this match.`));
  }

  // --- duplicate protection ---
  const fp = fingerprintOf(res.draft);
  const others = snap.matches.filter((m) => m.id !== id);
  const dup = others.find((m) => fingerprintOf(m) === fp);
  if (dup) {
    plan.errors.push(
      err(
        'DUPLICATE_RESULT',
        `This is identical to the existing match ${dup.id} (${describeMatch(dup)}, ${dup.status}) — same date, line-ups, score and scorers. Nothing was written. ` +
          `To change details such as minutes, team names or player of the match, edit that match instead.`,
      ),
    );
  } else {
    const key = contentKeyWithoutDate(res.draft);
    const near = others.find((m) => contentKeyWithoutDate(m) === key && Math.abs(daysBetween(m.date, res.draft!.date)) <= 21);
    if (near) {
      plan.warnings.push(
        warn(
          'POSSIBLE_DUPLICATE',
          `Match ${near.id} (${describeMatch(near)}) has the same line-ups, score and scorers on a nearby date. If this is the same game with a mistyped date, edit that match instead.`,
        ),
      );
    }
  }
  if (plan.errors.length) return null;

  const doc = buildMatchDoc(res.draft, spec, id, ctx, existing);
  const check = matchSchema.safeParse(doc);
  if (!check.success) {
    plan.errors.push(...check.error.issues.map((i) => err('MATCH_INVALID', `${i.path.join('.')}: ${i.message}`)));
    return null;
  }
  return check.data;
}

function planReport(
  snap: Snapshot,
  match: Match,
  spec: MatchSpec,
  facts: MatchFacts,
  plan: Plan<MatchDetails>,
  ctx: Ctx,
): PlannedOp | null {
  const report = spec.report!;
  const existing = linkedReports(snap, match.id)[0];
  const slug = report.slug ?? existing?.id ?? defaultSlug(report.title, match.date);
  if (existing && report.slug && report.slug !== existing.id) {
    plan.errors.push(err('REPORT_SLUG_CHANGE', `The match already has a report at /news/${existing.id}; its slug cannot change. Omit "slug" to update it in place.`));
    return null;
  }
  const clash = snap.articles.find((a) => a.id === slug);
  if (clash && clash.id !== existing?.id) {
    plan.errors.push(err('SLUG_EXISTS', `An article already uses the slug "${slug}". Pass a different report.slug.`));
    return null;
  }
  plan.warnings.push(
    ...lintReport(report, facts, snap.players, new Set(match.playerIds)),
  );
  const doc = makeArticleDoc(
    slug,
    {
      title: report.title,
      standfirst: report.standfirst,
      body: report.body,
      category: 'match-report',
      author: report.author,
      featuredImage: report.featuredImage,
      matchId: match.id,
      playerIds: match.playerIds,
      fictional: match.fictional,
    },
    ctx,
    settingsOrDefault(snap.settings),
    existing,
  );
  const check = articleSchema.safeParse(doc);
  if (!check.success) {
    plan.errors.push(...check.error.issues.map((i) => err('REPORT_INVALID', `report.${i.path.join('.')}: ${i.message}`)));
    return null;
  }
  plan.details.article = { slug, title: doc.title, action: existing ? 'update' : 'create', url: `/news/${slug}` };
  return op('articles', slug, existing ? 'update' : 'create', existing ?? null, check.data, `${existing ? 'Updated' : 'Published'} match report "${doc.title}"`);
}

/* ================================================================= publish */

export function planPublishMatch(snap: Snapshot, input: unknown, ctx: Ctx): Plan<MatchDetails> {
  const plan = newPlan<MatchDetails>('match publish', emptyDetails());
  const parsed = parseMatchSpec(input);
  if (!parsed.spec) {
    plan.errors.push(...parsed.errors);
    return seal(plan);
  }
  const spec = parsed.spec;
  if (spec.instruction) plan.instruction = spec.instruction;

  const id = matchIdFor(spec.date, spec.sequence);
  plan.details.matchId = id;
  const existing = snap.matches.find((m) => m.id === id);
  if (existing) {
    plan.errors.push(
      err(
        'MATCH_EXISTS',
        `A match already exists for ${spec.date}${spec.sequence ? ` (game ${spec.sequence})` : ''}: ${describeMatch(existing)} [${existing.status}]. Nothing was written. ` +
          `To correct it use "match edit ${id}". If this is genuinely a second game that day, add "sequence": ${(spec.sequence ?? 1) + 1} to the request.`,
      ),
    );
    return seal(plan);
  }

  const match = prepare(snap, spec, plan, ctx, id);
  if (!match) return seal(plan);

  const after = [...snap.matches, match];
  plan.details.match = describeMatch(match);
  plan.details.statChanges = statChanges(snap.matches, after, snap.players);
  plan.details.statChangeLines = plan.details.statChanges.map(formatStatChange);
  const sm = settingsOrDefault(snap.settings).seasonStartMonth;
  const facts = buildMatchFacts(id, after, snap.players, { seasonStartMonth: sm });
  plan.details.facts = facts;

  plan.ops.push(op('matches', id, 'create', null, match, `Published ${describeMatch(match)}`));
  if (spec.report) {
    const reportOp = planReport(snap, match, spec, facts, plan, ctx);
    if (reportOp) plan.ops.push(reportOp);
  } else {
    plan.warnings.push(warn('NO_REPORT', 'No match report included. Write one from the fact sheet and add it as "report" (title, standfirst, body), or publish without one.'));
  }

  // A played fixture is no longer "next".
  const nf = snap.settings?.nextFixture;
  if (snap.settings && nf && nf.date <= match.date) {
    plan.details.fixtureCleared = true;
    plan.ops.push(op('settings', 'site', 'update', snap.settings, { ...snap.settings, nextFixture: null, updatedAt: ctx.now.toISOString() }, `Cleared next fixture (${nf.date}) — it has been played`));
  }
  plan.summary = `Publish ${describeMatch(match)}${spec.report ? ' with match report' : ''}`;
  return seal(plan);
}

/* ==================================================================== edit */

export function planEditMatch(snap: Snapshot, matchId: string, input: unknown, ctx: Ctx): Plan<MatchDetails> {
  const plan = newPlan<MatchDetails>('match edit', { ...emptyDetails(), matchId });
  const existing = snap.matches.find((m) => m.id === matchId);
  if (!existing) {
    plan.errors.push(err('MATCH_NOT_FOUND', `No match with id "${matchId}". Recent ids: ${snap.matches.map((m) => m.id).sort().slice(-5).join(', ') || '(none)'}.`));
    return seal(plan);
  }
  const parsed = parseMatchSpec(input);
  if (!parsed.spec) {
    plan.errors.push(...parsed.errors);
    return seal(plan);
  }
  const spec = parsed.spec;
  if (spec.instruction) plan.instruction = spec.instruction;

  const match = prepare(snap, spec, plan, ctx, matchId, existing);
  if (!match) return seal(plan);

  /* what changed, in words */
  const before = matchToSpec(existing, snap.players);
  const changes: string[] = [];
  if (existing.date !== match.date) changes.push(`date ${existing.date} → ${match.date} (the match id stays "${matchId}")`);
  if (existing.score.a !== match.score.a || existing.score.b !== match.score.b)
    changes.push(`score ${existing.score.a}–${existing.score.b} → ${match.score.a}–${match.score.b}`);
  for (const k of ['a', 'b'] as const) {
    if (existing.teams[k].name !== match.teams[k].name) changes.push(`team ${k.toUpperCase()} name "${existing.teams[k].name}" → "${match.teams[k].name}"`);
    if (existing.teams[k].colour !== match.teams[k].colour) changes.push(`team ${k.toUpperCase()} colour ${existing.teams[k].colour} → ${match.teams[k].colour}`);
    if (JSON.stringify([...existing.teams[k].playerIds].sort()) !== JSON.stringify([...match.teams[k].playerIds].sort())) changes.push(`${match.teams[k].name} line-up changed`);
  }
  if (JSON.stringify(existing.events) !== JSON.stringify(match.events)) changes.push('goals / assists changed');
  if (existing.playerOfTheMatch !== match.playerOfTheMatch) changes.push(`player of the match ${existing.playerOfTheMatch ?? 'none'} → ${match.playerOfTheMatch ?? 'none'}`);
  if ((existing.venue ?? '') !== (match.venue ?? '')) changes.push('venue changed');
  if ((existing.kickoff ?? '') !== (match.kickoff ?? '')) changes.push('kick-off time changed');
  plan.details.changes = changes;
  plan.details.spec = before;

  const sameDay = snap.matches.find((m) => m.id !== matchId && m.date === match.date);
  if (sameDay && existing.date !== match.date) {
    plan.warnings.push(warn('SAME_DAY_OTHER_MATCH', `Another match (${sameDay.id}) is already on ${match.date}.`));
  }

  const hasReportChange = Boolean(spec.report);
  if (changes.length === 0 && !hasReportChange) {
    plan.errors.push(err('NO_CHANGES', 'The edited match is identical to what is already stored. Nothing to do.'));
    return seal(plan);
  }

  const after = snap.matches.map((m) => (m.id === matchId ? match : m));
  plan.details.match = describeMatch(match);
  plan.details.statChanges = statChanges(snap.matches, after, snap.players);
  plan.details.statChangeLines = plan.details.statChanges.map(formatStatChange);

  plan.ops.push(op('matches', matchId, 'update', existing, match, `Edited ${describeMatch(match)}: ${changes.join('; ') || 'report only'}`));

  const reports = linkedReports(snap, matchId);
  plan.details.linkedArticles = reports.map((a) => ({ slug: a.id, title: a.title, status: a.status }));
  if (match.status === 'published') {
    const facts = buildMatchFacts(matchId, after, snap.players, { seasonStartMonth: settingsOrDefault(snap.settings).seasonStartMonth });
    plan.details.facts = facts;
    if (spec.report) {
      const reportOp = planReport(snap, match, spec, facts, plan, ctx);
      if (reportOp) plan.ops.push(reportOp);
    }
  }
  const factual = existing.fingerprint !== match.fingerprint || existing.playerOfTheMatch !== match.playerOfTheMatch;
  if (factual && reports.length && !spec.report) {
    plan.warnings.push(
      warn(
        'REPORT_STALE',
        `The factual content changed, but the match report "${reports[0]!.title}" (/news/${reports[0]!.id}) still describes the old result. Rewrite it from the new fact sheet and pass it as "report".`,
      ),
    );
  }
  plan.summary = `Edit ${describeMatch(match)} — ${changes.join('; ') || 'match report'}`;
  return seal(plan);
}

/* ============================================== unpublish / republish / delete */

export function planMatchStatus(
  snap: Snapshot,
  matchId: string,
  action: 'unpublish' | 'republish' | 'delete',
  ctx: Ctx,
): Plan<MatchDetails> {
  const plan = newPlan<MatchDetails>(`match ${action}`, { ...emptyDetails(), matchId });
  const m = snap.matches.find((x) => x.id === matchId);
  if (!m) {
    plan.errors.push(err('MATCH_NOT_FOUND', `No match with id "${matchId}".`));
    return seal(plan);
  }
  plan.details.match = describeMatch(m);
  const reports = linkedReports(snap, matchId);
  plan.details.linkedArticles = reports.map((a) => ({ slug: a.id, title: a.title, status: a.status }));
  const now = ctx.now.toISOString();

  let after: Match[];
  if (action === 'delete') {
    after = snap.matches.filter((x) => x.id !== matchId);
    plan.ops.push(op('matches', matchId, 'delete', m, null, `Deleted ${describeMatch(m)}`));
    for (const a of reports) plan.ops.push(op('articles', a.id, 'delete', a, null, `Deleted match report "${a.title}" along with its match`));
  } else {
    const status = action === 'unpublish' ? 'unpublished' : 'published';
    if (m.status === status) {
      plan.errors.push(err('NO_CHANGE', `Match ${matchId} is already ${status}.`));
      return seal(plan);
    }
    const next: Match = { ...m, status, revision: m.revision + 1, updatedAt: now };
    after = snap.matches.map((x) => (x.id === matchId ? next : x));
    plan.ops.push(op('matches', matchId, 'update', m, next, `${action === 'unpublish' ? 'Unpublished' : 'Republished'} ${describeMatch(m)}`));
    if (action === 'unpublish') {
      for (const a of reports.filter((r) => r.status === 'published')) {
        plan.ops.push(op('articles', a.id, 'update', a, { ...a, status: 'unpublished', revision: a.revision + 1, updatedAt: now }, `Unpublished match report "${a.title}" along with its match`));
      }
    } else if (reports.some((r) => r.status === 'unpublished')) {
      plan.warnings.push(warn('REPORT_STILL_UNPUBLISHED', `The match report (${reports.map((r) => `/news/${r.id}`).join(', ')}) is still unpublished. Run "article republish <slug>" to bring it back.`));
    }
  }
  plan.details.statChanges = statChanges(snap.matches, after, snap.players);
  plan.details.statChangeLines = plan.details.statChanges.map(formatStatChange);
  plan.summary = `${action[0]!.toUpperCase()}${action.slice(1)} ${describeMatch(m)}${plan.ops.length > 1 ? ` and ${plan.ops.length - 1} linked report(s)` : ''}`;
  return seal(plan);
}
