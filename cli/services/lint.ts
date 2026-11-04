/**
 * Light fact-checking of report prose against recorded data.
 * Everything here is a WARNING: prose may be creative, but specific claims that
 * are not in the data should only appear if the user supplied them.
 */
import type { MatchFacts } from '../../src/shared/facts';
import type { Player } from '../../src/shared/schema';
import type { Issue } from '../../src/shared/validate';
import { warn } from './common';

const UNRECORDED = [
  'half-time', 'halftime', 'half time', 'penalty', 'penalties', 'red card', 'yellow card', 'booked', 'sent off',
  'injury', 'injured', 'rain', 'raining', 'weather', 'stoppage', 'last-minute', 'last minute', 'late winner',
  'header', 'volley', 'free kick', 'free-kick', 'screamer', 'top corner', 'nutmeg', 'crossbar', 'post',
  'offside', 'var', 'substitute', 'sub on',
];

export function lintReport(
  parts: { title: string; standfirst: string; body: string },
  facts: MatchFacts,
  allPlayers: readonly Player[],
  participantIds: ReadonlySet<string>,
): Issue[] {
  const issues: Issue[] = [];
  const text = `${parts.title}\n${parts.standfirst}\n${parts.body}`;
  const [ta, tb] = facts.teams;
  const final = [`${ta!.score}-${tb!.score}`, `${tb!.score}-${ta!.score}`];

  // 1. Scorelines that are not the recorded final score (half-time scores etc.)
  const seen = new Set<string>();
  for (const m of text.matchAll(/(?<![\d-])(\d{1,2})\s*[-–—]\s*(\d{1,2})(?![\d-])/g)) {
    const pair = `${Number(m[1])}-${Number(m[2])}`;
    if (final.includes(pair) || seen.has(pair)) continue;
    seen.add(pair);
    issues.push(
      warn(
        'REPORT_SCORELINE',
        `The report mentions "${m[0]}" but the recorded final score is ${ta!.score}–${tb!.score}. Only the final score is recorded — remove any other scoreline unless the user told you it.`,
      ),
    );
  }

  // 2. People who did not play
  for (const p of allPlayers) {
    if (participantIds.has(p.id)) continue;
    const first = p.displayName.split(/\s+/)[0] ?? p.displayName;
    if (first.length < 3) continue;
    if (new RegExp(`\\b${escapeRe(first)}\\b`, 'i').test(text)) {
      issues.push(warn('REPORT_NONPARTICIPANT', `The report mentions "${first}", who did not play in this match. Fine for a joke about an absentee, otherwise check it.`));
    }
  }

  // 3. Hat-trick claims
  if (/hat-?trick/i.test(text) && !facts.players.some((p) => p.hatTrick)) {
    issues.push(warn('REPORT_HATTRICK', 'The report mentions a hat-trick but nobody scored three goals in this match.'));
  }

  // 4. Specific incidents that are not recorded
  const lower = text.toLowerCase();
  const hits = UNRECORDED.filter((w) => new RegExp(`(^|[^a-z])${escapeRe(w)}([^a-z]|$)`).test(lower));
  if (hits.length) {
    issues.push(
      warn(
        'REPORT_UNRECORDED_DETAIL',
        `The report mentions ${hits.map((h) => `"${h}"`).join(', ')} — match incidents like these are not recorded. Keep them only if the user told you; otherwise rewrite.`,
      ),
    );
  }
  return issues;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
