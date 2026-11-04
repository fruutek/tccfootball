/**
 * A deliberately small Markdown renderer for article bodies.
 *
 * Supports: paragraphs, ## / ### headings, > quotes, - and 1. lists, ---,
 * **bold**, *italic*, `code`, [links](https://…). It builds React elements
 * directly and NEVER emits raw HTML, so content from the database cannot inject
 * markup or scripts. Links are limited to http(s), mailto and site-relative URLs.
 */
import { Fragment, type ReactNode } from 'react';

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;
const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/))/i;

export function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyPrefix}${i}`;
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={key}>{renderInline(part.slice(2, -2), key)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={key}>{part.slice(1, -1)}</code>;
    if ((part.startsWith('*') && part.endsWith('*') || part.startsWith('_') && part.endsWith('_')) && part.length > 2) {
      return <em key={key}>{renderInline(part.slice(1, -1), key)}</em>;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const [, label, href] = link;
      if (!SAFE_URL.test(href!)) return <Fragment key={key}>{label}</Fragment>;
      const external = /^https?:/i.test(href!);
      return (
        <a key={key} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {label}
        </a>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let para: string[] = [];
  let k = 0;
  const key = () => `b${k++}`;

  const flushPara = () => {
    if (para.length) {
      out.push(<p key={key()}>{renderInline(para.join(' '), `p${k}`)}</p>);
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) {
      flushPara();
      continue;
    }
    const heading = /^(#{2,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushPara();
      out.push(heading[1]!.length === 2 ? <h2 key={key()}>{renderInline(heading[2]!)}</h2> : <h3 key={key()}>{renderInline(heading[2]!)}</h3>);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushPara();
      out.push(<hr key={key()} />);
      continue;
    }
    if (trimmed.startsWith('>')) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) quote.push(lines[i]!.trim().replace(/^>\s?/, '')), i++;
      i--;
      out.push(<blockquote key={key()}>{renderInline(quote.join(' '))}</blockquote>);
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      const items: string[] = [];
      while (i < lines.length) {
        const m = (ordered ? /^\d+[.)]\s+(.+)$/ : /^[-*]\s+(.+)$/).exec(lines[i]!.trim());
        if (!m) break;
        items.push(m[1]!);
        i++;
      }
      i--;
      const lis = items.map((it, n) => <li key={n}>{renderInline(it, `l${n}`)}</li>);
      out.push(ordered ? <ol key={key()}>{lis}</ol> : <ul key={key()}>{lis}</ul>);
      continue;
    }
    para.push(trimmed);
  }
  flushPara();
  return out;
}

export function Markdown({ source }: { source: string }) {
  return <div className="prose">{renderMarkdown(source)}</div>;
}
