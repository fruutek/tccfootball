import { describe, expect, it } from 'vitest';
import { resolveName } from '../src/shared/names';
import { mkPlayer } from './helpers';

const players = [
  mkPlayer('peter-hughes', 'Peter Hughes'),
  mkPlayer('adam', 'Adam', { nickname: 'Ads' }),
  mkPlayer('chris-b', 'Chris B'),
  mkPlayer('chris-w', 'Chris W'),
  mkPlayer('brownie', 'Brownie', { aliases: ['Mr Brown'] }),
  mkPlayer('josh', 'Josh'),
  mkPlayer('joshua-k', 'Joshua K'),
  mkPlayer('arun', 'Arun'),
];

describe('resolveName', () => {
  it('matches display names case- and accent-insensitively', () => {
    expect(resolveName('ADAM', players)).toMatchObject({ kind: 'resolved', playerId: 'adam', via: 'name' });
    expect(resolveName('  adam ', players)).toMatchObject({ kind: 'resolved', playerId: 'adam' });
  });

  it('matches nicknames, aliases and (as a fallback) ids', () => {
    expect(resolveName('peter-hughes', players)).toMatchObject({ kind: 'resolved', playerId: 'peter-hughes' });
    expect(resolveName('chris-w', players)).toMatchObject({ kind: 'resolved', playerId: 'chris-w' });
    expect(resolveName('Ads', players)).toMatchObject({ kind: 'resolved', playerId: 'adam', via: 'nickname' });
    expect(resolveName('mr brown', players)).toMatchObject({ kind: 'resolved', playerId: 'brownie', via: 'alias' });
  });

  it('resolves a unique first name', () => {
    expect(resolveName('Peter', players)).toMatchObject({ kind: 'resolved', playerId: 'peter-hughes', via: 'first-name' });
  });

  it('reports an ambiguous first name instead of guessing', () => {
    const r = resolveName('Chris', players);
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.candidates.map((c) => c.playerId).sort()).toEqual(['chris-b', 'chris-w']);
  });

  it('lets a human name beat another player whose id happens to equal it', () => {
    const tricky = [mkPlayer('josh', 'Josh K'), mkPlayer('josh-2', 'Josh')];
    expect(resolveName('Josh', tricky)).toMatchObject({ kind: 'resolved', playerId: 'josh-2', via: 'name' });
    expect(resolveName('josh-2', tricky)).toMatchObject({ kind: 'resolved', playerId: 'josh-2' });
  });

  it('prefers an exact full name over a longer name that merely starts with it', () => {
    expect(resolveName('Josh', players)).toMatchObject({ kind: 'resolved', playerId: 'josh', via: 'name' });
  });

  it('reports unknown names with suggestions, never auto-resolving fuzzy matches', () => {
    const r = resolveName('Pete', players);
    expect(r.kind).toBe('unknown');
    const typo = resolveName('Adamm', players);
    expect(typo.kind).toBe('unknown');
    if (typo.kind === 'unknown') expect(typo.suggestions.map((s) => s.playerId)).toContain('adam');
    const nobody = resolveName('Zinedine', players);
    expect(nobody).toMatchObject({ kind: 'unknown', suggestions: [] });
  });

  it('treats empty input as unknown', () => {
    expect(resolveName('   ', players).kind).toBe('unknown');
  });

  it('accepts an explicit id: prefix and never lets a stale id beat an ambiguous first name', () => {
    // "Chris B" was renamed from "Chris", so his stable id is still just "chris".
    const renamed = [mkPlayer('chris', 'Chris B'), mkPlayer('chris-w', 'Chris W')];
    expect(resolveName('Chris', renamed).kind).toBe('ambiguous');
    expect(resolveName('id:chris', renamed)).toMatchObject({ kind: 'resolved', playerId: 'chris' });
    expect(resolveName('id:nobody', renamed).kind).toBe('unknown');
  });
});
