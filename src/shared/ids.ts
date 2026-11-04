/** Stable-ID helpers shared by the publishing CLI and the tests. */

export const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Lower-case, accent-stripped, hyphenated slug. Never returns an empty string. */
export function slugify(input: string, fallback = 'item'): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || fallback;
}

/** `base`, or `base-2`, `base-3`… — the first one not in `taken`. */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not allocate a unique id for "${base}"`);
}

/** Match IDs are the date of the match, with `-2`, `-3`… for extra games on one day. */
export function matchIdFor(date: string, sequence = 1): string {
  return sequence <= 1 ? date : `${date}-${sequence}`;
}

/** Case/accent/punctuation-insensitive form used for name matching. */
export function normaliseName(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
