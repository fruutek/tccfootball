import { useEffect, useState } from 'react';
import { formatLongDate, formatShortDate, teamColour } from '../lib/format';
import { assistLines, hasTimeline, linesFor, outcome, scorerLines } from '../lib/match';
import type { Index } from '../lib/view';
import { Markdown } from '../lib/markdown';
import type { Match, TeamKey } from '../shared/schema';
import { Scoreboard } from './Scoreboard';
import { Avatar, Empty, IconAssist, IconBall, IconStar, SectionHead } from './ui';

/* ------------------------------------------------------------ list row */

export function MatchRow({ m, idx, i = 0 }: { m: Match; idx: Index; i?: number }) {
  const win = outcome(m);
  const [, mon, day] = m.date.split('-');
  const scorers = (['a', 'b'] as const).flatMap((k) => scorerLines(m, k, idx.nameOf).filter((l) => !l.unknown));
  const topScorers = scorers.slice(0, 3).map((l) => `${l.name.split(' ')[0]}${l.goals > 1 ? ` ×${l.goals}` : ''}${l.own ? ' (OG)' : ''}`);
  return (
    <a className="mrow rise" style={{ '--i': i } as React.CSSProperties} href={`/matches/${m.id}`}>
      <span className="mrow__date">
        <b>{Number(day)}</b>
        {formatShortDate(m.date).split(' ')[0]} {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(mon) - 1]}
      </span>
      <span className="mrow__teams">
        {(['a', 'b'] as const).map((k) => (
          <span key={k} className={`mrow__team ${win !== 'draw' && win !== k ? 'lose' : ''}`}>
            <i className="swatch" style={{ '--c': teamColour(m.teams[k].colour), background: teamColour(m.teams[k].colour) } as React.CSSProperties} />
            <span>{m.teams[k].name}</span>
          </span>
        ))}
      </span>
      <span className="mrow__scores num">
        <span className={win !== 'draw' && win !== 'a' ? 'lose' : ''}>{m.score.a}</span>
        <span className={win !== 'draw' && win !== 'b' ? 'lose' : ''}>{m.score.b}</span>
      </span>
      {(topScorers.length > 0 || m.playerOfTheMatch) && (
        <span className="mrow__extra">
          {topScorers.length > 0 && (
            <span>
              <IconBall />
              {topScorers.join(', ')}
            </span>
          )}
          {m.playerOfTheMatch && (
            <span>
              <IconStar />
              {idx.nameOf(m.playerOfTheMatch)}
            </span>
          )}
        </span>
      )}
    </a>
  );
}

/* ------------------------------------------------------------ line-up */

