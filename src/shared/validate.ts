/**
 * Semantic validation of a match result — everything zod's shape check cannot
 * express. The publishing CLI refuses to write a match with any `error`.
 *
 * Principle: never repair data silently. If the facts do not add up, say
 * exactly what is missing so the person can supply it.
 */
import { isMonday, isValidDate } from './dates';
import { accountGoals, type MatchContent } from './events';
import { TEAM_KEYS, otherTeam, type TeamKey } from './schema';

export interface Issue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
}

export interface ValidationContext {
  /** When supplied, every player id used must be in this set. */
  knownPlayerIds?: ReadonlySet<string>;
  /** Pretty-prints a player id in messages. */
  playerName?: (id: string) => string;
  /** YYYY-MM-DD, used to reject results from the future. */
  today?: string;
}

export function validateMatchContent(m: MatchContent, ctx: ValidationContext = {}): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (code: string, message: string) => errors.push({ level: 'error', code, message });
  const warn = (code: string, message: string) => warnings.push({ level: 'warning', code, message });
  const name = (id: string | null) => (id === null ? 'an unknown player' : ctx.playerName?.(id) ?? id);
  const tname = (k: TeamKey) => m.teams[k].name;

  /* --- date ----------------------------------------------------------- */
  if (!isValidDate(m.date)) {
    err('DATE_INVALID', `"${m.date}" is not a valid date (expected YYYY-MM-DD).`);
  } else {
    if (ctx.today && m.date > ctx.today) {
      err('DATE_FUTURE', `${m.date} is in the future (today is ${ctx.today}). Results can only be recorded after the game.`);
    }
    if (!isMonday(m.date)) {
      warn('DATE_NOT_MONDAY', `${m.date} is not a Monday. Confirm the date is right.`);
    }
  }

  /* --- teams & rosters --------------------------------------------------- */
  if (tname('a').trim().toLowerCase() === tname('b').trim().toLowerCase()) {
    err('TEAM_NAME_DUPLICATE', `Both teams are called "${tname('a')}". Give each team a different name.`);
  }
  const seen = new Map<string, TeamKey>();
  for (const k of TEAM_KEYS) {
    const roster = m.teams[k].playerIds;
    if (roster.length === 0) err('TEAM_EMPTY', `${tname(k)} has no players.`);
    for (const pid of roster) {
      const prev = seen.get(pid);
      if (prev === k) err('PLAYER_DUPLICATE_IN_TEAM', `${name(pid)} is listed twice in ${tname(k)}.`);
      else if (prev) err('PLAYER_ON_BOTH_TEAMS', `${name(pid)} is listed for both ${tname(prev)} and ${tname(k)}.`);
      else seen.set(pid, k);
      if (ctx.knownPlayerIds && !ctx.knownPlayerIds.has(pid)) {
        err('PLAYER_UNKNOWN', `Player id "${pid}" does not exist.`);
      }
    }
  }
  if (m.teams.a.playerIds.length !== m.teams.b.playerIds.length) {
    warn(
      'TEAM_SIZE_UNEQUAL',
      `Teams are different sizes (${tname('a')}: ${m.teams.a.playerIds.length}, ${tname('b')}: ${m.teams.b.playerIds.length}). Confirm no one is missing.`,
    );
  }

  /* --- events ------------------------------------------------------------ */
  m.events.forEach((e, i) => {
    const at = `Event ${i + 1}`;
    if (e.type === 'goal') {
      if (e.playerId !== null && !m.teams[e.team].playerIds.includes(e.playerId)) {
        err('SCORER_NOT_IN_TEAM', `${at}: ${name(e.playerId)} is recorded scoring for ${tname(e.team)} but is not on that team.`);
      }
      if (e.assistId) {
        if (!m.teams[e.team].playerIds.includes(e.assistId)) {
          err('ASSIST_NOT_IN_TEAM', `${at}: assist by ${name(e.assistId)} but they are not on ${tname(e.team)}.`);
        }
        if (e.assistId === e.playerId) {
          err('ASSIST_SELF', `${at}: ${name(e.assistId)} cannot assist their own goal.`);
        }
      }
    } else if (e.type === 'own_goal') {
      if (e.playerId !== null && !m.teams[otherTeam(e.team)].playerIds.includes(e.playerId)) {
        err(
          'OWN_GOAL_WRONG_TEAM',
          `${at}: own goal by ${name(e.playerId)} counts for ${tname(e.team)}, so ${name(e.playerId)} must play for ${tname(otherTeam(e.team))}.`,
        );
      }
    } else if (e.type === 'assist') {
      if (!m.teams[e.team].playerIds.includes(e.playerId)) {
        err('ASSIST_NOT_IN_TEAM', `${at}: assist by ${name(e.playerId)} but they are not on ${tname(e.team)}.`);
      }
    }
  });

  /* --- score consistency --------------------------------------------------- */
  const acc = accountGoals(m);
  for (const k of TEAM_KEYS) {
    const t = acc[k];
    if (t.unaccounted > 0) {
      err(
        'GOALS_UNACCOUNTED',
        `${tname(k)}: the score is ${t.declared} but only ${t.recorded} goal(s) are accounted for (${t.unaccounted} missing). ` +
          `Ask who scored the rest. If it is genuinely unknown, record each as an explicit unknown-scorer goal ` +
          `({"type":"goal","team":"${k}","player":null}).`,
      );
    } else if (t.unaccounted < 0) {
      err(
        'GOALS_EXCEED_SCORE',
        `${tname(k)}: ${t.recorded} goal(s) are recorded but the score is only ${t.declared}. Either the score or the scorers are wrong.`,
      );
    }
    if (t.unknownGoals > 0) {
      warn('UNKNOWN_SCORER', `${tname(k)}: ${t.unknownGoals} goal(s) have an unknown scorer and will not count towards any player's goals.`);
    }
    const assists = t.linkedAssists + t.unlinkedAssists;
    if (assists > t.assistableGoals) {
      err(
        'ASSISTS_EXCEED_GOALS',
        `${tname(k)}: ${assists} assist(s) recorded but only ${t.assistableGoals} goal(s) could have had one (own goals have no assist).`,
      );
    }
  }

  /* --- player of the match ------------------------------------------------ */
  if (m.playerOfTheMatch !== null && !seen.has(m.playerOfTheMatch)) {
    err('POTM_NOT_PARTICIPANT', `Player of the match ${name(m.playerOfTheMatch)} did not play in this match.`);
  }

  /* --- minutes: only a sanity check, order is never assumed -------------------- */
  const minutes = m.events.flatMap((e) => ('minute' in e && e.minute !== undefined ? [e.minute] : []));
  if (minutes.length > 0 && minutes.length < m.events.filter((e) => e.type !== 'assist').length) {
    warn('MINUTES_PARTIAL', 'Only some events have minutes. That is fine, but the match page will not show a full timeline.');
  }

  return { ok: errors.length === 0, errors, warnings };
}
