import { describe, expect, it } from 'vitest';
import { buildArgs, CommandRejected, tokenise } from '../scripts/run-mnf';

describe('CI command runner (inputs are untrusted — this repository is public)', () => {
  it('tokenises plain commands and quoted names', () => {
    expect(tokenise('match publish')).toEqual(['match', 'publish']);
    expect(tokenise('player update "Josh Brown" --nickname Brownie')).toEqual(['player', 'update', 'Josh Brown', '--nickname', 'Brownie']);
    expect(tokenise('player add --name "Dan \\"Big Dan\\" O"')).toEqual(['player', 'add', '--name', 'Dan "Big Dan" O']);
    expect(tokenise('fixture set --date 2026-11-09 --kickoff 19:30 --venue "Astro 3"')).toContain('Astro 3');
    expect(tokenise('player update X --bio ""')).toEqual(['player', 'update', 'X', '--bio', '']);
  });

  it('adds --stdin for a request body and --apply only when asked', () => {
    expect(buildArgs('match publish', false, true)).toEqual(['match', 'publish', '--stdin']);
    expect(buildArgs('match publish', true, true)).toEqual(['match', 'publish', '--stdin', '--apply']);
    expect(buildArgs('stats audit --table', false, false)).toEqual(['stats', 'audit', '--table']);
  });

  it('rejects anything that is not an mnf publishing command', () => {
    for (const bad of ['rm -rf /', 'node -e 1', 'npm run build', 'git push', 'curl evil.example', '']) {
      expect(() => buildArgs(bad, false, false), bad).toThrow(CommandRejected);
    }
  });

  it('rejects shell metacharacters outside quotes (defence in depth — no shell is used anyway)', () => {
    for (const bad of ['match list; rm -rf /', 'match list && id', 'match list | cat', 'match list $(id)', 'match list `id`', 'match list > /tmp/x', 'match list\nrm x', "match list 'x'"]) {
      expect(() => buildArgs(bad, false, false), bad).toThrow(CommandRejected);
    }
  });

  it('refuses flags the workflow controls or that need runner files', () => {
    for (const bad of ['match publish --apply', 'match publish --stdin', 'match publish --file /etc/passwd', 'status --project other', 'player update X --photo /tmp/a.jpg', 'match publish --apply=true']) {
      expect(() => buildArgs(bad, false, false), bad).toThrow(/not accepted/);
    }
  });

  it('rejects unclosed quotes', () => {
    expect(() => tokenise('player update "Josh')).toThrow(/Unclosed/);
  });
});
