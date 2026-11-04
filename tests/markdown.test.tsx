import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/lib/markdown';

const html = (src: string) => renderToStaticMarkup(<Markdown source={src} />);

describe('safe markdown renderer', () => {
  it('renders the supported subset', () => {
    const out = html('## Heading\n\nA **bold** and *italic* line with `code`.\n\n> quote\n\n- one\n- two\n\n1. first\n2. second\n\n---');
    expect(out).toContain('<h2>Heading</h2>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
    expect(out).toContain('<code>code</code>');
    expect(out).toContain('<blockquote>quote</blockquote>');
    expect(out).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(out).toContain('<ol><li>first</li><li>second</li></ol>');
    expect(out).toContain('<hr/>');
  });

  it('never emits raw HTML: tags in content are escaped text', () => {
    const out = html('<script>alert(1)</script> <img src=x onerror=alert(1)> **<b>x</b>**');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;script&gt;');
  });

  it('only allows safe link targets', () => {
    expect(html('[ok](https://example.com/a)')).toContain('href="https://example.com/a"');
    expect(html('[ok](https://example.com/a)')).toContain('rel="noopener noreferrer"');
    expect(html('[local](/players/peter)')).toContain('href="/players/peter"');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', 'vbscript:x']) {
      const out = html(`[click](${bad})`);
      expect(out, bad).not.toContain('href=');
      expect(out).toContain('click');
    }
  });
});
