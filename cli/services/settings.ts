import { z } from 'zod';
import { isMonday, isValidDate } from '../../src/shared/dates';
import { SITE_SETTINGS_ID, siteSettingsSchema, type SiteSettings } from '../../src/shared/schema';
import { freshSettings, type Snapshot } from '../store';
import type { Ctx, Plan } from '../types';
import { err, newPlan, op, seal, warn } from './common';

export const fixtureSchema = z
  .object({
    date: z.string().refine(isValidDate, 'must be a real date, YYYY-MM-DD'),
    kickoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use 24-hour HH:MM').optional(),
    venue: z.string().trim().min(1).max(80).optional(),
    note: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export interface SettingsDetails {
  changes: string[];
}

function withSettings(snap: Snapshot, ctx: Ctx): { cur: SiteSettings; exists: boolean } {
  return { cur: snap.settings ?? freshSettings(ctx.now), exists: Boolean(snap.settings) };
}

export function planSetFixture(snap: Snapshot, input: unknown, ctx: Ctx): Plan<SettingsDetails> {
  const plan = newPlan<SettingsDetails>('fixture set', { changes: [] });
  const parsed = fixtureSchema.safeParse(input);
  if (!parsed.success) {
    plan.errors.push(...parsed.error.issues.map((i) => err('SPEC_INVALID', `${i.path.join('.') || '(root)'}: ${i.message}`)));
    return seal(plan);
  }
  const f = parsed.data;
  if (f.date < ctx.today) plan.errors.push(err('FIXTURE_IN_PAST', `${f.date} is in the past (today is ${ctx.today}).`));
  if (!isMonday(f.date)) plan.warnings.push(warn('DATE_NOT_MONDAY', `${f.date} is not a Monday.`));
  const played = snap.matches.find((m) => m.date === f.date);
  if (played) plan.errors.push(err('FIXTURE_ALREADY_PLAYED', `A result is already recorded for ${f.date} (${played.id}).`));
  if (plan.errors.length) return seal(plan);

  const { cur, exists } = withSettings(snap, ctx);
  const next: SiteSettings = { ...cur, nextFixture: f, updatedAt: ctx.now.toISOString() };
  plan.details.changes = [`next fixture → ${f.date}${f.kickoff ? ` ${f.kickoff}` : ''}${f.venue ? ` at ${f.venue}` : ''}`];
  plan.ops.push(op('settings', SITE_SETTINGS_ID, exists ? 'update' : 'create', exists ? cur : null, next, `Set next fixture ${f.date}`));
  plan.summary = `Set the next fixture for ${f.date}`;
  return seal(plan);
}

export function planClearFixture(snap: Snapshot, ctx: Ctx): Plan<SettingsDetails> {
  const plan = newPlan<SettingsDetails>('fixture clear', { changes: [] });
  if (!snap.settings?.nextFixture) {
    plan.errors.push(err('NO_CHANGE', 'There is no next fixture set.'));
    return seal(plan);
  }
  plan.ops.push(op('settings', SITE_SETTINGS_ID, 'update', snap.settings, { ...snap.settings, nextFixture: null, updatedAt: ctx.now.toISOString() }, `Cleared next fixture (${snap.settings.nextFixture.date})`));
  plan.summary = `Clear the next fixture (${snap.settings.nextFixture.date})`;
  return seal(plan);
}

const settingsPatchSchema = z
  .object({
    siteName: z.string().trim().min(1).max(60),
    shortName: z.string().trim().min(1).max(12),
    tagline: z.string().trim().min(1).max(120),
    byline: z.string().trim().min(1).max(60),
    seasonStartMonth: z.coerce.number().int().min(1).max(12),
    minAppearances: z.coerce.number().int().min(1).max(50),
    formLength: z.coerce.number().int().min(3).max(10),
  })
  .partial()
  .strict();

export const SETTINGS_KEYS = Object.keys(settingsPatchSchema.shape);

export function planSetSettings(snap: Snapshot, input: Record<string, unknown>, ctx: Ctx): Plan<SettingsDetails> {
  const plan = newPlan<SettingsDetails>('settings set', { changes: [] });
  const parsed = settingsPatchSchema.safeParse(input);
  if (!parsed.success) {
    plan.errors.push(...parsed.error.issues.map((i) => err('SPEC_INVALID', `${i.path.join('.') || '(root)'}: ${i.message}. Allowed keys: ${SETTINGS_KEYS.join(', ')}`)));
    return seal(plan);
  }
  const { cur, exists } = withSettings(snap, ctx);
  const next: SiteSettings = { ...cur, ...parsed.data, updatedAt: ctx.now.toISOString() };
  const changes = Object.entries(parsed.data).filter(([k, v]) => (cur as Record<string, unknown>)[k] !== v).map(([k, v]) => `${k}: ${String((cur as Record<string, unknown>)[k])} → ${String(v)}`);
  if (!changes.length) {
    plan.errors.push(err('NO_CHANGES', 'Those settings already have the requested values.'));
    return seal(plan);
  }
  if (parsed.data.seasonStartMonth !== undefined) {
    plan.warnings.push(warn('SEASON_REBUCKET', 'Changing the season start month re-buckets all history into the new seasons. No match data is modified.'));
  }
  const check = siteSettingsSchema.safeParse(next);
  if (!check.success) {
    plan.errors.push(...check.error.issues.map((i) => err('SETTINGS_INVALID', `${i.path.join('.')}: ${i.message}`)));
    return seal(plan);
  }
  plan.details.changes = changes;
  plan.ops.push(op('settings', SITE_SETTINGS_ID, exists ? 'update' : 'create', exists ? cur : null, check.data, `Settings: ${changes.join('; ')}`));
  plan.summary = `Change settings — ${changes.join('; ')}`;
  return seal(plan);
}
