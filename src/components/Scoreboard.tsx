import type { Index } from '../lib/view';
import { formatLongDate, teamColour, weekdayName } from '../lib/format';
import { minuteLabel, outcome, scorerLines } from '../lib/match';
import type { Match, TeamKey } from '../shared/schema';
import { IconArrow, IconBall, IconPin, IconStar, PitchBackdrop } from './ui';

function Scorers({ m, team, idx }: { m: Match; team: TeamKey; idx: Index }) {
  const lines = scorerLines(m, team, idx.nameOf);
  if (lines.length === 0) return <span className="faint">{m.score[team] === 0 ? '—' : ''}</span>;
  return (
    <ul className={team}>
      {lines.map((l) => (
        <li key={l.key}>
          <span className="scorer">
            {team === 'a' && l.minutes.length > 0 && <small>{minuteLabel(l.minutes)}</small>}
            {team === 'a' && l.goals > 1 && l.minutes.length === 0 && <small>×{l.goals}</small>}
            <span className={l.unknown ? 'dim' : undefined}>
              {l.name}
              {l.own && !l.unknown ? ' (OG)' : ''}
            </span>
            {team === 'b' && l.minutes.length > 0 && <small>{minuteLabel(l.minutes)}</small>}
            {team === 'b' && l.goals > 1 && l.minutes.length === 0 && <small>×{l.goals}</small>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The broadcast-style scoreboard. Team colours sit on the top edge, the score is
 * the loudest thing on the page, and scorers are listed under their own team.
 */
export function Scoreboard({ match: m, idx, hero = false, showLink = false }: { match: Match; idx: Index; hero?: boolean; showLink?: boolean }) {
  const win = outcome(m);
  const potm = m.playerOfTheMatch;
  const cA = teamColour(m.teams.a.colour);
  const cB = teamColour(m.teams.b.colour);
  return (
    <article className={`board ${hero ? 'board--hero' : ''}`} aria-label={`${m.teams.a.name} ${m.score.a}, ${m.teams.b.name} ${m.score.b}`}>
      <PitchBackdrop />
      <div className="board__bar" aria-hidden>
        <span style={{ background: cA }} />
        <span style={{ background: cB }} />
      </div>
      <div className="board__body">
        <div className="board__meta">
          <span className="tag tag--accent">Full time</span>
          <span>
            {weekdayName(m.date)} {formatLongDate(m.date)}
          </span>
          {m.kickoff && <span>{m.kickoff} kick-off</span>}
          {m.venue && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <IconPin className="" />
              {m.venue}
            </span>
          )}
          {m.fictional && <span className="tag tag--demo">Demo</span>}
        </div>

        <div className="board__main">
          <div className="team team--a" style={{ '--c': cA } as React.CSSProperties}>
            <span className="team__name">{m.teams.a.name}</span>
            <span className="team__sub">
              <i className="swatch" /> {m.teams.a.playerIds.length} players
            </span>
          </div>
          <div className="score" aria-hidden>
            <span className={`score__n pop ${win === 'a' ? 'win' : win === 'draw' ? '' : 'lose'}`}>{m.score.a}</span>
            <span className="score__dash" />
            <span className={`score__n pop ${win === 'b' ? 'win' : win === 'draw' ? '' : 'lose'}`} style={{ animationDelay: '90ms' }}>
              {m.score.b}
            </span>
          </div>
          <div className="team team--b" style={{ '--c': cB } as React.CSSProperties}>
            <span className="team__name">{m.teams.b.name}</span>
            <span className="team__sub">
              <i className="swatch" /> {m.teams.b.playerIds.length} players
            </span>
          </div>
        </div>

        {m.events.some((e) => e.type !== 'assist') && (
          <div className="board__scorers">
            <Scorers m={m} team="a" idx={idx} />
            <Scorers m={m} team="b" idx={idx} />
          </div>
        )}

        {(potm || showLink) && (
          <div className="board__foot">
            {potm ? (
              <span className="potm">
                <IconStar />
                <span>
                  <span className="eyebrow">Player of the match</span>
                  <br />
                  <a href={`/players/${potm}`} style={{ fontWeight: 700 }}>
                    {idx.nameOf(potm)}
                  </a>
                </span>
              </span>
            ) : (
              <span />
            )}
            {showLink && (
              <a className="btn" href={`/matches/${m.id}`}>
                Match centre <IconArrow />
              </a>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export function EmptyBoard() {
  return (
    <div className="board">
      <PitchBackdrop />
      <div className="board__body" style={{ textAlign: 'center', padding: '56px 20px' }}>
        <IconBall className="" />
        <div className="display" style={{ fontSize: 40, marginTop: 8 }}>
          Kick-off soon
        </div>
        <p className="dim">The first result will appear here the moment it is published.</p>
      </div>
    </div>
  );
}
