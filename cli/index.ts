#!/usr/bin/env tsx
/**
 * mnf — the Monday Night Football publishing CLI.
 *
 * Every command that changes data is a DRY RUN until you add --apply.
 * Run `npm run mnf -- help` for the command list.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { todayIn } from '../src/shared/dates';
import { buildMatchFacts, buildRoundupFacts } from '../src/shared/facts';
import { buildLeaderboard, LEADERBOARDS, LEADERBOARD_ORDER, minAppearancesFor, type LeaderboardKey } from '../src/shared/leaderboards';
import { resolveName } from '../src/shared/names';
import { parsePeriod, periodKey } from '../src/shared/seasons';
import { computeStats, matchesForPeriod, startingTotalsOf, statsFor } from '../src/shared/stats';
import { connect, SetupError } from './firebase';
import { preparePhoto } from './images';
import { renderOutcome, table } from './render';
import { planArticleStatus, planPublishArticle } from './services/articles';
import { planRevert } from './services/audit';
import { purgeDemo, seedDemo, seedDemoDryRun } from './services/demo';
import { execute } from './services/execute';
import { auditData } from './services/integrity';
import { describeMatch, nameLookup, settingsOrDefault } from './services/common';
import { planEditMatch, planMatchStatus, planPublishMatch } from './services/matches';
import { planAddPlayer, planAddPlayers, planUpdatePlayer, planUpdatePlayers } from './services/players';
import { planClearFixture, planSetFixture, planSetSettings, SETTINGS_KEYS } from './services/settings';
import { matchToSpec } from './spec';
import type { Ctx, Outcome, Plan } from './types';

const HELP = `mnf — Monday Night Football publishing CLI

Everything that writes is a DRY RUN until you add --apply.

READ
  status                              connection, counts, latest result
  players                             list players with headline stats
  player show <name>                  one player's profile, stats and recent matches
  match list [--limit N]              recent matches
  match show <id> [--spec]            a match (--spec: the editable name-based JSON)
  article list | article show <slug>
  stats show [--period P] [--board B] leaderboards. P = all | season:2026 | month:2026-11
  stats audit [--table]               recompute everything from the matches and cross-check
  facts match <id>                    fact sheet for writing a match report
  facts roundup [--week YYYY-MM-DD]   fact sheet for a weekly roundup
  audit [--limit N]                   recent changes (who/what/when), with operation ids

WRITE  (add --apply to commit)
  match publish  (--file F | --stdin)         publish a new result (+ optional report)
  match edit <id> (--file F | --stdin)        correct a published result
  match unpublish|republish|delete <id>
  player add --name "Full Name" [--nickname N] [--alias A]... [--bio TEXT] [--starting-goals N] [--starting-assists N]
  player update-many (--file F | --stdin)     change many players at once: {"updates":[{"player":"Peter","startingTotals":{"appearances":4,"goals":3}}, …]}
  player add-many (--file F | --stdin)        a whole roster at once: {"players":[{"name":"Peter","startingTotals":{"goals":3}}, …]}
  player update <name> [--display-name N] [--nickname N|--clear-nickname] [--add-alias A] [--remove-alias A]
                       [--bio T|--clear-bio] [--starting-appearances N] [--starting-goals N] [--starting-assists N] [--clear-starting-totals] [--photo FILE|--photo-path /photos/x.webp|--remove-photo] [--archive|--unarchive]
  photo prepare <player-id> <image-file>      optimise a photo into public/photos/ (needs no database access)
  article publish (--file F | --stdin)        publish an article (category, title, standfirst, body …)
  article edit    (--file F | --stdin)        update an existing article (spec.slug required)
  article unpublish|republish|delete <slug>
  fixture set --date YYYY-MM-DD [--kickoff HH:MM] [--venue V] [--note N]
  fixture clear
  settings set key=value ...                  keys: ${SETTINGS_KEYS.join(', ')}
  revert <opId> [--force]                     undo a whole earlier operation
  demo seed | demo purge                      fictional test data (flagged, removable)

GLOBAL FLAGS
  --apply   commit the change        --json   machine-readable output
  --project ID                       --instruction "…"  keep the user's message in the audit log
`;

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    apply: { type: 'boolean' },
    json: { type: 'boolean' },
    file: { type: 'string' },
    stdin: { type: 'boolean' },
    project: { type: 'string' },
    instruction: { type: 'string' },
    force: { type: 'boolean' },
    spec: { type: 'boolean' },
    table: { type: 'boolean' },
    limit: { type: 'string' },
    period: { type: 'string' },
    board: { type: 'string' },
    week: { type: 'string' },
    name: { type: 'string' },
    'display-name': { type: 'string' },
    nickname: { type: 'string' },
    'clear-nickname': { type: 'boolean' },
    alias: { type: 'string', multiple: true },
    'add-alias': { type: 'string', multiple: true },
    'remove-alias': { type: 'string', multiple: true },
    bio: { type: 'string' },
    'clear-bio': { type: 'boolean' },
    photo: { type: 'string' },
    'photo-path': { type: 'string' },
    'starting-appearances': { type: 'string' },
    'starting-goals': { type: 'string' },
    'starting-assists': { type: 'string' },
    'clear-starting-totals': { type: 'boolean' },
    'remove-photo': { type: 'boolean' },
    archive: { type: 'boolean' },
    unarchive: { type: 'boolean' },
    fictional: { type: 'boolean' },
    date: { type: 'string' },
    kickoff: { type: 'string' },
    venue: { type: 'string' },
    note: { type: 'string' },
  },
});

const apply = Boolean(flags['apply']);
const asJson = Boolean(flags['json']);

function readInput(): unknown {
  let raw: string;
  if (flags['file']) raw = readFileSync(String(flags['file']), 'utf8');
  else if (flags['stdin']) raw = readFileSync(0, 'utf8');
  else throw new UsageError('Provide the request as JSON with --file <path> or --stdin.');
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (flags['instruction'] && typeof data === 'object' && data && !('instruction' in data)) data['instruction'] = flags['instruction'];
    return data;
  } catch (e) {
    throw new UsageError(`The request is not valid JSON: ${(e as Error).message}`);
  }
}

class UsageError extends Error {
  override name = 'UsageError';
}

function emit(text: string) {
  process.stdout.write(`${text}\n`);
}

async function main(): Promise<number> {
  const [group, action, ...rest] = positionals;
  if (!group || group === 'help') {
    emit(HELP);
    return 0;
  }

  // Photo preparation touches only local files, so it needs no database connection.
  if (group === 'photo' && action === 'prepare') {
    const [playerId, file] = rest;
    if (!playerId || !file) throw new UsageError('Usage: photo prepare <player-id> <image-file>');
    const prepared = await preparePhoto(file, playerId);
    prepared.write();
    emit(`✔ Optimised ${Math.round(prepared.bytes / 1024)} KB → public${prepared.publicPath}\nNext: commit and push it so Hosting serves it, then attach it to the profile:\n  player update <name> --photo-path ${prepared.publicPath} --apply`);
    return 0;
  }

  const conn = connect(flags['project'] ? { project: String(flags['project']) } : {});
  const { store } = conn;
  const today = process.env['MNF_TODAY'] ?? todayIn(process.env['MNF_TIMEZONE'] ?? 'Europe/London');
  const ctx: Ctx = { now: new Date(), today, actor: process.env['MNF_ACTOR'] ?? 'claude-code' };
  const arg = (i = 0) => {
    const v = rest[i];
    if (!v) throw new UsageError(`Missing argument. Run "help" for usage.`);
    return v;
  };

  const finish = async <D>(plan: Plan<D>, extra: { markReverted?: string[] } = {}): Promise<number> => {
    const outcome = await execute(store, plan, ctx, apply, extra);
    if (asJson) emit(JSON.stringify({ target: store.label, applied: outcome.applied, opId: outcome.opId, plan }, null, 2));
    else emit(renderOutcome(outcome as Outcome, store.label, apply));
    return plan.ok ? 0 : 2;
  };

  const snap = await store.load();
  const nameOf = nameLookup(snap.players);
  const settings = settingsOrDefault(snap.settings);

  switch (group) {
    /* ------------------------------------------------------------ read */
    case 'status': {
      const published = snap.matches.filter((m) => m.status === 'published');
      const latest = [...published].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      emit(`Target:   ${store.label}`);
      emit(`Today:    ${today}`);
      emit(`Players:  ${snap.players.length}   Matches: ${snap.matches.length} (${published.length} published)   Articles: ${snap.articles.length}`);
      emit(`Latest:   ${latest ? `${describeMatch(latest)} [${latest.id}]` : '(no matches yet)'}`);
      emit(`Fixture:  ${snap.settings?.nextFixture ? `${snap.settings.nextFixture.date} ${snap.settings.nextFixture.kickoff ?? ''}` : '(none set)'}`);
      emit(`Demo data: ${snap.settings?.demoData ? 'YES — run "demo purge --apply" before launch' : 'no'}`);
      emit(`Data revision: ${snap.settings?.dataRevision ?? '(settings not created yet)'}`);
      return 0;
    }
    case 'players':
    case 'player': {
      if (group === 'players' || action === 'list' || !action) {
        const stats = computeStats(snap.matches, { startingTotals: startingTotalsOf(snap.players) });
        const rows = [...snap.players]
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
          .map((p) => {
            const s = statsFor(stats, p.id);
            return [p.id, p.displayName + (p.fictional ? ' [DEMO]' : ''), p.nickname ?? '', String(s.totalAppearances), String(s.goals), String(s.assists), p.status];
          });
        emit(rows.length ? table(rows, ['id', 'name', 'nickname', 'apps', 'goals', 'assists', 'status']) : '(no players yet — add one with "player add --name …")');
        return 0;
      }
      if (action === 'show') {
        const r = resolveName(arg(), snap.players);
        if (r.kind !== 'resolved') {
          emit(r.kind === 'ambiguous' ? `Ambiguous: ${r.candidates.map((c) => `${c.displayName} (id:${c.playerId})`).join(' or ')}` : `No player called "${arg()}".${r.suggestions.length ? ` Did you mean ${r.suggestions.map((s) => s.displayName).join(' or ')}?` : ''}`);
          return 2;
        }
        const p = snap.players.find((x) => x.id === r.playerId)!;
        const s = statsFor(computeStats(snap.matches, { formLength: settings.formLength, startingTotals: startingTotalsOf(snap.players) }), p.id);
        emit(JSON.stringify({ player: p, stats: { ...s, history: s.history.slice(0, 10) } }, null, 2));
        return 0;
      }
      if (action === 'add') {
        const body = flags['name']
          ? {
              name: String(flags['name']),
              ...(flags['nickname'] ? { nickname: String(flags['nickname']) } : {}),
              ...(flags['alias'] ? { aliases: flags['alias'] as string[] } : {}),
              ...(flags['bio'] ? { bio: String(flags['bio']) } : {}),
              ...(flags['starting-appearances'] || flags['starting-goals'] || flags['starting-assists']
                ? { startingTotals: { ...(flags['starting-appearances'] ? { appearances: Number(flags['starting-appearances']) } : {}), ...(flags['starting-goals'] ? { goals: Number(flags['starting-goals']) } : {}), ...(flags['starting-assists'] ? { assists: Number(flags['starting-assists']) } : {}) } }
                : {}),
              ...(flags['fictional'] ? { fictional: true } : {}),
              ...(flags['instruction'] ? { instruction: String(flags['instruction']) } : {}),
            }
          : readInput();
        return finish(planAddPlayer(snap, body, ctx));
      }
      if (action === 'add-many') return finish(planAddPlayers(snap, readInput(), ctx));
      if (action === 'update-many') return finish(planUpdatePlayers(snap, readInput(), ctx));
      if (action === 'update') {
        const ref = arg();
        const patch: Record<string, unknown> = {};
        if (flags['display-name']) patch['displayName'] = String(flags['display-name']);
        if (flags['nickname']) patch['nickname'] = String(flags['nickname']);
        if (flags['clear-nickname']) patch['nickname'] = null;
        if (flags['add-alias']) patch['addAliases'] = flags['add-alias'];
        if (flags['remove-alias']) patch['removeAliases'] = flags['remove-alias'];
        if (flags['bio']) patch['bio'] = String(flags['bio']);
        if (flags['clear-bio']) patch['bio'] = null;
        if (flags['starting-appearances'] || flags['starting-goals'] || flags['starting-assists']) {
          patch['startingTotals'] = {
            ...(flags['starting-appearances'] ? { appearances: Number(flags['starting-appearances']) } : {}),
            ...(flags['starting-goals'] ? { goals: Number(flags['starting-goals']) } : {}),
            ...(flags['starting-assists'] ? { assists: Number(flags['starting-assists']) } : {}),
          };
        }
        if (flags['clear-starting-totals']) patch['startingTotals'] = null;
        if (flags['archive']) patch['status'] = 'archived';
        if (flags['unarchive']) patch['status'] = 'active';
        if (flags['instruction']) patch['instruction'] = String(flags['instruction']);
        let prepared: Awaited<ReturnType<typeof preparePhoto>> | null = null;
        if (flags['photo']) {
          const r = resolveName(ref, snap.players);
          if (r.kind !== 'resolved') return finish(planUpdatePlayer(snap, ref, patch, ctx));
          prepared = await preparePhoto(String(flags['photo']), r.playerId);
          patch['photo'] = prepared.publicPath;
        }
        if (flags['photo-path']) patch['photo'] = String(flags['photo-path']);
        if (flags['remove-photo']) patch['photo'] = null;
        const plan = planUpdatePlayer(snap, ref, patch, ctx);
        const code = await finish(plan);
        if (prepared && apply && plan.ok) {
          prepared.write();
          emit(`Photo saved to public${prepared.publicPath} (${Math.round(prepared.bytes / 1024)} KB). It is served by Firebase Hosting, so commit and push it to deploy:\n  git add public/photos && git commit -m "Add photo for ${nameOf(plan.details.playerId ?? '')}" && git push\nUntil that deploy finishes the site shows the placeholder avatar.`);
        } else if (prepared && !apply) {
          emit(`(dry run) Photo would be optimised to ${Math.round(prepared.bytes / 1024)} KB at public${prepared.publicPath}`);
        }
        return code;
      }
      break;
    }
    case 'match': {
      if (action === 'list') {
        const n = Number(flags['limit'] ?? 15);
        const rows = [...snap.matches]
          .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1))
          .slice(0, n)
          .map((m) => [m.id, describeMatch(m), m.status + (m.fictional ? ' [DEMO]' : ''), m.playerOfTheMatch ? `POTM ${nameOf(m.playerOfTheMatch)}` : '']);
        emit(rows.length ? table(rows, ['id', 'result', 'status', 'potm']) : '(no matches yet)');
        return 0;
      }
      if (action === 'show') {
        const m = snap.matches.find((x) => x.id === arg());
        if (!m) {
          emit(`No match "${arg()}".`);
          return 2;
        }
        emit(JSON.stringify(flags['spec'] ? matchToSpec(m, snap.players) : m, null, 2));
        return 0;
      }
      if (action === 'publish') return finish(planPublishMatch(snap, readInput(), ctx));
      if (action === 'edit') return finish(planEditMatch(snap, arg(), readInput(), ctx));
      if (action === 'unpublish' || action === 'republish' || action === 'delete') return finish(planMatchStatus(snap, arg(), action, ctx));
      break;
    }
    case 'article': {
      if (action === 'list') {
        const rows = [...snap.articles].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1)).map((a) => [a.id, a.category, a.status + (a.fictional ? ' [DEMO]' : ''), a.publishedAt.slice(0, 10), a.title]);
        emit(rows.length ? table(rows, ['slug', 'category', 'status', 'date', 'title']) : '(no articles yet)');
        return 0;
      }
      if (action === 'show') {
        const a = snap.articles.find((x) => x.id === arg());
        emit(a ? JSON.stringify(a, null, 2) : `No article "${arg()}".`);
        return a ? 0 : 2;
      }
      if (action === 'publish') return finish(planPublishArticle(snap, readInput(), ctx));
      if (action === 'edit') return finish(planPublishArticle(snap, readInput(), ctx, { update: true }));
      if (action === 'unpublish' || action === 'republish' || action === 'delete') return finish(planArticleStatus(snap, arg(), action, ctx));
      break;
    }
    case 'fixture': {
      if (action === 'set') {
        const body = flags['date']
          ? {
              date: String(flags['date']),
              ...(flags['kickoff'] ? { kickoff: String(flags['kickoff']) } : {}),
              ...(flags['venue'] ? { venue: String(flags['venue']) } : {}),
              ...(flags['note'] ? { note: String(flags['note']) } : {}),
            }
          : readInput();
        return finish(planSetFixture(snap, body, ctx));
      }
      if (action === 'clear') return finish(planClearFixture(snap, ctx));
      break;
    }
    case 'settings': {
      if (action === 'show') {
        emit(JSON.stringify(snap.settings, null, 2));
        return 0;
      }
      if (action === 'set') {
        const patch: Record<string, unknown> = {};
        for (const kv of rest) {
          const i = kv.indexOf('=');
          if (i < 1) throw new UsageError(`Use key=value, e.g. seasonStartMonth=8 (got "${kv}")`);
          patch[kv.slice(0, i)] = kv.slice(i + 1);
        }
        return finish(planSetSettings(snap, patch, ctx));
      }
      break;
    }
    case 'stats': {
      if (action === 'audit') {
        const r = auditData(snap, ctx);
        if (asJson) emit(JSON.stringify(r, null, 2));
        else {
          emit(`Target: ${store.label}`);
          emit(`Checked ${r.totals.matches} matches (${r.totals.publishedMatches} published), ${r.totals.players} players, ${r.totals.articles} articles.`);
          emit(`Derived totals: ${r.totals.appearances} appearances, ${r.totals.goals} goals, ${r.totals.assists} assists.`);
          for (const p of r.problems) emit(`  ✖ [${p.code}] ${p.message}`);
          for (const n of r.notes) emit(`  ℹ ${n}`);
          if (flags['table'] && r.table.length) emit(`\n${table(r.table.map((t) => [t.player, String(t.apps), String(t.goals), String(t.assists), `${t.w}-${t.d}-${t.l}`, String(t.potm)]), ['player', 'apps', 'goals', 'assists', 'W-D-L', 'potm'])}`);
          emit(r.ok ? '\n✔ AUDIT PASSED — every statistic is derived from consistent match records.' : `\n✖ AUDIT FAILED — ${r.problems.length} problem(s). Fix the data (edit the match) before publishing more.`);
        }
        return r.ok ? 0 : 2;
      }
      if (action === 'show') {
        const period = parsePeriod(flags['period'] ? String(flags['period']) : null);
        const inPeriod = matchesForPeriod(snap.matches, period, settings.seasonStartMonth);
        const stats = computeStats(snap.matches, { period, seasonStartMonth: settings.seasonStartMonth, formLength: settings.formLength, startingTotals: startingTotalsOf(snap.players) });
        const min = minAppearancesFor(inPeriod.length, settings.minAppearances);
        const keys = flags['board'] ? [String(flags['board']) as LeaderboardKey] : LEADERBOARD_ORDER;
        emit(`Period: ${periodKey(period)}  (${inPeriod.length} matches; rate boards need ≥${min} appearances)`);
        for (const key of keys) {
          const def = LEADERBOARDS[key];
          if (!def) throw new UsageError(`Unknown board "${key}". Options: ${LEADERBOARD_ORDER.join(', ')}`);
          const rows = buildLeaderboard(stats.values(), key, { minAppearances: min, nameOf }).slice(0, 8);
          emit(`\n${def.label} — ${def.blurb}`);
          emit(rows.length ? rows.map((r) => `  ${String(r.rank).padStart(2)}${r.tied ? '=' : ' '} ${nameOf(r.stats.playerId).padEnd(18)} ${def.format(r.value)}`).join('\n') : '  (nobody qualifies yet)');
        }
        return 0;
      }
      break;
    }
    case 'facts': {
      if (action === 'match') {
        emit(JSON.stringify(buildMatchFacts(arg(), snap.matches, snap.players, { seasonStartMonth: settings.seasonStartMonth }), null, 2));
        return 0;
      }
      if (action === 'roundup') {
        const week = flags['week'] ? String(flags['week']) : (snap.matches.filter((m) => m.status === 'published').map((m) => m.date).sort().at(-1) ?? today);
        emit(JSON.stringify(buildRoundupFacts(week, snap.matches, snap.players, snap.settings?.nextFixture ?? null, { seasonStartMonth: settings.seasonStartMonth }), null, 2));
        return 0;
      }
      break;
    }
    case 'audit': {
      const n = Number(action && /^\d+$/.test(action) ? action : flags['limit'] ?? 15);
      const rows = (await store.listAudit({ limit: n })).map((e) => [e.opId, e.at.slice(0, 16).replace('T', ' '), `${e.collection}/${e.docId}`, e.action + (e.revertedBy ? ' (reverted)' : ''), e.summary.slice(0, 70)]);
      emit(rows.length ? table(rows, ['operation', 'when (UTC)', 'document', 'action', 'summary']) : '(no changes recorded yet)');
      return 0;
    }
    case 'revert': {
      const opId = action ?? '';
      if (!opId) throw new UsageError('Usage: revert <opId> [--apply]. Find ids with "audit".');
      const entries = await store.listAudit({ opId });
      const plan = planRevert(snap, entries, opId, ctx, { force: Boolean(flags['force']) });
      return finish(plan, { markReverted: plan.details.entryIds });
    }
    case 'demo': {
      if (action === 'seed') {
        const r = apply ? await seedDemo(store, ctx) : await seedDemoDryRun(store, ctx);
        emit(`Target: ${store.label}\n${apply ? '' : '(dry run — nothing written; add --apply)\n'}${r.lines.join('\n')}`);
        return r.ok ? 0 : 2;
      }
      if (action === 'purge') {
        const r = await purgeDemo(store, ctx, apply);
        emit(`Target: ${store.label}\n${apply ? '' : '(dry run — nothing removed; add --apply)\n'}${r.lines.join('\n')}`);
        return 0;
      }
      break;
    }
  }
  throw new UsageError(`Unknown command: ${positionals.join(' ')}. Run "help".`);
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    if (e instanceof UsageError) {
      process.stderr.write(`Usage problem: ${e.message}\n`);
      process.exit(64);
    }
    if (e instanceof SetupError) {
      process.stderr.write(`Setup problem: ${e.message}\nSee docs/SETUP.md.\n`);
      process.exit(78);
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (/Could not load the default credentials|credential|PERMISSION_DENIED|UNAUTHENTICATED|invalid_grant/i.test(msg)) {
      process.stderr.write(`Could not authenticate to Firestore.\n  ${msg}\nSee docs/SETUP.md ("Publisher credentials").\n`);
      process.exit(77);
    }
    process.stderr.write(`Unexpected failure: ${e instanceof Error ? (e.stack ?? msg) : msg}\n`);
    process.exit(1);
  },
);
