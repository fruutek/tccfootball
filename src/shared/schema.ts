/**
 * Firestore document schemas — the single definition of what is stored.
 *
 * The website imports only the *types* from this file (erased at build time, so
 * zod is never shipped to browsers). The publishing CLI uses the runtime
 * schemas to validate every document before it is written.
 *
 * Timestamps are ISO-8601 strings and match dates are "YYYY-MM-DD" strings:
 * they sort lexicographically, survive JSON caching and never shift time zone.
 */
import { z } from 'zod';
import {
  ARTICLE_CATEGORIES,
  NAMED_COLOURS,
  SCHEMA_VERSION,
  TEAM_KEYS,
} from './constants';
import { isValidDate } from './dates';
import { ID_RE } from './ids';

// Runtime constants live in ./constants (zod-free, safe for the browser bundle).
// They are re-exported here for the CLI's convenience.
export * from './constants';

const id = z.string().min(1).max(80).regex(ID_RE, 'must be a lowercase-hyphenated id');
const isoDate = z.string().refine(isValidDate, 'must be a real date, YYYY-MM-DD');
const isoDateTime = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
const minute = z.number().int().min(0).max(130);

/** A named team colour, or any 6-digit hex value. */
export const colour = z
  .string()
  .regex(new RegExp(`^(${NAMED_COLOURS.join('|')}|#[0-9a-fA-F]{6})$`), 'use a named colour or #rrggbb');

/* ----------------------------------------------------------------- players */

export const playerSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id,
    displayName: text(40),
    nickname: optionalText(30),
    /** Extra spellings used only to match names in natural-language instructions. */
    aliases: z.array(text(40)).max(10),
    /** Public path of an optimised static photo, e.g. "/photos/peter.3fa9c1.webp". */
    photo: z.string().regex(/^\/photos\/[a-z0-9._-]+\.(webp|jpg|png)$/).optional(),
    bio: optionalText(600),
    /**
     * Totals from BEFORE match records began (the one deliberate exception to "everything is derived
     * from matches"). Counted in all-time totals only, never in per-game rates, and always shown as
     * such. Remove them if the matches behind them are ever recorded, or they would be counted twice.
     */
    startingTotals: z
      .object({
        goals: z.number().int().min(0).max(999).optional(),
        assists: z.number().int().min(0).max(999).optional(),
      })
      .strict()
      .optional(),
    status: z.enum(['active', 'archived']),
    fictional: z.literal(true).optional(),
    revision: z.number().int().min(1),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .strict();
export type Player = z.infer<typeof playerSchema>;

/* ----------------------------------------------------------------- matches */

export const teamSchema = z
  .object({
    name: text(30),
    colour,
    playerIds: z.array(id).min(1).max(20),
  })
  .strict();
export type MatchTeam = z.infer<typeof teamSchema>;

export const matchEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('goal'),
      /** The team the goal counts for. */
      team: z.enum(TEAM_KEYS),
      /** Scorer, or null when the scorer is explicitly unknown. */
      playerId: id.nullable(),
      /** Assist on this specific goal, when it is known which goal it was. */
      assistId: id.optional(),
      minute: minute.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('own_goal'),
      /** The team the goal counts FOR (the scorer plays for the other team). */
      team: z.enum(TEAM_KEYS),
      playerId: id.nullable(),
      minute: minute.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('assist'),
      /** An assist whose goal is not known. Counts as an assist, links to no goal. */
      team: z.enum(TEAM_KEYS),
      playerId: id,
    })
    .strict(),
]);
export type MatchEvent = z.infer<typeof matchEventSchema>;

export const matchSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id,
    status: z.enum(['published', 'unpublished']),
    date: isoDate,
    kickoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    venue: optionalText(80),
    teams: z.object({ a: teamSchema, b: teamSchema }).strict(),
    score: z
      .object({ a: z.number().int().min(0).max(99), b: z.number().int().min(0).max(99) })
      .strict(),
    events: z.array(matchEventSchema).max(120),
    playerOfTheMatch: id.nullable(),
    /** DERIVED index of every participant, sorted. Verified by `stats audit`. */
    playerIds: z.array(id),
    /** Content hash used to refuse accidental duplicate publishing. */
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    fictional: z.literal(true).optional(),
    revision: z.number().int().min(1),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .strict();
export type Match = z.infer<typeof matchSchema>;

/* ---------------------------------------------------------------- articles */

export const articleSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    /** The slug is the document id and the URL: /news/<slug>. */
    id,
    slug: id,
    status: z.enum(['published', 'unpublished']),
    title: text(140),
    standfirst: text(320),
    /** Markdown subset: paragraphs, ## headings, **bold**, *italic*, > quotes, - lists, [links](https://…). */
    body: z.string().trim().min(1).max(20_000),
    category: z.enum(ARTICLE_CATEGORIES),
    author: text(60),
    publishedAt: isoDateTime,
    featuredImage: z
      .object({
        src: z.string().regex(/^\/images\/[a-zA-Z0-9._/-]+\.(webp|jpg|jpeg|png|avif)$/),
        alt: text(200),
        credit: optionalText(100),
      })
      .strict()
      .optional(),
    /** A match report points at its match; the match does not point back. */
    matchId: id.optional(),
    playerIds: z.array(id).max(30).optional(),
    fictional: z.literal(true).optional(),
    revision: z.number().int().min(1),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .strict();
export type Article = z.infer<typeof articleSchema>;

/* ---------------------------------------------------------------- settings */

export const siteSettingsSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    siteName: text(60),
    shortName: text(12),
    tagline: text(120),
    /** 1 = calendar-year seasons. 8 = seasons run August to July. */
    seasonStartMonth: z.number().int().min(1).max(12),
    /** Ceiling for the minimum-appearances rule on percentage / rate leaderboards. */
    minAppearances: z.number().int().min(1).max(50),
    formLength: z.number().int().min(3).max(10),
    byline: text(60),
    nextFixture: z
      .object({
        date: isoDate,
        kickoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
        venue: optionalText(80),
        note: optionalText(200),
      })
      .strict()
      .nullable(),
    /** True while fictional demo documents exist — the site shows a banner. */
    demoData: z.boolean(),
    /** Bumped on every write so browsers know when their cached copy is stale. */
    dataRevision: z.number().int().min(0),
    updatedAt: isoDateTime,
  })
  .strict();
export type SiteSettings = z.infer<typeof siteSettingsSchema>;

export const DEFAULT_SETTINGS: Omit<SiteSettings, 'updatedAt' | 'dataRevision'> = {
  schemaVersion: SCHEMA_VERSION,
  siteName: 'Monday Night Football',
  shortName: 'MNF',
  tagline: 'Every Monday. Every goal. Every argument.',
  seasonStartMonth: 1,
  minAppearances: 5,
  formLength: 5,
  byline: 'MNF Match Desk',
  nextFixture: null,
  demoData: false,
};

/* --------------------------------------------------------------- audit log */

export const auditEntrySchema = z
  .object({
    /** All entries written by one command share an opId — revert undoes them together. */
    opId: z.string(),
    at: isoDateTime,
    actor: z.string(),
    command: z.string(),
    summary: z.string(),
    collection: z.enum(['players', 'matches', 'articles', 'settings']),
    docId: z.string(),
    action: z.enum(['create', 'update', 'delete']),
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()).nullable(),
    /** The natural-language instruction that caused this change, if supplied. */
    instruction: z.string().max(4000).optional(),
    revertedBy: z.string().optional(),
  })
  .strict();
export type AuditEntry = z.infer<typeof auditEntrySchema>;
