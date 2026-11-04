import { z } from 'zod';
import { ID_RE, slugify } from '../../src/shared/ids';
import { resolveName } from '../../src/shared/names';
import {
  ARTICLE_CATEGORIES,
  articleSchema,
  SCHEMA_VERSION,
  type Article,
  type ArticleCategory,
  type Player,
} from '../../src/shared/schema';
import type { Snapshot } from '../store';
import type { Clarification, Ctx, Plan } from '../types';
import { err, newPlan, op, seal, settingsOrDefault, warn } from './common';

export const articleSpecSchema = z
  .object({
    title: z.string().trim().min(1).max(140),
    standfirst: z.string().trim().min(1).max(320),
    body: z.string().trim().min(1).max(20_000),
    category: z.enum(ARTICLE_CATEGORIES),
    slug: z.string().optional(),
    author: z.string().trim().min(1).max(60).optional(),
    /** ISO date-time. Defaults to now. Use for back-dated pieces only. */
    publishedAt: z.iso.datetime({ offset: true }).optional(),
    featuredImage: z
      .object({ src: z.string(), alt: z.string(), credit: z.string().optional() })
      .strict()
      .optional(),
    matchId: z.string().optional(),
    /** Players the piece is about, by name. */
    players: z.array(z.string().trim().min(1)).max(30).optional(),
    fictional: z.boolean().optional(),
    instruction: z.string().max(4000).optional(),
  })
  .strict();
export type ArticleSpec = z.infer<typeof articleSpecSchema>;

export interface ArticleDraftFields {
  title: string;
  standfirst: string;
  body: string;
  category: ArticleCategory;
  author?: string | undefined;
  publishedAt?: string | undefined;
  featuredImage?: { src: string; alt: string; credit?: string | undefined } | undefined;
  matchId?: string | undefined;
  playerIds?: string[] | undefined;
  fictional?: boolean | undefined;
}