function Lineup({ m, team, idx }: { m: Match; team: TeamKey; idx: Index }) {
  const t = m.teams[team];
  const lines = new Map(linesFor(m).map((l) => [l.playerId, l]));
  return (
    <div className="card lineup" style={{ '--c': teamColour(t.colour) } as React.CSSProperties}>
      <div className="lineup__head">
        <h3>{t.name}</h3>
        <span className="num">{m.score[team]}</span>
      </div>
      {t.playerIds.map((pid) => {
        const p = idx.players.get(pid);
        const l = lines.get(pid);
        return (
          <a key={pid} className="lrow" href={`/players/${pid}`}>
            <Avatar id={pid} name={idx.nameOf(pid)} photo={p?.photo} size={36} />
            <span className="lrow__name">
              {idx.nameOf(pid)}
              {p?.nickname && <small>“{p.nickname}”</small>}
            </span>
            <span className="marks">
              {l && l.goals > 0 && (
                <span className="mark mark--goal" title={`${l.goals} goal${l.goals > 1 ? 's' : ''}`}>
                  <IconBall />
                  {l.goals > 1 ? `×${l.goals}` : ''}
                </span>
              )}
              {l && l.assists > 0 && (
                <span className="mark mark--assist" title={`${l.assists} assist${l.assists > 1 ? 's' : ''}`}>
                  <IconAssist />
                  {l.assists > 1 ? `×${l.assists}` : ''}
                </span>
              )}
              {l && l.ownGoals > 0 && <span className="mark mark--og">OG{l.ownGoals > 1 ? ` ×${l.ownGoals}` : ''}</span>}
              {l?.potm && (
                <span className="mark mark--potm" title="Player of the match">
                  <IconStar />
                </span>
              )}
            </span>
          </a>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ events */

function Summary({ m, idx }: { m: Match; idx: Index }) {
  const nameOf = idx.nameOf;
  const goalEvents = m.events.filter((e) => e.type !== 'assist');
  if (hasTimeline(m)) {
    const sorted = [...goalEvents].sort((x, y) => (('minute' in x ? x.minute : 0) ?? 0) - (('minute' in y ? y.minute : 0) ?? 0));
    return (
      <div className="tl" role="list" aria-label="Match timeline">
        {sorted.map((e, i) => {
          const name = e.playerId ? nameOf(e.playerId) : e.type === 'own_goal' ? 'Own goal' : 'Scorer not recorded';
          return (
            <div className="tl__row" role="listitem" key={i}>
              <span className="tl__min">{'minute' in e ? e.minute : ''}'</span>
              <div className={`tl__ev ${e.team}`}>
                <b>
                  {e.team === 'b' && <IconBall className="" />}
                  {name}
                  {e.type === 'own_goal' && e.playerId ? ' (OG)' : ''}
                  {e.team === 'a' && <IconBall className="" />}
                </b>
                {e.type === 'goal' && e.assistId && <small>Assist: {nameOf(e.assistId)}</small>}
                {e.type === 'own_goal' && <small>Counts for {m.teams[e.team].name}</small>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const unlinkedAssists = (['a', 'b'] as const).flatMap((k) => assistLines(m, k, nameOf).map((a) => ({ ...a, team: k })));
  return (
    <div className="glist">
      {(['a', 'b'] as const).map((k) => {
        const lines = scorerLines(m, k, nameOf);
        return (
          <div key={k}>
            <h4>{m.teams[k].name} — goals</h4>
            {lines.length === 0 ? (
              <p className="faint">No goals</p>
            ) : (
              <ul>
                {lines.map((l) => (
                  <li key={l.key}>
                    <IconBall className="" />
                    <span className={l.unknown ? 'dim' : undefined}>
                      {l.name}
                      {l.own && l.playerId ? ' (own goal)' : ''}
                    </span>
                    {l.goals > 1 && <span className="n">×{l.goals}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {unlinkedAssists.length > 0 && (
        <div>
          <h4>Assists</h4>
          <ul>
            {unlinkedAssists.map((a) => (
              <li key={`${a.team}-${a.playerId}`}>
                <IconAssist className="" />
                <span>{a.name}</span>
                <span className="faint" style={{ fontSize: 12 }}>
                  {m.teams[a.team].name}
                </span>
                {a.count > 1 && <span className="n">×{a.count}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ page */

export function MatchCentre({ idx, matchId }: { idx: Index; matchId: string | null }) {
  const [tab, setTab] = useState<'summary' | 'lineups' | 'report'>('summary');
  const m = matchId ? idx.matchesAsc.find((x) => x.id === matchId) : undefined;

  useEffect(() => {
    if (m) document.title = `${m.teams.a.name} ${m.score.a}–${m.score.b} ${m.teams.b.name} · Monday Night Football`;
  }, [m]);

  if (!m) {
    return (
      <div className="page">
        <Empty title="Match not found">
          There is no published match with that address. <a href="/matches" style={{ color: 'var(--accent)' }}>Browse all results</a>.
        </Empty>
      </div>
    );
  }

  const i = idx.matchesAsc.findIndex((x) => x.id === m.id);
  const prev = idx.matchesAsc[i - 1];
  const next = idx.matchesAsc[i + 1];
  const report = idx.reportFor(m.id);
  const potm = m.playerOfTheMatch;
  const nav = (x: Match | undefined, dir: 'prev' | 'next') =>
    x ? (
      <a className={dir} href={`/matches/${x.id}`} rel={dir}>
        <small>{dir === 'prev' ? '← Previous match' : 'Next match →'}</small>
        <b>
          {formatShortDate(x.date)} · {x.score.a}–{x.score.b}
        </b>
      </a>
    ) : (
      <span className={`${dir} off`} style={{ padding: '12px 14px' }}>
        <small className="faint" style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>
          {dir === 'prev' ? 'First match on record' : 'Latest match'}
        </small>
      </span>
    );

  return (
    <div className="page">
      <div className="stack-sm">
        <a href="/matches" className="link-more">
          ← All results
        </a>
        <Scoreboard match={m} idx={idx} hero />
      </div>

      <nav className="mnav" aria-label="Previous and next match">
        {nav(prev, 'prev')}
        {nav(next, 'next')}
      </nav>

      <div role="tablist" className="tabs" aria-label="Match sections">
        {(['summary', 'lineups', 'report'] as const).filter((t) => !(m.preseason && t === 'lineups')).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'lineups' ? 'Line-ups' : t === 'summary' ? 'Summary' : 'Report'}
          </button>
        ))}
      </div>

      <div className="mc">
        <section data-pane className={tab === 'summary' ? 'on' : ''}>
          <SectionHead title="Goals & assists" />
          {m.events.length === 0 ? (
            <Empty title={m.score.a + m.score.b === 0 ? 'Goalless' : 'No scorers recorded'}>{m.score.a + m.score.b === 0 ? 'A 0–0 draw.' : 'The final score is recorded, but not who scored.'}</Empty>
          ) : (
            <div className="card card--pad">
              <Summary m={m} idx={idx} />
            </div>
          )}
          {potm && (
            <a className="card card--link card--pad potw" href={`/players/${potm}`} style={{ marginTop: 14 }}>
              <Avatar id={potm} name={idx.nameOf(potm)} photo={idx.players.get(potm)?.photo} size={56} />
              <div>
                <span className="eyebrow">Player of the match</span>
                <div className="potw__name">{idx.nameOf(potm)}</div>
                {(() => {
                  const l = linesFor(m).find((x) => x.playerId === potm);
                  const bits = [l?.goals ? `${l.goals} goal${l.goals > 1 ? 's' : ''}` : '', l?.assists ? `${l.assists} assist${l.assists > 1 ? 's' : ''}` : ''].filter(Boolean);
                  return bits.length ? <div className="potw__sub">{bits.join(' · ')}</div> : null;
                })()}
              </div>
            </a>
          )}
        </section>

        {!m.preseason && (
          <section data-pane className={tab === 'lineups' ? 'on' : ''}>
            <SectionHead title="Starting line-ups" />
            <div className="stack-sm">
              <Lineup m={m} team="a" idx={idx} />
              <Lineup m={m} team="b" idx={idx} />
            </div>
          </section>
        )}

        <section data-pane className={`span2 ${tab === 'report' ? 'on' : ''}`}>
          <SectionHead title="Match report" href={report ? `/news/${report.id}` : undefined} linkLabel="Open in News" />
          {report ? (
            <article className="card card--pad">
              <h3 className="display" style={{ fontSize: 'clamp(28px,5vw,44px)', marginBottom: 8 }}>
                {report.title}
              </h3>
              <p className="dim" style={{ marginBottom: 16, fontSize: 17 }}>
                {report.standfirst}
              </p>
              <Markdown source={report.body} />
              <p className="note" style={{ marginTop: 18 }}>
                {report.author} · {formatLongDate(report.publishedAt.slice(0, 10))}
              </p>
            </article>
          ) : (
            <Empty title="No report yet">Nobody has written this one up. The result and the numbers above are the full record.</Empty>
          )}
        </section>
      </div>
    </div>
  );
}
