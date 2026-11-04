/**
 * End-to-end proof of the whole workflow, in a real browser:
 *
 *   natural-language-style request → mnf CLI → Firestore → live site
 *
 * Runs under `firebase emulators:exec` (see `npm run test:e2e`): the built site is
 * served by the Hosting emulator, data lives in the Firestore emulator, and the
 * emulated Firestore enforces the real firestore.rules.
 *
 * The decisive checks are the ones that publish, edit and unpublish results
 * WHILE THE SITE STAYS EXACTLY AS BUILT — no redeploy — and watch the page change.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright-core';

const SITE = process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:5000';
const SHOTS = 'docs/screenshots';
const failures: string[] = [];
let checks = 0;

function check(ok: boolean, what: string, detail = '') {
  checks++;
  console.log(`${ok ? '  ✔' : '  ✖'} ${what}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures.push(what);
}
const step = (s: string) => console.log(`\n▶ ${s}`);

function mnf(args: string[], opts: { input?: string; today?: string } = {}) {
  const r = spawnSync('npx', ['tsx', 'cli/index.ts', ...args], {
    input: opts.input,
    encoding: 'utf8',
    env: { ...process.env, MNF_PROJECT: 'demo-mnf', MNF_TODAY: opts.today ?? '2026-11-04' },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout };
}

const hashDist = () => createHash('sha256').update(readFileSync('dist/index.html')).update(readFileSync('dist/matches/_.html')).digest('hex');

/** Visible text without CSS text-transform (innerText would turn headings into CAPITALS). */
async function text(page: Page, selector = 'body') {
  return (await page.locator(selector).first().evaluate((el) => (el as HTMLElement).textContent ?? '')).replace(/\s+/g, ' ');
}
/** Waits for the element AND for the page to have confirmed its data is current (not just cached). */
async function ready(page: Page, sel: string) {
  await page.waitForSelector(sel, { timeout: 15_000 });
  await page.waitForSelector('html[data-mnf-data="fresh"], html[data-mnf-data="error"]', { state: 'attached', timeout: 15_000 });
}
/** Entrance animations are staggered; give them time to finish so screenshots are of the settled page. */
const settle = (page: Page) => page.waitForTimeout(1300);
async function noHorizontalScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(over <= 1, `${label}: no horizontal scroll on mobile`, `overflow ${over}px`);
}

