import { useEffect, useState } from 'react';
import { formatLongDate, plural, readingMinutes } from '../lib/format';
import { Markdown } from '../lib/markdown';
import { CATEGORY_COLOURS } from '../lib/news';
import type { Index } from '../lib/view';
import { ARTICLE_CATEGORIES, CATEGORY_LABELS, type ArticleCategory } from '../shared/constants';
import type { Article } from '../shared/schema';
import { Scoreboard } from './Scoreboard';
import { Avatar, DemoTag, Empty, IconNews, PitchMark, SectionHead } from './ui';

export function ArticleCard({ a, idx, lead = false, i = 0 }: { a: Article; idx: Index; lead?: boolean; i?: number }) {
  const style = { '--cat': CATEGORY_COLOURS[a.category], '--i': Math.min(i, 8) } as React.CSSProperties;
  // Without a photo, a match report's cover IS the scoreline — real data, no stock art needed.
  const match = !a.featuredImage && a.matchId ? idx.matchesAsc.find((m) => m.id === a.matchId) : undefined;
  return (
    <a className={`card card--link acard rise ${lead ? 'acard--lead' : ''}`} style={style} href={`/news/${a.id}`}>
      <div className={`acard__cover ${a.featuredImage ? '' : 'typo'}`}>
        {a.featuredImage ? (
          <img src={a.featuredImage.src} alt={a.featuredImage.alt} loading="lazy" decoding="async" />
        ) : (
          <PitchMark className="pitchmark" />
        )}
        {match && (
          <div className="scorecover" aria-hidden>
            <span>{match.teams.a.name} v {match.teams.b.name}</span>
            <b>{match.score.a}–{match.score.b}</b>
          </div>
        )}
        <span className="acard__cat">{CATEGORY_LABELS[a.category]}</span>
      </div>
      <div className="acard__body">
        <h3 className="acard__title">{a.title}</h3>
        <p className="acard__stand">{a.standfirst}</p>
        <span className="acard__meta">
          {formatLongDate(a.publishedAt.slice(0, 10))} · {readingMinutes(a.body)} min read {a.fictional && <DemoTag />}
        </span>
      </div>
    </a>
  );
}

export function NewsIndex({ idx, initialCategory }: { idx: Index; initialCategory?: ArticleCategory | 'all' }) {
  const [cat, setCat] = useState<ArticleCategory | 'all'>(initialCategory ?? 'all');
  useEffect(() => {
    if (initialCategory) return;
    const c = new URLSearchParams(window.location.search).get('category');
    if (c && (ARTICLE_CATEGORIES as readonly string[]).includes(c)) setCat(c as ArticleCategory);
  }, [initialCategory]);
  useEffect(() => {
    if (initialCategory) return;
    window.history.replaceState(null, '', cat === 'all' ? window.location.pathname : `${window.location.pathname}?category=${cat}`);
  }, [cat, initialCategory]);

  const present = ARTICLE_CATEGORIES.filter((c) => idx.articlesDesc.some((a) => a.category === c));
  const list = idx.articlesDesc.filter((a) => cat === 'all' || a.category === cat);
  const [lead, ...rest] = list;
  return (
    <div className="page">
      <header>
        <h1 className="page-title">
          <small>THE PAPER</small>News
        </h1>
        <p className="page-sub">Match reports, player spotlights, weekly roundups, records — and the occasional bit of nonsense.</p>
      </header>
      <div className="chips" role="group" aria-label="Category">
        <button className="chip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>All</button>
        {present.map((c) => <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{CATEGORY_LABELS[c]}</button>)}
      </div>
      {!lead ? (
        <Empty title="Nothing published yet" icon={<IconNews />}>Match reports and features will appear here.</Empty>
      ) : (
        <>
          <ArticleCard a={lead} idx={idx} lead />
          {rest.length > 0 && <div className="news-grid">{rest.map((a, i) => <ArticleCard key={a.id} a={a} idx={idx} i={i} />)}</div>}
        </>
      )}
    </div>
  );
}

export function ArticleView({ idx, slug }: { idx: Index; slug: string | null }) {
  const a = slug ? idx.articlesDesc.find((x) => x.id === slug) : undefined;
  useEffect(() => {
    if (a) document.title = `${a.title} · Monday Night Football`;
  }, [a]);
  if (!a) {
    return (
      <div className="page">
        <Empty title="Article not found" icon={<IconNews />}>
          It may have been unpublished. <a href="/news" style={{ color: 'var(--accent)' }}>Back to news</a>.
        </Empty>
      </div>
    );
  }
  const match = a.matchId ? idx.matchesAsc.find((m) => m.id === a.matchId) : undefined;
  const related = idx.articlesDesc.filter((x) => x.id !== a.id).slice(0, 3);
  const players = (a.playerIds ?? []).filter((id) => idx.players.has(id));
  return (
    <div className="page">
      <article className="article" style={{ '--cat': CATEGORY_COLOURS[a.category] } as React.CSSProperties}>
        <a href="/news" className="link-more">← News</a>
        <div className="article__kicker">
          <span className="tag" style={{ background: CATEGORY_COLOURS[a.category], color: '#0b0d10' }}>{CATEGORY_LABELS[a.category]}</span>
          {a.fictional && <DemoTag />}
        </div>
        <h1>{a.title}</h1>
        <p className="article__stand">{a.standfirst}</p>
        <div className="byline">
          <span>By <b>{a.author}</b></span>
          <span>{formatLongDate(a.publishedAt.slice(0, 10))}</span>
          <span>{plural(readingMinutes(a.body), 'min')} read</span>
        </div>
        {a.featuredImage && (
          <figure className="article__img">
            <img src={a.featuredImage.src} alt={a.featuredImage.alt} />
            {a.featuredImage.credit && <figcaption>{a.featuredImage.credit}</figcaption>}
          </figure>
        )}
        <Markdown source={a.body} />
        {players.length > 0 && (
          <div className="stack-sm">
            <span className="eyebrow">In this story</span>
            <div className="controls">
              {players.map((id) => (
                <a key={id} className="chip" href={`/players/${id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Avatar id={id} name={idx.nameOf(id)} photo={idx.players.get(id)?.photo} size={22} />
                  {idx.nameOf(id)}
                </a>
              ))}
            </div>
          </div>
        )}
      </article>
      {match && (
        <section style={{ maxWidth: 900, width: '100%', marginInline: 'auto' }}>
          <SectionHead title="The match" />
          <Scoreboard match={match} idx={idx} showLink />
        </section>
      )}
      {related.length > 0 && (
        <section>
          <SectionHead title="More from the paper" href="/news" />
          <div className="news-grid">{related.map((r, i) => <ArticleCard key={r.id} a={r} idx={idx} i={i} />)}</div>
        </section>
      )}
    </div>
  );
}
