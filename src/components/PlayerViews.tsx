import { useEffect, useMemo, useState } from 'react';
import { formatLongDate, formatShortDate, pct } from '../lib/format';
import type { Index } from '../lib/view';
import { seasonLabel, type Period } from '../shared/seasons';
import { statsFor, type PlayerStats } from '../shared/stats';
import type { Player } from '../shared/schema';
import { Avatar, DemoTag, Empty, FormStrip, IconAssist, IconBall, IconStar, ResultBadge, SectionHead } from './ui';

/* ------------------------------------------------------------ directory */

export function PlayerCard({ p, s, i = 0 }: { p: Player; s: PlayerStats; i?: number }) {
  return (
    <a className="card card--link pcard rise" style={{ '--i': Math.min(i, 12) } as React.CSSProperties} href={`/players/${p.id}`}>
      <Avatar id={p.id} name={p.displayName} photo={p.photo} size={64} />
      <div>
        <div className="pcard__name">
          {p.displayName} {p.fictional && <DemoTag />}
        </div>
        <div className="pcard__nick">{p.nickname ? `“${p.nickname}”` : ''}</div>
        <FormStrip form={s.form} small />
      </div>
      <div className="pcard__stats num">
        <div className="pcard__stat"><b>{s.totalAppearances}</b><span>Apps</span></div>
        <div className="pcard__stat"><b>{s.goals}</b><span>Goals</span></div>
        <div className="pcard__stat"><b>{s.assists}</b><span>Assists</span></div>
        <div className="pcard__stat"><b>{s.appearances ? pct(s.winPct) : '—'}</b><span>Win</span></div>
      </div>
    </a>
  );
}

