import { describe, expect, it } from 'vitest';
import { computeStats, statsFor } from '../src/shared/stats';
import { MemoryStore } from '../cli/store';
import { auditData } from '../cli/services/integrity';
import { purgeDemo, seedDemo, seedDemoDryRun } from '../cli/services/demo';
import type { Ctx } from '../cli/types';

const ctx: Ctx = { now: new Date('2026-11-04T10:00:00Z'), today: '2026-11-04', actor: 'test' };

describe('demo data', () => {
  it('seeds a complete, internally consistent, clearly fictional dataset', async () => {
    const store = new MemoryStore();
    const r = await seedDemo(store, ctx);
    expect(r.ok, r.lines.join('\n')).toBe(true);
    const snap = await store.load();
    expect(snap.players).toHaveLength(12);
    expect(snap.matches).toHaveLength(10);
    expect(snap.articles.length).toBeGreaterThanOrEqual(7);
    expect([...snap.players, ...snap.matches, ...snap.articles].every((d) => d.fictional === true)).toBe(true);
    expect(snap.settings).toMatchObject({ demoData: true });
    expect(snap.settings!.nextFixture).toMatchObject({ date: '2026-11-09' });
    // The latest match is last Monday, 2 Nov 2026.
    expect(snap.matches.map((m) => m.date).sort().at(-1)).toBe('2026-11-02');
    const audit = auditData(snap, ctx);
    expect(audit.problems).toEqual([]);
    expect(statsFor(computeStats(snap.matches), 'marco-rinaldi').goals).toBe(10);
  });

  it('purges only fictional documents and leaves real data alone', async () => {
    const store = new MemoryStore();
    await seedDemo(store, ctx);
    // A real player added after seeding must survive the purge.
    const { planAddPlayer } = await import('../cli/services/players');
    const { execute } = await import('../cli/services/execute');
    await execute(store, planAddPlayer(await store.load(), { name: 'Real Person' }, ctx), ctx, true);

    const dry = await purgeDemo(store, ctx, false);
    expect(dry.counts).toEqual({ players: 12, matches: 10, articles: expect.any(Number) });
    expect((await store.load()).matches).toHaveLength(10); // dry run removed nothing

    await purgeDemo(store, ctx, true);
    const snap = await store.load();
    expect(snap.players.map((p) => p.displayName)).toEqual(['Real Person']);
    expect(snap.matches).toHaveLength(0);
    expect(snap.articles).toHaveLength(0);
    expect(snap.settings).toMatchObject({ demoData: false, nextFixture: null });
    expect(auditData(snap, ctx).problems).toEqual([]);
  });

  it('refuses to seed over real matches, and previews without writing', async () => {
    const store = new MemoryStore();
    const preview = await seedDemoDryRun(store, ctx);
    expect(preview.ok).toBe(true);
    expect((await store.load()).players).toHaveLength(0);
  });
});
