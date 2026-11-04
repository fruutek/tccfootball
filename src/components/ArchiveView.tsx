import { useEffect, useMemo, useState } from 'react';
import { formatMonth } from '../lib/format';
import type { Index } from '../lib/view';
import { inPeriod, seasonLabel, type Period } from '../shared/seasons';
import { MatchRow } from './MatchViews';
import { Empty, IconResults } from './ui';

export function ArchiveView({ idx, initialSeason }: { idx: Index; initialSeason?: string }) {
  const [season, setSeason] = useState<string>(initialSeason ?? 'all');
  const [player, setPlayer] = useState('');

  useEffect(() => {
    if (initialSeason) return;
    const s = new URLSearchParams(window.location.search).get('season');
    if (s) setSeason(s);
  }, [initialSeason]);
  useEffect(() => {
    if (initialSeason) return;
    const url = season === 'all' ? window.location.pathname : `${window.location.pathname}?season=${season}`;
    window.history.replaceState(null, '', url);
  }, [season, initialSeason]);

  const period: Period = season === 'all' ? { kind: 'all' } : { kind: 'season', id: season };
  const list = useMemo(
    () => idx.matchesDesc.filter((m) => inPeriod(m.date, period, idx.startMonth) && (!player || m.playerIds.includes(player))),
    [idx, season, player], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const goals = list.reduce((n, m) => n + m.score.a + m.score.b, 0);
  const byMonth = new Map<string, typeof list>();
  for (const m of list) byMonth.set(m.date.slice(0, 7), [...(byMonth.get(m.date.slice(0, 7)) ?? []), m]);
  const participants = [...new Set(idx.matchesAsc.flatMap((m) => m.playerIds))].sort((a, b) => idx.nameOf(a).localeCompare(idx.nameOf(b)));
  let n = 0;

  return (
    <div className="page">
      <header>
        <h1 className="page-title">
          <small>THE ARCHIVE</small>Results
        </h1>
        <p className="page-sub">Every Monday on record, newest first.</p>
      </header>
      <div className="stack-sm">
        <div className="chips" role="group" aria-label="Season">
          <button className="chip" aria-pressed={season === 'all'} onClick={() => setSeason('all')}>All seasons</button>
          {idx.seasons.map((s) => (
            <button key={s} className="chip" aria-pressed={season === s} onClick={() => setSeason(s)}>{seasonLabel(s)}</button>
          ))}
        </div>
        <div className="controls">
          <select className="field" aria-label="Filter by player" value={player} onChange={(e) => setPlayer(e.target.value)}>
            <option value="">Any player</option>
            {participants.map((id) => <option key={id} value={id}>{idx.nameOf(id)}</option>)}
          </select>
          <span className="note">
            <b>{list.length}</b> match{list.length === 1 ? '' : 'es'} · <b>{goals}</b> goals
            {list.length > 0 && <> · {(goals / list.length).toFixed(1)} per game</>}
          </span>
        </div>
      </div>
      {list.length === 0 ? (
        <Empty title="No matches here" icon={<IconResults />}>{idx.matchesAsc.length ? 'Nothing matches those filters.' : 'The first result will appear here once it is published.'}</Empty>
      ) : (
        <div className="card rows">
          {[...byMonth].map(([month, ms]) => (
            <section key={month}>
              <div className="month-head">{formatMonth(month)}</div>
              {ms.map((m) => <MatchRow key={m.id} m={m} idx={idx} i={n++} />)}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
