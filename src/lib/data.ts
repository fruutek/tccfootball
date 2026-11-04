/**
 * Data loading for the website.
 *
 * Freshness without redeploys, and without paying for it on every page view:
 *
 *   1. Read ONE small document, settings/site, which carries `dataRevision`.
 *      Every write made by the publishing CLI bumps it.
 *   2. If it matches the revision of the copy cached in this browser, use the
 *      cache — that page view cost a single Firestore read.
 *   3. Otherwise fetch published matches, players and articles and re-cache.
 *
 * So a freshly published result shows up on the very next page load, while a
 * typical visit costs 1 read instead of hundreds (Spark plan: 50k reads/day).
 */
import { collection, doc, getDoc, getDocs, query, where, type Firestore } from 'firebase/firestore/lite';
import { useEffect, useSyncExternalStore } from 'react';
import type { Article, Match, Player, SiteSettings } from '../shared/schema';
import { getDb, isConfigured } from './firebase';

export interface SiteData {
  settings: SiteSettings | null;
  players: Player[];
  matches: Match[];
  articles: Article[];
  /** settings.dataRevision this snapshot corresponds to (0 when nothing is published yet). */
  revision: number;
}

export const EMPTY_DATA: SiteData = { settings: null, players: [], matches: [], articles: [], revision: 0 };

/* ----------------------------------------------------------- firestore */

export async function fetchSettings(db: Firestore): Promise<SiteSettings | null> {
  const snap = await getDoc(doc(db, 'settings', 'site'));
  return snap.exists() ? (snap.data() as SiteSettings) : null;
}

export async function fetchContent(db: Firestore, settings: SiteSettings | null): Promise<SiteData> {
  const [players, matches, articles] = await Promise.all([
    getDocs(collection(db, 'players')),
    getDocs(query(collection(db, 'matches'), where('status', '==', 'published'))),
    getDocs(query(collection(db, 'articles'), where('status', '==', 'published'))),
  ]);
  return {
    settings,
    players: players.docs.map((d) => d.data() as Player),
    matches: matches.docs.map((d) => d.data() as Match),
    articles: articles.docs.map((d) => d.data() as Article),
    revision: settings?.dataRevision ?? 0,
  };
}

/** Everything the site shows, straight from Firestore. Used by the browser store and by tests. */
export async function loadSiteDataFromFirestore(db: Firestore): Promise<SiteData> {
  return fetchContent(db, await fetchSettings(db));
}

/* --------------------------------------------------------------- cache */

const CACHE_KEY = 'mnf:data:v1';

function readCache(): SiteData | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SiteData;
    return parsed && Array.isArray(parsed.matches) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(data: SiteData): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    /* private mode / quota — the site works fine without a cache */
  }
}

/* --------------------------------------------------------------- store */

export type SiteState =
  | { status: 'loading'; data: null }
  | { status: 'ready'; data: SiteData; refreshing: boolean; offline: boolean }
  | { status: 'error'; data: SiteData | null; message: string };

const LOADING: SiteState = { status: 'loading', data: null };
let state: SiteState = LOADING;
let started = false;
const listeners = new Set<() => void>();

function set(next: SiteState) {
  state = next;
  // A hook for tests and diagnostics: "fresh" means the cache has been checked against
  // Firestore's current dataRevision (or replaced), so what is on screen is up to date.
  if (typeof document !== 'undefined') {
    document.documentElement.dataset['mnfData'] =
      next.status === 'ready' ? (next.refreshing ? 'cached' : next.offline ? 'offline' : 'fresh') : next.status;
  }
  listeners.forEach((l) => l());
}

export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getState = () => state;
const getServerState = () => LOADING;

/** Test hook: forget everything so a new load starts clean. */
export function resetSiteStore() {
  started = false;
  state = LOADING;
}

export async function startLoading(db?: Firestore): Promise<void> {
  if (started) return;
  started = true;
  const cached = readCache();
  if (cached) set({ status: 'ready', data: cached, refreshing: true, offline: false });

  if (!db && !isConfigured) {
    set({ status: 'error', data: cached, message: 'This site is not connected to Firebase yet (see docs/SETUP.md).' });
    return;
  }
  try {
    const firestore = db ?? getDb();
    const settings = await fetchSettings(firestore);
    const revision = settings?.dataRevision ?? 0;
    if (cached && cached.revision === revision && settings) {
      set({ status: 'ready', data: { ...cached, settings }, refreshing: false, offline: false });
      return;
    }
    const fresh = await fetchContent(firestore, settings);
    writeCache(fresh);
    set({ status: 'ready', data: fresh, refreshing: false, offline: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (cached) set({ status: 'ready', data: cached, refreshing: false, offline: true });
    else set({ status: 'error', data: null, message });
  }
}

/** React hook: current site data state; kicks off loading in the browser. */
export function useSiteState(): SiteState {
  useEffect(() => {
    void startLoading();
  }, []);
  return useSyncExternalStore(subscribe, getState, getServerState);
}
