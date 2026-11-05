import { useEffect, useMemo, useState } from 'react';
import { formatMonth, pct } from '../lib/format';
import type { Index } from '../lib/view';
import { buildLeaderboard, LEADERBOARD_ORDER, LEADERBOARDS, minAppearancesFor, type LeaderboardKey } from '../shared/leaderboards';
import { parsePeriod, periodKey, seasonLabel, type Period } from '../shared/seasons';
import type { PlayerStats } from '../shared/stats';
import { Avatar, Empty, IconTable } from './ui';

/** `tracked`: only meaningful for RECORDED matches — shown as "–" for players with none (e.g. preseason only). */
type Col = { key: string; label: string; opt?: boolean; tracked?: boolean; get: (s: PlayerStats) => number; fmt: (n: number) => string };
const COLS: Col[] = [
  { key: 'appearances', label: 'Apps', get: (s) => s.totalAppearances, fmt: String },
  { key: 'goals', label: 'Goals', get: (s) => s.goals, fmt: String },
  { key: 'assists', label: 'Assists', get: (s) => s.assists, fmt: String },
  { key: 'wins', label: 'W', opt: true, tracked: true, get: (s) => s.wins, fmt: String },
  { key: 'draws', label: 'D', opt: true, tracked: true, get: (s) => s.draws, fmt: String },
  { key: 'losses', label: 'L', opt: true, tracked: true, get: (s) => s.losses, fmt: String },
  { key: 'winPct', label: 'Win %', tracked: true, get: (s) => s.winPct, fmt: pct },
  { key: 'goalsPerGame', label: 'G/Gm', opt: true, get: (s) => s.goalsPerGame, fmt: (n) => n.toFixed(2) },
  { key: 'potm', label: 'POTM', opt: true, tracked: true, get: (s) => s.potm, fmt: String },
  { key: 'winStreak', label: 'Streak', opt: true, tracked: true, get: (s) => s.currentWinStreak, fmt: String },
];
const BOARD_COL: Record<LeaderboardKey, string> = {
  goals: 'goals', assists: 'assists', appearances: 'appearances', wins: 'wins', winPct: 'winPct', goalsPerGame: 'goalsPerGame', potm: 'potm', winStreak: 'winStreak',
};

function readUrl(): { board: LeaderboardKey; period: Period } {
  if (typeof window === 'undefined') return { board: 'goals', period: { kind: 'all' } };
  const q = new URLSearchParams(window.location.search);
  const b = q.get('board') as LeaderboardKey | null;
  return { board: b && b in LEADERBOARDS ? b : 'goals', period: parsePeriod(q.get('period')) };
}