/** Builds a complete article document (validated by the caller with articleSchema). */
export function makeArticleDoc(
  id: string,
  f: ArticleDraftFields,
  ctx: Ctx,
  defaults: { byline: string },
  existing?: Article,
): Article {
  const now = ctx.now.toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    slug: id,
    status: existing?.status ?? 'published',
    title: f.title,
    standfirst: f.standfirst,
    body: f.body,
    category: f.category,
    author: f.author ?? existing?.author ?? defaults.byline,
    publishedAt: existing?.publishedAt ?? f.publishedAt ?? now,
    ...(f.featuredImage
      ? { featuredImage: { src: f.featuredImage.src, alt: f.featuredImage.alt, ...(f.featuredImage.credit ? { credit: f.featuredImage.credit } : {}) } }
      : {}),
    ...(f.matchId ? { matchId: f.matchId } : {}),
    ...(f.playerIds?.length ? { playerIds: [...new Set(f.playerIds)].sort() } : {}),
    ...(f.fictional || existing?.fictional ? { fictional: true as const } : {}),
    revision: (existing?.revision ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function defaultSlug(title: string, datePrefix?: string): string {
  const base = slugify(title, 'article');
  return datePrefix ? `${datePrefix}-${base}`.slice(0, 80).replace(/-+$/, '') : base;
}

export interface ArticleDetails {
  slug: string | null;
  action: 'create' | 'update' | null;
  url: string | null;
}

/** Resolves player names; returns ids or pushes clarifications. */
function resolvePlayers(names: string[] | undefined, players: readonly Player[], clarifications: Clarification[]): string[] {
  const ids: string[] = [];
  for (const n of names ?? []) {
    const r = resolveName(n, players);
    if (r.kind === 'resolved') ids.push(r.playerId);
    else if (r.kind === 'ambiguous') {
      clarifications.push({
        kind: 'ambiguous',
        input: n,
        where: 'article players',
        candidates: r.candidates.map(({ playerId, displayName }) => ({ playerId, displayName })),
        question: `"${n}" could be ${r.candidates.map((c) => `${c.displayName} (use "id:${c.playerId}")`).join(' or ')}. Which one?`,
      });
    } else {
      clarifications.push({
        kind: 'unknown',
        input: n,
        where: 'article players',
        suggestions: r.suggestions,
        question: `No player called "${n}". ${r.suggestions.length ? `Did you mean ${r.suggestions.map((s) => s.displayName).join(' or ')}?` : 'Create them first, or remove the name.'}`,
      });
    }
  }
  return ids;
}

export function planPublishArticle(
  snap: Snapshot,
  input: unknown,
  ctx: Ctx,
  opts: { update?: boolean } = {},
): Plan<ArticleDetails> {
  const parsed = articleSpecSchema.safeParse(input);
  const plan = newPlan<ArticleDetails>(opts.update ? 'article edit' : 'article publish', { slug: null, action: null, url: null });
  if (!parsed.success) {
    plan.errors.push(...parsed.error.issues.map((i) => err('SPEC_INVALID', `${i.path.join('.') || '(root)'}: ${i.message}`)));
    return seal(plan);
  }
  const spec = parsed.data;
  if (spec.instruction) plan.instruction = spec.instruction;

  const slug = spec.slug ?? defaultSlug(spec.title);
  if (!ID_RE.test(slug)) plan.errors.push(err('SLUG_INVALID', `Slug "${slug}" must be lowercase letters, numbers and hyphens.`));
  const existing = snap.articles.find((a) => a.id === slug);
  if (existing && !opts.update) {
    plan.errors.push(err('SLUG_EXISTS', `An article with slug "${slug}" already exists ("${existing.title}", ${existing.status}). Use "article edit" to change it, or choose a different slug.`));
  }
  if (!existing && opts.update) plan.errors.push(err('ARTICLE_NOT_FOUND', `No article with slug "${slug}".`));
  if (spec.matchId && !snap.matches.some((m) => m.id === spec.matchId)) {
    plan.errors.push(err('MATCH_NOT_FOUND', `matchId "${spec.matchId}" does not exist.`));
  }
  if (spec.category === 'match-report' && !spec.matchId) {
    plan.warnings.push(warn('REPORT_WITHOUT_MATCH', 'A match-report should have a matchId so it appears on the match page.'));
  }
  const dupTitle = snap.articles.find((a) => a.id !== slug && a.title.trim().toLowerCase() === spec.title.trim().toLowerCase());
  if (dupTitle) plan.warnings.push(warn('TITLE_DUPLICATE', `Another article already has this title (/news/${dupTitle.id}).`));

  const playerIds = resolvePlayers(spec.players, snap.players, plan.clarifications);
  if (plan.clarifications.length || plan.errors.length) return seal(plan);

  const doc = makeArticleDoc(
    slug,
    { ...spec, playerIds, ...(spec.fictional ? { fictional: true } : {}) },
    ctx,
    settingsOrDefault(snap.settings),
    existing,
  );
  const check = articleSchema.safeParse(doc);
  if (!check.success) {
    plan.errors.push(...check.error.issues.map((i) => err('ARTICLE_INVALID', `${i.path.join('.')}: ${i.message}`)));
    return seal(plan);
  }
  plan.details = { slug, action: existing ? 'update' : 'create', url: `/news/${slug}` };
  plan.ops.push(op('articles', slug, existing ? 'update' : 'create', existing ?? null, check.data, `${existing ? 'Updated' : 'Published'} article "${doc.title}"`));
  plan.summary = `${existing ? 'Update' : 'Publish'} ${spec.category} "${doc.title}" at /news/${slug}`;
  return seal(plan);
}

export function planArticleStatus(
  snap: Snapshot,
  slug: string,
  action: 'unpublish' | 'republish' | 'delete',
  ctx: Ctx,
): Plan<ArticleDetails> {
  const plan = newPlan<ArticleDetails>(`article ${action}`, { slug, action: null, url: null });
  const a = snap.articles.find((x) => x.id === slug);
  if (!a) {
    plan.errors.push(err('ARTICLE_NOT_FOUND', `No article with slug "${slug}".`));
    return seal(plan);
  }
  if (action === 'delete') {
    plan.ops.push(op('articles', slug, 'delete', a, null, `Deleted article "${a.title}"`));
    plan.summary = `Permanently delete "${a.title}" (can be restored from the audit log with "revert")`;
  } else {
    const status = action === 'unpublish' ? 'unpublished' : 'published';
    if (a.status === status) {
      plan.errors.push(err('NO_CHANGE', `"${a.title}" is already ${status}.`));
      return seal(plan);
    }
    plan.ops.push(op('articles', slug, 'update', a, { ...a, status, revision: a.revision + 1, updatedAt: ctx.now.toISOString() }, `${action === 'unpublish' ? 'Unpublished' : 'Republished'} article "${a.title}"`));
    plan.summary = `${action === 'unpublish' ? 'Unpublish' : 'Republish'} "${a.title}"`;
  }
  return seal(plan);
}
