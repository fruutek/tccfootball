import { useMemo, useState } from 'react';
import { formatLongDate, formatShortDate, localToday, weekdayName } from '../lib/format';
import { linesFor } from '../lib/match';
import type { Index } from '../lib/view';
import { buildLeaderboard, type LeaderboardKey } from '../shared/leaderboards';
import { seasonIdOf, seasonLabel, type Period } from '../shared/seasons';
import { statsFor } from '../shared/stats';
import { MatchRow } from './MatchViews';
import { ArticleCard } from './NewsViews';
import { EmptyBoard, Scoreboard } from './Scoreboard';
import { Avatar, Empty, FormStrip, IconBall, IconClock, IconPin, IconStar, SectionHead } from './ui';

function TopList({ idx, board, period }: { idx: Index; board: 'goals' | 'assists'; period: Period }) {
  const rows = buildLeaderboard(idx.stats(period).values(), board as LeaderboardKey, { minAppearances: 1, nameOf: idx.nameOf }).slice(0, 5);
  if (rows.length === 0) return <p className="note" style={{ padding: 16 }}>Nobody on the board yet.</p>;
  return (
    <ul className="plist">
      {rows.map((r, i) => (
        <li key={r.stats.playerId}>
          <a className="prow rise" style={{ '--i': i } as React.CSSProperties} href={`/players/${r.stats.playerId}`}>
            <span className={`prow__rank ${r.rank === 1 ? 'first' : ''}`}>{r.rank}</span>
            <Avatar id={r.stats.playerId} name={idx.nameOf(r.stats.playerId)} photo={idx.players.get(r.stats.playerId)?.photo} size={38} />
            <span className="prow__name">
              {idx.nameOf(r.stats.playerId)}
              <small>{r.stats.totalAppearances} apps</small>
            </span>
            <span className="prow__val num">{r.value}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function HomeView({ idx, today = localToday() }: { idx: Index; today?: string }) {
  const latest = idx.matchesDesc[0];
  const [scope, setScope] = useState<'season' | 'all'>('season');
  const season: Period = latest ? { kind: 'season', id: seasonIdOf(latest.date, idx.startMonth) } : { kind: 'all' };
  const period: Period = scope === 'season' ? season : { kind: 'all' };
  const fixture = idx.nextFixture(today);
  const report = latest ? idx.reportFor(latest.id) : undefined;
  const lead = report ?? idx.articlesDesc.find((a) => a.category === 'match-report') ?? idx.articlesDesc[0];
  const news = idx.articlesDesc.filter((a) => a.id !== lead?.id).slice(0, 3);
  const recent = idx.matchesDesc.slice(1, 6);

  // Player of the week = player of the latest match.
  const potw = latest?.playerOfTheMatch ?? null;
  const potwLine = latest && potw ? linesFor(latest).find((l) => l.playerId === potw) : undefined;
  const potwStats = potw ? statsFor(idx.stats({ kind: 'all' }), potw) : undefined;

  // Recent form: everyone who played in the last few matches, ranked by points from their last N games.
  const formRows = useMemo(() => {
    const recentIds = new Set(idx.matchesDesc.slice(0, idx.formLength).flatMap((m) => m.playerIds));
    const all = idx.stats({ kind: 'all' });
    return [...recentIds]
      .map((id) => statsFor(all, id))
      .map((s) => {
        const last = s.history.slice(0, idx.formLength);
        return { s, pts: last.reduce((n, h) => n + (h.result === 'W' ? 3 : h.result === 'D' ? 1 : 0), 0), g: last.reduce((n, h) => n + h.goals, 0), a: last.reduce((n, h) => n + h.assists, 0) };
      })
      .sort((x, y) => y.pts - x.pts || y.g + y.a - (x.g + x.a) || idx.nameOf(x.s.playerId).localeCompare(idx.nameOf(y.s.playerId)))
      .slice(0, 8);
  }, [idx]);

  if (!latest) {
    const hasScorers = [...idx.stats({ kind: 'all' }).values()].some((s) => s.goals > 0);
    return (
      <div className="page">
        <EmptyBoard />
        {hasScorers && (
          <section>
            <SectionHead title="Top scorers" href="/leaderboards" linkLabel="Leaderboards" />
            <div className="card"><TopList idx={idx} board="goals" period={{ kind: 'all' }} /></div>
            <p className="note" style={{ marginTop: 10 }}>Goals recorded before match tracking began.</p>
          </section>
        )}
        {fixture && (
          <div className="card card--pad fixture">
            <span className="eyebrow">Next fixture</span>
            <div className="fixture__date">{weekdayName(fixture.date)} {formatLongDate(fixture.date)}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="grid-home">
        <div className="stack">
          <section aria-labelledby="latest-h" className="rise">
            <div className="sec-head"><h2 id="latest-h">Latest result</h2><a href="/matches">All results →</a></div>
            <Scoreboard match={latest} idx={idx} hero showLink />
          </section>

          {recent.length > 0 && (
            <section>
              <SectionHead title="Recent results" href="/matches" />
              <div className="card rows">{recent.map((m, i) => <MatchRow key={m.id} m={m} idx={idx} i={i} />)}</div>
            </section>
          )}

          {lead && (
            <section>
              <SectionHead title={lead.category === 'match-report' ? 'Featured match report' : 'Featured'} href="/news" linkLabel="All news" />
              <ArticleCard a={lead} idx={idx} lead />
            </section>
          )}
        </div>

        <aside className="stack">
          {fixture && (
            <section>
              <SectionHead title="Next up" />
              <div className="card card--pad fixture">
                <span className="eyebrow">Next Monday</span>
                <div className="fixture__date">{weekdayName(fixture.date)}<br />{formatLongDate(fixture.date)}</div>
                <div className="fixture__row">
                  {fixture.kickoff && <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><IconClock className="" />{fixture.kickoff}</span>}
                  {fixture.venue && <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><IconPin className="" />{fixture.venue}</span>}
                </div>
                {fixture.note && <p className="note">{fixture.note}</p>}
                <p className="note">Teams are picked on the night — line-ups appear with the result.</p>
              </div>
            </section>
          )}

          {potw && (
            <section>
              <SectionHead title="Player of the week" />
              <a className="card card--link card--pad potw" href={`/players/${potw}`}>
                <Avatar id={potw} name={idx.nameOf(potw)} photo={idx.players.get(potw)?.photo} size={72} />
                <div>
                  <div className="potw__name">{idx.nameOf(potw)}</div>
                  <div className="potw__sub" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <IconStar className="star" />
                    <span>{formatShortDate(latest.date)}</span>
                    {potwLine && potwLine.goals > 0 && <span><IconBall className="" /> {potwLine.goals}</span>}
                    {potwLine && potwLine.assists > 0 && <span>{potwLine.assists} ast</span>}
                  </div>
                  {potwStats && <div className="potw__sub">{potwStats.potm} award{potwStats.potm === 1 ? '' : 's'} all-time</div>}
                </div>
              </a>
            </section>
          )}

          <section>
            <div className="sec-head">
              <h2>Top scorers</h2>
              <div className="seg" role="group" aria-label="Scope">
                <button aria-pressed={scope === 'season'} onClick={() => setScope('season')}>{seasonLabel(seasonIdOf(latest.date, idx.startMonth))}</button>
                <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All</button>
              </div>
            </div>
            <div className="card"><TopList idx={idx} board="goals" period={period} /></div>
            <p style={{ marginTop: 10 }}><a className="link-more" href="/leaderboards">Full leaderboards →</a></p>
          </section>

          <section>
            <SectionHead title="Top assists" />
            <div className="card"><TopList idx={idx} board="assists" period={period} /></div>
          </section>
        </aside>
      </div>

      <section>
        <SectionHead title="Recent player form" href="/players" linkLabel="All players" />
        <div className="card">
          <ul className="plist">
            {formRows.map(({ s, g, a }, i) => (
              <li key={s.playerId}>
                <a className="prow rise" style={{ '--i': i, gridTemplateColumns: '40px minmax(0,1fr) auto auto' } as React.CSSProperties} href={`/players/${s.playerId}`}>
                  <Avatar id={s.playerId} name={idx.nameOf(s.playerId)} photo={idx.players.get(s.playerId)?.photo} size={38} />
                  <span className="prow__name">{idx.nameOf(s.playerId)}<small>{g} goals · {a} assists in last {Math.min(idx.formLength, s.appearances)}</small></span>
                  <FormStrip form={s.form} small />
                  <span />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {news.length > 0 && (
        <section>
          <SectionHead title="Latest news" href="/news" linkLabel="All news" />
          <div className="news-grid">{news.map((a, i) => <ArticleCard key={a.id} a={a} idx={idx} i={i} />)}</div>
        </section>
      )}
      {idx.matchesDesc.length === 0 && <Empty title="No results yet" />}
    </div>
  );
}
