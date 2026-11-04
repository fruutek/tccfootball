import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, updateDoc, where, writeBatch, addDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { emulatorHostPort } from './emulator-helpers';
import { mkMatch, mkPlayer } from './helpers';

let env: RulesTestEnvironment;

const published = { ...mkMatch({ id: '2026-11-02', date: '2026-11-02' }), status: 'published' };
const hidden = { ...mkMatch({ id: '2026-10-26', date: '2026-10-26' }), status: 'unpublished' };
const article = (id: string, status: string) => ({ id, slug: id, status, title: id, body: 'x', category: 'humour' });

beforeAll(async () => {
  const { host, port } = emulatorHostPort();
  env = await initializeTestEnvironment({
    projectId: 'demo-mnf-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'matches/2026-11-02'), published);
    await setDoc(doc(db, 'matches/2026-10-26'), hidden);
    await setDoc(doc(db, 'articles/live'), article('live', 'published'));
    await setDoc(doc(db, 'articles/draft'), article('draft', 'unpublished'));
    await setDoc(doc(db, 'players/peter'), mkPlayer('peter', 'Peter'));
    await setDoc(doc(db, 'settings/site'), { siteName: 'MNF', dataRevision: 1 });
    await setDoc(doc(db, 'settings/other'), { secret: true });
    await setDoc(doc(db, 'auditLog/a1'), { before: { secret: 1 }, after: null });
    await setDoc(doc(db, 'somethingElse/x'), { hello: 'world' });
  });
});

afterAll(async () => {
  await env.cleanup();
});

const anon = () => env.unauthenticatedContext().firestore();
const user = () => env.authenticatedContext('some-friend', { email_verified: true }).firestore();

describe.each([
  ['an anonymous visitor', anon],
  ['a signed-in user (no special rights exist)', user],
])('%s', (_label, ctxOf) => {
  describe('can read published content', () => {
    it('a published match', async () => {
      await assertSucceeds(getDoc(doc(ctxOf(), 'matches/2026-11-02')));
    });
    it('the list of published matches', async () => {
      const snap = await assertSucceeds(getDocs(query(collection(ctxOf(), 'matches'), where('status', '==', 'published'))));
      if (snap.size !== 1) throw new Error(`expected 1 published match, got ${snap.size}`);
    });
    it('published articles', async () => {
      await assertSucceeds(getDoc(doc(ctxOf(), 'articles/live')));
      await assertSucceeds(getDocs(query(collection(ctxOf(), 'articles'), where('status', '==', 'published'))));
    });
    it('players', async () => {
      await assertSucceeds(getDoc(doc(ctxOf(), 'players/peter')));
      await assertSucceeds(getDocs(collection(ctxOf(), 'players')));
    });
    it('the public site settings document', async () => {
      await assertSucceeds(getDoc(doc(ctxOf(), 'settings/site')));
    });
  });

  describe('cannot read anything unpublished or private', () => {
    it('an unpublished match', async () => {
      await assertFails(getDoc(doc(ctxOf(), 'matches/2026-10-26')));
    });
    it('matches without the published filter (would leak unpublished ones)', async () => {
      await assertFails(getDocs(collection(ctxOf(), 'matches')));
      await assertFails(getDocs(query(collection(ctxOf(), 'matches'), where('status', '==', 'unpublished'))));
    });
    it('an unpublished article, or an unfiltered article list', async () => {
      await assertFails(getDoc(doc(ctxOf(), 'articles/draft')));
      await assertFails(getDocs(collection(ctxOf(), 'articles')));
    });
    it('the audit log', async () => {
      await assertFails(getDoc(doc(ctxOf(), 'auditLog/a1')));
      await assertFails(getDocs(collection(ctxOf(), 'auditLog')));
      await assertFails(getDocs(query(collection(ctxOf(), 'auditLog'), limit(1))));
    });
    it('other settings documents, or the settings list', async () => {
      await assertFails(getDoc(doc(ctxOf(), 'settings/other')));
      await assertFails(getDocs(collection(ctxOf(), 'settings')));
    });
    it('collections that are not part of the app', async () => {
      await assertFails(getDoc(doc(ctxOf(), 'somethingElse/x')));
      await assertFails(getDocs(collection(ctxOf(), 'somethingElse')));
    });
  });

  describe('cannot write anything, anywhere', () => {
    it.each(['players/peter', 'players/new', 'matches/2026-11-02', 'matches/new', 'articles/live', 'articles/new', 'settings/site', 'settings/other', 'auditLog/a1', 'auditLog/new', 'somethingElse/x'])(
      'create/overwrite/update/delete at %s',
      async (path) => {
        const db = ctxOf();
        await assertFails(setDoc(doc(db, path), { status: 'published', hacked: true }));
        await assertFails(updateDoc(doc(db, path), { status: 'published' }));
        await assertFails(deleteDoc(doc(db, path)));
      },
    );
    it('auto-id creates and batched writes', async () => {
      const db = ctxOf();
      await assertFails(addDoc(collection(db, 'matches'), { status: 'published' }));
      const batch = writeBatch(db);
      batch.set(doc(db, 'players/evil'), { displayName: 'evil' });
      batch.delete(doc(db, 'matches/2026-11-02'));
      await assertFails(batch.commit());
    });
    it("cannot publish an unpublished match by flipping its status", async () => {
      await assertFails(updateDoc(doc(ctxOf(), 'matches/2026-10-26'), { status: 'published' }));
    });
    it('cannot bump the data revision to force other browsers to reload', async () => {
      await assertFails(updateDoc(doc(ctxOf(), 'settings/site'), { dataRevision: 999 }));
    });
  });
});

describe('after all the attacks, the data is untouched', () => {
  it('published match unchanged, unpublished still hidden', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const m = await getDoc(doc(db, 'matches/2026-11-02'));
      const h = await getDoc(doc(db, 'matches/2026-10-26'));
      const s = await getDoc(doc(db, 'settings/site'));
      if (!m.exists() || m.data().status !== 'published') throw new Error('published match was modified');
      if (!h.exists() || h.data().status !== 'unpublished') throw new Error('unpublished match was modified');
      if (s.data()?.dataRevision !== 1) throw new Error('settings were modified');
      if ((await getDoc(doc(db, 'players/evil'))).exists()) throw new Error('a player was created');
    });
  });
});
