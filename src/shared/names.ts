/**
 * Resolves the names people use in plain English ("Peter", "Brownie", "Chris")
 * to stable player ids — and refuses to guess when more than one player fits.
 *
 * Matching happens in tiers. The first tier that matches ANY player decides the
 * outcome: one hit resolves, several hits are ambiguous (and must be put to the
 * user). Fuzzy matches are only ever offered as suggestions, never applied.
 */
import { normaliseName } from './ids';

export interface NameablePlayer {
  id: string;
  displayName: string;
  nickname?: string;
  aliases?: string[];
}

export type MatchVia = 'id' | 'name' | 'nickname' | 'alias' | 'first-name';

export type Resolution =
  | { kind: 'resolved'; input: string; playerId: string; displayName: string; via: MatchVia }
  | { kind: 'ambiguous'; input: string; candidates: { playerId: string; displayName: string; via: MatchVia }[] }
  | { kind: 'unknown'; input: string; suggestions: { playerId: string; displayName: string }[] };

export function resolveName(input: string, players: readonly NameablePlayer[]): Resolution {
  // `id:chris` is the unambiguous way to pass an id back (e.g. after a clarification).
  const explicit = /^id:\s*(.+)$/i.exec(input.trim());
  if (explicit) {
    const wanted = explicit[1]!.trim().toLowerCase();
    const p = players.find((x) => x.id === wanted);
    return p
      ? { kind: 'resolved', input, playerId: p.id, displayName: p.displayName, via: 'id' }
      : { kind: 'unknown', input, suggestions: [] };
  }

  const q = normaliseName(input);
  if (!q) return { kind: 'unknown', input, suggestions: [] };

  // Human names are tried first. A bare id is the LAST resort: ids are stable and
  // outlive renames, so an old id like "chris" must never beat a genuinely
  // ambiguous first name when two players are now "Chris B" and "Chris W".
  const tiers: { via: MatchVia; hit: (p: NameablePlayer) => boolean }[] = [
    { via: 'name', hit: (p) => normaliseName(p.displayName) === q },
    { via: 'nickname', hit: (p) => !!p.nickname && normaliseName(p.nickname) === q },
    { via: 'alias', hit: (p) => (p.aliases ?? []).some((a) => normaliseName(a) === q) },
    {
      via: 'first-name',
      hit: (p) => !q.includes(' ') && normaliseName(p.displayName).split(' ')[0] === q,
    },
    { via: 'id', hit: (p) => normaliseName(p.id) === q },
  ];

  for (const tier of tiers) {
    const hits = players.filter(tier.hit);
    if (hits.length === 1) {
      const p = hits[0]!;
      return { kind: 'resolved', input, playerId: p.id, displayName: p.displayName, via: tier.via };
    }
    if (hits.length > 1) {
      return {
        kind: 'ambiguous',
        input,
        candidates: hits.map((p) => ({ playerId: p.id, displayName: p.displayName, via: tier.via })),
      };
    }
  }
  return { kind: 'unknown', input, suggestions: suggest(q, players) };
}

function suggest(q: string, players: readonly NameablePlayer[]) {
  const scored = players
    .map((p) => {
      const names = [p.displayName, p.nickname, ...(p.aliases ?? [])].filter(Boolean) as string[];
      let best = Infinity;
      for (const n of names) {
        const norm = normaliseName(n);
        const tokens = [norm, ...norm.split(' ')];
        for (const t of tokens) {
          let d = levenshtein(q, t);
          if (q.length >= 3 && (t.startsWith(q) || q.startsWith(t)) && t.length >= 3) d = Math.min(d, 1);
          best = Math.min(best, d);
        }
      }
      return { p, best };
    })
    .filter((x) => x.best <= Math.max(1, Math.floor(q.length / 4)) + 1)
    .sort((x, y) => x.best - y.best || x.p.displayName.localeCompare(y.p.displayName))
    .slice(0, 3);
  return scored.map((x) => ({ playerId: x.p.id, displayName: x.p.displayName }));
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}