export function PlayersDirectory({ idx }: { idx: Index }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'name' | 'apps' | 'goals' | 'assists'>('apps');
  const all = idx.stats({ kind: 'all' });
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return idx.data.players
      .filter((p) => p.status === 'active' || (all.get(p.id)?.totalAppearances ?? 0) > 0)
      .filter((p) => !needle || [p.displayName, p.nickname ?? ''].some((n) => n.toLowerCase().includes(needle)))
      .sort((a, b) => {
        const sa = statsFor(all, a.id);
        const sb = statsFor(all, b.id);
        const by = { name: 0, apps: sb.totalAppearances - sa.totalAppearances, goals: sb.goals - sa.goals, assists: sb.assists - sa.assists }[sort];
        return by || a.displayName.localeCompare(b.displayName);
      });
  }, [idx, q, sort, all]);

  return (
    <div className="page">
      <header>
        <h1 className="page-title">
          <small>THE SQUAD</small>Players
        </h1>
      </header>
      <div className="controls">
        <input className="field" type="search" placeholder="Search players" aria-label="Search players" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg" role="group" aria-label="Sort players">
          {(['apps', 'goals', 'assists', 'name'] as const).map((k) => (
            <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)}>
              {k === 'apps' ? 'Apps' : k === 'name' ? 'A–Z' : k[0]!.toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 ? (
        <Empty title={idx.data.players.length ? 'No one matches that search' : 'No players yet'}>{idx.data.players.length ? 'Try a different spelling or nickname.' : 'Players appear here as soon as they are registered.'}</Empty>
      ) : (
        <div className="pgrid">
          {list.map((p, i) => (
            <PlayerCard key={p.id} p={p} s={statsFor(all, p.id)} i={i} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ profile */

function Tile({ label, value, hot, sub }: { label: string; value: string | number; hot?: boolean; sub?: string }) {
  return (
    <div className={`tile ${hot ? 'tile--hot' : ''}`}>
      <span className="tile__label">{label}</span>
      <span className="tile__value">{value}</span>
      {sub && <span className="tile__sub">{sub}</span>}
    </div>
  );
}

export function PlayerProfile({ idx, playerId }: { idx: Index; playerId: string | null }) {
  const p = playerId ? idx.players.get(playerId) : undefined;
  useEffect(() => {
    if (p) document.title = `${p.displayName} · Monday Night Football`;
  }, [p]);
  if (!p) {
    return (
      <div className="page">
        <Empty title="Player not found">
          We don't have a player with that address. <a href="/players" style={{ color: 'var(--accent)' }}>See everyone</a>.
        </Empty>
      </div>
    );
  }
  const s = statsFor(idx.stats({ kind: 'all' }), p.id);
  const seasonRows = idx.seasons
    .map((id) => ({ id, s: statsFor(idx.stats({ kind: 'season', id }), p.id) }))
    .filter((r) => r.s.appearances > 0);
  const total = s.appearances || 1;
  const awards = s.history.filter((h) => h.potm);

  return (
    <div className="page">
      <a href="/players" className="link-more">
        ← All players
      </a>
      <header className="phero">
        <Avatar id={p.id} name={p.displayName} photo={p.photo} className="avatar--xl" size={150} />
        <div>
          <span className="eyebrow">Monday Night Football {p.fictional && <DemoTag />}</span>
          <h1 className="phero__name">{p.displayName}</h1>
          {p.nickname && <div className="phero__nick">“{p.nickname}”</div>}
          <div className="phero__meta">
            <span>
              First appearance: <b>{s.firstAppearance ? formatLongDate(s.firstAppearance) : 'no recorded match yet'}</b>
            </span>
            {s.lastAppearance && (
              <span>
                Last played: <b>{formatShortDate(s.lastAppearance)}</b>
              </span>
            )}
            {p.status === 'archived' && <span className="tag">Retired</span>}
          </div>
          {p.bio && <p className="phero__bio">{p.bio}</p>}
        </div>
      </header>

      {s.totalAppearances === 0 && s.startingGoals + s.startingAssists === 0 ? (
        <Empty title="Yet to make an appearance">Stats appear here as soon as {p.displayName} plays a recorded match.</Empty>
      ) : (
        <>
          <section>
            <SectionHead title="Career" />
            <div className="tiles num">
              <Tile label="Appearances" value={s.totalAppearances} {...(s.startingAppearances > 0 ? { sub: s.appearances > 0 ? `${s.startingAppearances} preseason + ${s.appearances} recorded` : 'preseason, before match records' } : {})} />
              <Tile label="Goals" value={s.goals} hot {...(s.startingGoals > 0 ? { sub: `incl. ${s.startingGoals} before match records` } : {})} />
              <Tile label="Assists" value={s.assists} {...(s.startingAssists > 0 ? { sub: `incl. ${s.startingAssists} before match records` } : {})} />
              <Tile label="Goals / game" value={s.goalsPerGame.toFixed(2)} />
              {/* Results are only tracked for recorded matches — never show a 0% win rate for someone with none. */}
              {s.appearances > 0 && (
                <>
                  <Tile label="Win rate" value={pct(s.winPct)} sub={`${s.wins} wins`} hot />
                  <Tile label="Player of match" value={s.potm} />
                  <Tile label="Assists / game" value={s.assistsPerGame.toFixed(2)} />
                  <Tile label="Win streak" value={s.currentWinStreak} sub={`best ${s.longestWinStreak}`} />
                  <Tile label="Draws" value={s.draws} />
                  <Tile label="Losses" value={s.losses} />
                </>
              )}
            </div>
          </section>

          {s.appearances === 0 && (
            <p className="note">
              These totals come from before match records began (preseason), so there is no match-by-match history or win rate yet — those start with the first recorded game.
            </p>
          )}

          {s.appearances > 0 && (<>
          <section className="card card--pad">
            <div className="sec-head" style={{ marginBottom: 12 }}>
              <h2>Record</h2>
              <FormStrip form={s.form} />
            </div>
            <div className="wdl" aria-label={`${s.wins} wins, ${s.draws} draws, ${s.losses} losses`}>
              <span className="w" style={{ width: `${(s.wins / total) * 100}%` }} />
              <span className="d" style={{ width: `${(s.draws / total) * 100}%` }} />
              <span className="l" style={{ width: `${(s.losses / total) * 100}%` }} />
            </div>
            <div className="wdl-legend num">
              <span><b>{s.wins}</b> won</span>
              <span><b>{s.draws}</b> drawn</span>
              <span><b>{s.losses}</b> lost</span>
              {s.ownGoals > 0 && <span><b>{s.ownGoals}</b> own goal{s.ownGoals > 1 ? 's' : ''}</span>}
            </div>
          </section>

          {seasonRows.length > 0 && (
            <section>
              <SectionHead title="By season" />
              <div className="card table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="left">Season</th>
                      <th>Apps</th><th>Goals</th><th>Assists</th><th className="opt">W</th><th className="opt">D</th><th className="opt">L</th><th>Win %</th><th className="opt">POTM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seasonRows.map(({ id, s: r }) => (
                      <tr key={id}>
                        <td className="left" style={{ fontWeight: 700 }}>{seasonLabel(id)}</td>
                        <td>{r.appearances}</td><td>{r.goals}</td><td>{r.assists}</td><td className="opt">{r.wins}</td><td className="opt">{r.draws}</td><td className="opt">{r.losses}</td><td>{pct(r.winPct)}</td><td className="opt">{r.potm}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="two-col">
            <section>
              <SectionHead title="Match history" />
              <div className="card hist">
                {s.history.slice(0, 15).map((h) => (
                  <a key={h.matchId} className="hrow" href={`/matches/${h.matchId}`}>
                    <span className="hrow__date">{formatShortDate(h.date)}</span>
                    <ResultBadge r={h.result} />
                    <span className="hrow__vs">
                      {h.teamName} <span className="faint">v</span> {h.opponentName}
                      <small>Played for {h.teamName}</small>
                    </span>
                    <span className="hrow__score num">
                      {h.goalsFor}–{h.goalsAgainst}
                      <small>
                        {h.goals > 0 && <span><IconBall className="" /> {h.goals}</span>}
                        {h.assists > 0 && <span><IconAssist className="" /> {h.assists}</span>}
                        {h.potm && <span style={{ color: 'var(--accent)' }}><IconStar className="" /></span>}
                      </small>
                    </span>
                  </a>
                ))}
              </div>
              {s.history.length > 15 && <p className="note" style={{ marginTop: 8 }}>Showing the latest 15 of {s.history.length} matches.</p>}
            </section>
            <section>
              <SectionHead title="Awards" />
              {awards.length === 0 ? (
                <Empty title="No awards yet" icon={<IconStar />}>Player of the match awards will collect here.</Empty>
              ) : (
                <div className="card hist">
                  {awards.map((h) => (
                    <a key={h.matchId} className="hrow" href={`/matches/${h.matchId}`}>
                      <span className="hrow__date">{formatShortDate(h.date)}</span>
                      <span style={{ color: 'var(--accent)' }}><IconStar /></span>
                      <span className="hrow__vs">
                        Player of the match
                        <small>
                          {h.teamName} {h.goalsFor}–{h.goalsAgainst} {h.opponentName}
                        </small>
                      </span>
                      <span />
                    </a>
                  ))}
                </div>
              )}
            </section>
          </div>
          </>)}
        </>
      )}
    </div>
  );
}

export type { Period };