async function main() {
  if (!existsSync('dist/index.html')) throw new Error('Run `npm run build:emulator` first.');
  const executablePath = process.env['CHROME_BIN'] && existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : process.env['CHROME_BIN'];
  const browser: Browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
  const errors: string[] = [];
  // The security step below deliberately provokes 403s; the browser logs those as console errors.
  let probing = false;
  const ctxDesktop = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctxDesktop.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !probing && !/favicon|Failed to load resource.*404/.test(m.text()) && errors.push(`console: ${m.text()}`));

  /* ---------------------------------------------------------------- 1 */
  step('Empty database: the site renders a graceful empty state, not an error');
  await page.goto(SITE);
  await ready(page, 'text=Kick-off soon');
  check(true, 'home page shows the "Kick-off soon" empty state');
  check(!(await text(page)).includes("Can't load"), 'no error banner');

  /* ---------------------------------------------------------------- 2 */
  step('Seed fictional demo data through the real CLI');
  const seed = mnf(['demo', 'seed', '--apply']);
  check(seed.code === 0 && seed.out.includes('Published 10 fictional matches'), 'mnf demo seed --apply', seed.out.slice(-400));
  const audit0 = mnf(['stats', 'audit']);
  check(audit0.code === 0 && audit0.out.includes('AUDIT PASSED'), 'integrity audit passes on the seeded data', audit0.out.slice(-400));

  /* ---------------------------------------------------------------- 3 */
  step('Home page renders Firestore content');
  await page.goto(SITE);
  await ready(page, '.board--hero');
  let body = await text(page);
  check(body.includes('Red Team') && body.includes('Blue Team'), 'latest result shows both team names');
  check((await page.locator('.board--hero .score__n').allInnerTexts()).join('-') === '3-0', 'latest result shows the 3–0 score');
  check(body.includes('Marco Rinaldi'), 'scorers / player of the match appear');
  check(body.includes('DEMO') && body.includes('fictional test data'), 'DEMO banner is shown while fictional data exists');
  check(body.includes('Next up') && body.includes('Demo Pitch 2'), 'next fixture is shown');
  check(body.includes('Top scorers') && body.includes('Top assists') && body.includes('Player of the week') && body.includes('Latest news') && body.includes('Recent player form'), 'every homepage section is present');
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/home-desktop.png`, fullPage: true });

  /* ---------------------------------------------------------------- 4 */
  step('Match centre (served through the Hosting rewrite /matches/** → shell)');
  await page.goto(`${SITE}/matches/2026-11-02`);
  await ready(page, '.board');
  body = await text(page);
  check(body.includes('Starting line-ups') && body.includes('Goals & assists') && body.includes('Match report'), 'match centre has summary, line-ups and report');
  check(body.includes("12'") && body.includes("31'") && body.includes("47'") && body.includes('Assist: Danny Okafor'), 'goal minutes and the linked assist are shown');
  check(body.includes('Marco double keeps Red Team in front'), 'the match report is shown on the match page');
  check((await page.locator('.mnav a').count()) >= 1 && (await page.locator('.mnav a.prev').count()) === 1, 'previous-match navigation is present');
  check((await page.title()).includes('Red Team 3–0 Blue Team'), 'document title reflects the match');
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/match-desktop.png`, fullPage: true });

  /* ---------------------------------------------------------------- 5 */
  step('Leaderboards');
  await page.goto(`${SITE}/leaderboards`);
  await ready(page, '.table');
  body = await text(page);
  check((await text(page, '.table tbody tr')).includes('Marco Rinaldi'), 'Marco Rinaldi leads the scoring table');
  check((await text(page, '.pod--1')).includes('10'), 'the leader has 10 goals (matches the integrity audit)');
  await page.getByRole('tab', { name: 'Top assists' }).click();
  check((await text(page, '.table tbody tr')).includes('Danny Okafor'), 'switching to assists changes the leader');
  await page.getByRole('tab', { name: 'Win rate' }).click();
  check((await text(page, '.page')).includes('minimum'), 'rate leaderboards state their minimum-appearances rule');
  await page.getByRole('button', { name: 'Season' }).click();
  check(await page.locator('select[aria-label="Season"]').isVisible(), 'season filter appears');
  await page.getByRole('button', { name: 'Month' }).click();
  check(await page.locator('select[aria-label="Month"]').isVisible(), 'month filter appears');
  await page.getByRole('button', { name: 'All-time' }).click();
  await page.getByRole('tab', { name: 'Top scorers' }).click();
  await page.getByRole('button', { name: /^Assists/ }).click(); // sort by a column
  check((await page.locator('th[aria-sort]').count()) === 1, 'column sorting works');
  await page.getByRole('tab', { name: 'Top scorers' }).click();
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/leaderboards-desktop.png`, fullPage: true });

  /* ---------------------------------------------------------------- 6 */
  step('Player profile');
  await page.goto(`${SITE}/players/marco-rinaldi`);
  await ready(page, '.phero');
  body = await text(page);
  check(body.includes('Marco Rinaldi') && body.includes('The Maestro'), 'name and nickname');
  check(/Goals\s*10/.test(body) && /Appearances\s*10/.test(body), 'career goals and appearances are derived from matches');
  check(body.includes('Match history') && body.includes('Awards') && body.includes('By season'), 'history, awards and season table');
  check((await page.locator('.avatar').first().innerText()).trim() === 'MR', 'placeholder avatar (initials) is used when there is no photo');
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/player-desktop.png`, fullPage: true });
  await page.goto(`${SITE}/players`);
  await ready(page, '.pgrid');
  check((await page.locator('.pcard').count()) === 12, 'players directory lists all 12 players');

  /* ---------------------------------------------------------------- 7 */
  step('News and results archive');
  await page.goto(`${SITE}/news`);
  await ready(page, '.acard');
  check((await page.locator('.acard').count()) >= 7, 'news index lists the articles');
  const slug = await page.locator('a.acard').first().getAttribute('href');
  await page.goto(`${SITE}${slug}`);
  await ready(page, '.article h1');
  check((await page.locator('.prose p').count()) >= 2, 'article body renders');
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/article-desktop.png`, fullPage: true });
  await page.goto(`${SITE}/matches`);
  await ready(page, '.mrow');
  check((await page.locator('.mrow').count()) === 10, 'results archive lists all 10 matches');

  /* ---------------------------------------------------------------- 8 */
  step('Cost control: an unchanged revisit makes exactly one Firestore read');
  await page.goto(SITE);
  await ready(page, '.board--hero');
  const reads: string[] = [];
  page.on('request', (r) => /127\.0\.0\.1:8080|localhost:8080/.test(r.url()) && reads.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 90)}`));
  await page.reload();
  await ready(page, '.board--hero');
  await page.waitForTimeout(600);
  check(reads.length === 1 && /:batchGet/.test(reads[0] ?? ''), 'exactly ONE read (the small settings/site revision document); everything else comes from the local cache', `${reads.length} requests: ${reads.join(' | ')}`);
  check(!reads.some((r) => /runQuery|listen/i.test(r)), 'no collection queries were run');

  /* ---------------------------------------------------------------- 9 */
  step('★ LIVE PUBLISH: a new result goes online with NO redeploy');
  const distBefore = hashDist();
  const request = {
    date: '2026-11-09',
    kickoff: '19:30',
    teams: {
      a: { name: 'Greens', colour: 'green', players: ['Marco', 'Leo', 'Ben', 'Jack', 'Sami'] },
      b: { name: 'Oranges', colour: 'orange', players: ['Danny', 'Kofi', 'Ravi', 'Eddie', 'Yusuf'] },
    },
    score: { a: 4, b: 2 },
    events: [
      { type: 'goal', player: 'Marco', count: 3 },
      { type: 'goal', player: 'Ben' },
      { type: 'goal', player: 'Danny' },
      { type: 'goal', player: 'Kofi' },
      { type: 'assist', player: 'Leo' },
    ],
    playerOfTheMatch: 'Marco',
    fictional: true,
    instruction: 'e2e: Greens beat Oranges 4-2, Marco hat-trick',
  };
  const dry = mnf(['match', 'publish', '--stdin'], { input: JSON.stringify(request), today: '2026-11-11' });
  check(dry.code === 0 && dry.out.includes('DRY RUN') && dry.out.includes('Marco Rinaldi scored a hat-trick.'), 'dry run succeeds and the fact sheet reports the hat-trick', dry.out.slice(-600));
  const report = {
    title: 'Marco hat-trick sends the Greens past the Oranges',
    standfirst: 'Greens 4-2 Oranges, with a Marco Rinaldi hat-trick the story of the night.',
    body: 'Marco Rinaldi scored three times as the Greens beat the Oranges 4-2.\n\nBen Calloway added the fourth, with Danny Okafor and Kofi Mensah replying for the Oranges.\n\nMarco was named player of the match.\n\n*Demo data — fictional.*',
  };
  const pub = mnf(['match', 'publish', '--stdin', '--apply'], { input: JSON.stringify({ ...request, report }), today: '2026-11-11' });
  check(pub.code === 0 && pub.out.includes('Done') && pub.out.includes('/matches/2026-11-09'), 'publish --apply succeeds', pub.out.slice(-700));
  check(!pub.out.includes('REPORT_'), 'the report passes the fact-check lint', pub.out);
  const opId = /revert (op_\w+) --apply/.exec(pub.out)?.[1];

  // The page that was already open still holds the OLD data (it is only fetched on page load)…
  check((await page.locator('.board--hero .score__n').allInnerTexts()).join('-') === '3-0', 'the already-open page still shows the old result (no push, no redeploy)');
  // …but the very next page load picks the change up, because settings/site.dataRevision moved.
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.board--hero')?.textContent?.includes('Greens'), null, { timeout: 15_000 });
  check((await page.locator('.board--hero .score__n').allInnerTexts()).join('-') === '4-2', 'after a reload the new 4–2 result is the latest result');
  body = await text(page);
  check(body.includes('Greens') && body.includes('Oranges') && body.includes('Marco Rinaldi'), 'new teams and scorers are shown');
  check(!body.includes('Next up'), 'the played fixture was cleared automatically');
  check(hashDist() === distBefore, 'the built site files are byte-identical — nothing was redeployed');

  await page.goto(`${SITE}/matches/2026-11-09`);
  await ready(page, '.board');
  body = await text(page);
  check(body.includes('Greens') && body.includes('Marco hat-trick sends the Greens past the Oranges'), 'new match page and its report are live');
  check((await page.locator('.mnav a.prev').getAttribute('href')) === '/matches/2026-11-02', 'previous-match link points at the earlier game');
  await page.goto(`${SITE}/leaderboards`);
  await ready(page, '.table');
  check((await text(page, '.pod--1')).includes('13'), 'leaderboard updated: Marco now has 13 goals (10 + 3)');
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/home-after-publish.png` });

  const dup = mnf(['match', 'publish', '--stdin', '--apply'], { input: JSON.stringify(request), today: '2026-11-11' });
  check(dup.code === 2 && dup.out.includes('MATCH_EXISTS'), 'publishing the same result again is refused', dup.out.slice(-300));

  /* --------------------------------------------------------------- 10 */
  step('★ LIVE EDIT: correcting a historical result recalculates everyone');
  const dannyBefore = await (async () => {
    await page.goto(`${SITE}/players/danny-okafor`);
    await ready(page, '.phero');
    return text(page);
  })();
  const dannyPotm = Number(/Player of match\s*(\d+)/.exec(dannyBefore)?.[1]);
  const showed = mnf(['match', 'list', '--limit', '20']);
  const hatTrickMatch = /(\d{4}-\d{2}-\d{2})\s+Bibs 5–1 Skins/.exec(showed.out)?.[1] ?? '';
  check(Boolean(hatTrickMatch), 'found the Bibs 5–1 Skins match', showed.out);
  const spec = JSON.parse(mnf(['match', 'show', hatTrickMatch, '--spec']).stdout) as Record<string, unknown>;
  spec['playerOfTheMatch'] = 'Kofi';
  const editDry = mnf(['match', 'edit', hatTrickMatch, '--stdin'], { input: JSON.stringify(spec), today: '2026-11-11' });
  check(editDry.code === 0 && editDry.out.includes('potm 1→0') && editDry.out.includes('Kofi Mensah'), 'edit dry run lists exactly which statistics change', editDry.out.slice(-500));
  const edit = mnf(['match', 'edit', hatTrickMatch, '--stdin', '--apply'], { input: JSON.stringify(spec), today: '2026-11-11' });
  check(edit.code === 0 && edit.out.includes('Done'), 'edit --apply succeeds', edit.out.slice(-400));
  await page.goto(`${SITE}/players/danny-okafor`);
  await ready(page, '.phero');
  const dannyAfter = Number(/Player of match\s*(\d+)/.exec(await text(page))?.[1]);
  check(dannyPotm === 1 && dannyAfter === 0, `Danny's player-of-the-match count fell ${dannyPotm} → ${dannyAfter} on the live site`);

  /* --------------------------------------------------------------- 11 */
  step('★ LIVE REVERT / UNPUBLISH');
  const rev = mnf(['revert', opId ?? 'missing', '--apply'], { today: '2026-11-11' });
  check(rev.code === 0 && rev.out.includes('Done'), 'revert of the publish operation succeeds', rev.out.slice(-400));
  await page.goto(SITE);
  await ready(page, '.board--hero');
  check((await page.locator('.board--hero .score__n').allInnerTexts()).join('-') === '3-0', 'after the revert the 3–0 result is the latest again');
  await page.goto(`${SITE}/matches/2026-11-09`);
  await ready(page, 'text=Match not found');
  check(true, 'the reverted match page says "Match not found"');

  /* --------------------------------------------------------------- 12 */
  step('Security: what an anonymous visitor can and cannot do against Firestore');
  probing = true;
  const probe = async (method: string, path: string, body?: unknown) =>
    page.evaluate(
      async ([m, p, b]) => {
        const r = await fetch(`http://127.0.0.1:8080/v1/projects/demo-mnf/databases/(default)/documents${p}`, {
          method: m as string,
          headers: { 'content-type': 'application/json' },
          ...(b ? { body: JSON.stringify(b) } : {}),
        });
        return r.status;
      },
      [method, path, body] as const,
    );
  check((await probe('GET', '/players/marco-rinaldi')) === 200, 'anonymous GET of a player → allowed');
  check((await probe('POST', '/players?documentId=hacker', { fields: { displayName: { stringValue: 'x' } } })) === 403, 'anonymous create → 403');
  check((await probe('PATCH', '/players/marco-rinaldi?updateMask.fieldPaths=displayName', { fields: { displayName: { stringValue: 'pwned' } } })) === 403, 'anonymous update → 403');
  check((await probe('DELETE', '/matches/2026-11-02')) === 403, 'anonymous delete → 403');
  check((await probe('PATCH', '/settings/site?updateMask.fieldPaths=dataRevision', { fields: { dataRevision: { integerValue: '1' } } })) === 403, 'anonymous settings change → 403');
  check((await probe('GET', '/auditLog')) === 403, 'audit log is not readable → 403');
  check((await probe('GET', '/matches/2026-11-09')) === 404 || (await probe('GET', '/matches/2026-11-09')) === 403, 'a reverted/unpublished match is not readable');

  /* --------------------------------------------------------------- 13 */
  probing = false;
  step('Mobile layout (iPhone-sized viewport)');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mobile.newPage();
  m.on('pageerror', (e) => errors.push(`mobile pageerror: ${e.message}`));
  for (const [path, sel, shot] of [
    ['/', '.board--hero', 'home'],
    ['/matches/2026-11-02', '.board', 'match'],
    ['/leaderboards', '.table', 'leaderboards'],
    ['/players/marco-rinaldi', '.phero', 'player'],
    ['/news', '.acard', 'news'],
    ['/matches', '.mrow', 'results'],
  ] as const) {
    await m.goto(`${SITE}${path}`);
    await ready(m, sel);
    await noHorizontalScroll(m, path);
    await settle(m);
    await m.screenshot({ path: `${SHOTS}/${shot}-mobile.png`, fullPage: false });
  }
  await m.goto(SITE);
  await ready(m, '.board--hero');
  check(await m.locator('.tabbar').isVisible(), 'mobile shows the bottom tab bar');
  check(!(await m.locator('.nav').isVisible()), 'desktop nav is hidden on mobile');
  await settle(m);
  await m.screenshot({ path: `${SHOTS}/home-mobile-full.png`, fullPage: true });
  await m.goto(`${SITE}/matches/2026-11-02`);
  await ready(m, '.tabs');
  await m.getByRole('tab', { name: 'Line-ups' }).click();
  check(await m.locator('.lineup').first().isVisible(), 'mobile match tabs switch to line-ups');
  await settle(m);
  await m.screenshot({ path: `${SHOTS}/match-lineups-mobile.png` });

  /* --------------------------------------------------------------- 14 */
  step('Demo purge removes only the fictional data and the banner');
  const purge = mnf(['demo', 'purge', '--apply'], { today: '2026-11-11' });
  check(purge.code === 0 && purge.out.includes('Removed 12 players, 10 matches'), 'demo purge --apply', purge.out);
  await page.goto(SITE);
  await ready(page, 'text=Kick-off soon');
  check(!(await text(page)).includes('fictional test data'), 'the DEMO banner is gone and the site is empty again');

  check(errors.length === 0, 'no JavaScript errors in any page', errors.join('\n      '));
  await browser.close();

  console.log(`\n${failures.length === 0 ? '✔ ALL' : '✖ FAILED'} — ${checks - failures.length}/${checks} end-to-end checks passed`);
  if (failures.length) {
    console.log('Failures:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
