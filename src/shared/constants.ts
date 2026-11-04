/**
 * Runtime constants shared by the website and the CLI.
 *
 * This file must stay free of heavy imports (notably zod): the browser bundle
 * imports from here, and only TYPES may be imported from ./schema.
 */
export const SCHEMA_VERSION = 1;

export const TEAM_KEYS = ['a', 'b'] as const;
export type TeamKey = (typeof TEAM_KEYS)[number];
export const otherTeam = (k: TeamKey): TeamKey => (k === 'a' ? 'b' : 'a');

export const COLLECTIONS = {
  players: 'players',
  matches: 'matches',
  articles: 'articles',
  settings: 'settings',
  audit: 'auditLog',
} as const;

export const SITE_SETTINGS_ID = 'site';

export const NAMED_COLOURS = [
  'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'teal', 'white', 'black', 'grey',
] as const;

export const ARTICLE_CATEGORIES = ['match-report', 'spotlight', 'roundup', 'humour', 'records'] as const;
export type ArticleCategory = (typeof ARTICLE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ArticleCategory, string> = {
  'match-report': 'Match report',
  spotlight: 'Player spotlight',
  roundup: 'Weekly roundup',
  humour: 'Humour',
  records: 'Records & milestones',
};