export function LeaderboardView({ idx, initial }: { idx: Index; initial?: { board?: LeaderboardKey; period?: Period } }) {
  const [board, setBoard] = useState<LeaderboardKey>(initial?.board ?? 'goals');
  const [period, setPeriod] = useState<Period>(initial?.period ?? { kind: 'all' });
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  useEffect(() => {
    if (initial) return;
    const u = readUrl();
    setBoard(u.board);
    setPeriod(u.period);
  }, [initial]);
  useEffect(() => {
    if (initial) return;
    const q = new URLSearchParams();
    if (board !== 'goals') q.set('board', board);
    if (period.kind !== 'all') q.set('period', periodKey(period));
    const s = q.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${s ? `?${s}` : ''}`);
  }, [board, period, initial]);

  const def = LEADERBOARDS[board];
  const matchCount = idx.matchCount(period);
  const min = minAppearancesFor(matchCount, idx.minAppearances);
  const rows = useMemo(
    () => buildLeaderboard(idx.stats(period).values(), board, { minAppearances: min, nameOf: idx.nameOf }),
    [idx, period, board, min],
  );
  const shown = useMemo(() => {
    if (!sort) return rows;
    const col = COLS.find((c) => c.key === sort.key)!;
    return [...rows].sort((a, b) => (col.get(b.stats) - col.get(a.stats)) * -sort.dir || a.rank - b.rank);
  }, [rows, sort]);

  const setKind = (kind: Period['kind']) => {
    if (kind === 'all') setPeriod({ kind: 'all' });
    if (kind === 'season') setPeriod({ kind: 'season', id: idx.seasons[0] ?? String(new Date().getFullYear()) });
    if (kind === 'month') setPeriod({ kind: 'month', id: idx.months[0] ?? '' });
  };
  const click = (key: string) => setSort((s) => (s?.key === key ? (s.dir === -1 ? { key, dir: 1 } : null) : { key, dir: -1 }));
  const podium = rows.slice(0, 3);

  return (
    <div className="page">
      <header>
        <h1 className="page-title">
          <small>THE TABLE</small>Leaderboards
        </h1>
        <p className="page-sub">{def.blurb}</p>
      </header>

      <div className="stack-sm">
        <div className="chips" role="tablist" aria-label="Leaderboard">
          {LEADERBOARD_ORDER.map((k) => (
            <button key={k} role="tab" className="chip" aria-selected={board === k} onClick={() => { setBoard(k); setSort(null); }}>
              {LEADERBOARDS[k].label}
            </button>
          ))}
        </div>
        <div className="controls">
          <div className="seg" role="group" aria-label="Period">
            <button aria-pressed={period.kind === 'all'} onClick={() => setKind('all')}>All-time</button>
            <button aria-pressed={period.kind === 'season'} onClick={() => setKind('season')}>Season</button>
            <button aria-pressed={period.kind === 'month'} onClick={() => setKind('month')} disabled={idx.months.length === 0}>Month</button>
          </div>
          {period.kind === 'season' && (
            <select className="field" aria-label="Season" value={period.id} onChange={(e) => setPeriod({ kind: 'season', id: e.target.value })}>
              {idx.seasons.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
            </select>
          )}
          {period.kind === 'month' && (
            <select className="field" aria-label="Month" value={period.id} onChange={(e) => setPeriod({ kind: 'month', id: e.target.value })}>
              {idx.months.map((m) => <option key={m} value={m}>{formatMonth(m)}</option>)}
            </select>
          )}
          <span className="note">
            {matchCount} match{matchCount === 1 ? '' : 'es'}
            {def.rate && <> · <b>minimum {min} appearance{min === 1 ? '' : 's'}</b> to qualify</>}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty title="Nobody on this board yet" icon={<IconTable />}>
          {matchCount === 0 ? `No matches fall in this period.${idx.hasStartingTotals && period.kind !== 'all' ? ' Goals recorded before match tracking began count in All-time only.' : ''}` : def.rate ? `Players need at least ${min} appearances for ${def.label.toLowerCase()}.` : 'Nobody has registered a number here yet.'}
        </Empty>
      ) : (
        <>
          {!sort && (
            <div className="podium" aria-label="Top three">
              {[podium[1], podium[0], podium[2]].map((r, i) =>
                r ? (
                  <a key={r.stats.playerId} className={`pod ${r.rank === 1 ? 'pod--1' : ''} rise`} style={{ '--i': i } as React.CSSProperties} href={`/players/${r.stats.playerId}`}>
                    <span className="pod__rank">{r.rank === 1 ? 'LEADER' : `#${r.rank}${r.tied ? '=' : ''}`}</span>
                    <Avatar id={r.stats.playerId} name={idx.nameOf(r.stats.playerId)} photo={idx.players.get(r.stats.playerId)?.photo} size={r.rank === 1 ? 72 : 52} />
                    <span className="pod__name">{idx.nameOf(r.stats.playerId)}</span>
                    <span className="pod__val num">{def.format(r.value)}</span>
                  </a>
                ) : (
                  <span key={`e${i}`} />
                ),
              )}
            </div>
          )}

          <div className="card table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col" className="left">Player</th>
                  {COLS.map((c) => (
                    <th key={c.key} scope="col" className={c.opt && c.key !== BOARD_COL[board] ? 'opt' : ''} aria-sort={sort?.key === c.key ? (sort.dir === -1 ? 'descending' : 'ascending') : undefined}>
                      <button onClick={() => click(c.key)} title={`Sort by ${c.label}`}>
                        {c.label}
                        {sort?.key === c.key ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.stats.playerId} className={!sort && r.rank === 1 ? 'top' : ''}>
                    <td className="rank">{sort ? i + 1 : `${r.rank}${r.tied ? '=' : ''}`}</td>
                    <td className="left">
                      <a className="who" href={`/players/${r.stats.playerId}`}>
                        <Avatar id={r.stats.playerId} name={idx.nameOf(r.stats.playerId)} photo={idx.players.get(r.stats.playerId)?.photo} size={32} />
                        <span>
                          {idx.nameOf(r.stats.playerId)}
                          {idx.players.get(r.stats.playerId)?.nickname && <small>“{idx.players.get(r.stats.playerId)!.nickname}”</small>}
                        </span>
                      </a>
                    </td>
                    {COLS.map((c) => (
                      <td key={c.key} className={`${c.key === BOARD_COL[board] ? 'key' : ''} ${c.opt && c.key !== BOARD_COL[board] ? 'opt' : ''}`}>
                        {c.tracked && r.stats.appearances === 0 ? '–' : c.fmt(c.get(r.stats))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            Tap a column heading to sort by it. Ties share a rank (=).
            {idx.hasStartingTotals && (period.kind === 'all'
              ? ' All-time totals include goals recorded before match tracking began.'
              : ' Goals recorded before match tracking began count in All-time only.')}
          </p>
        </>
      )}
    </div>
  );
}
