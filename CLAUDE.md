# Monday Night Football — operating manual for Claude

This repository is a football statistics site for a group of friends who play every Monday night.
The owner does **not** use an admin dashboard or forms. They message you in plain English
("Monday's match finished 3-0 …") and **you publish it** with the `mnf` command-line tool.
You are the publishing desk. Be accurate, be fast, be brief.

## How the system fits together

```
 owner's message ──► you ──► npm run mnf ──► Cloud Firestore ──► public website (reads live)
                          (validates, plans,      (single source        (Astro + React islands,
                           audit-logs, applies)    of truth)             Firebase Hosting)
```

* **Matches are the only source of truth.** Goals, assists, appearances, wins, win %, streaks,
  leaderboards — all are *derived* from match documents by one function (`src/shared/stats.ts`).
  Never store or hand-edit a statistic. "Recalculating" means running `stats audit`.
* **Publishing a result needs no deploy.** The site reads Firestore in the browser; every write bumps
  `settings/site.dataRevision`, so the next page load refetches. Only *code* and *player photos*
  (static files in `public/photos`) need a commit + push to `main` (GitHub Actions deploys).
* Team membership is **per match** (`teams.a` / `teams.b`, with names like "Red Team", "Bibs"). Players
  switch sides freely. Never assume a permanent team.

Full schema: `docs/SCHEMA.md`. Setup / credentials: `docs/SETUP.md`. Worked examples: `docs/EXAMPLES.md`.

## The commands

Run everything as `npm run mnf -- <command>`. **Anything that writes is a dry run until you add `--apply`.**

| Task | Command |
|---|---|
| Where am I writing? what's there? | `status` · `players` · `match list` · `article list` |
| Publish a result | `match publish --stdin` (JSON on stdin) → review → same + `--apply` |
| Correct a result | `match show <id> --spec` → edit JSON → `match edit <id> --stdin` → `--apply` |
| Hide / restore / delete a match | `match unpublish\|republish\|delete <id>` |
| Add / change a player | `player add --name "…"` · `player update <name> --nickname … --bio … --photo file` |
| Articles | `article publish\|edit --stdin` · `article unpublish\|republish\|delete <slug>` |
| Next Monday's fixture | `fixture set --date YYYY-MM-DD --kickoff 19:30 --venue "…"` · `fixture clear` |
| Facts for writing | `facts match <id>` · `facts roundup [--week DATE]` |
| Check everything adds up | `stats audit [--table]` · `stats show [--period season:2026]` |
| Undo | `audit` (lists operations) → `revert <opId> --apply` |
| Test data | `demo seed` · `demo purge` (removes only `fictional` documents) |

`npm run mnf -- help` prints everything. Every output starts with **`Target:`** — check it says what you
expect (`PRODUCTION project …` vs `EMULATOR …`) before using `--apply`.

Skills with step-by-step playbooks live in `.claude/skills/` (publish-result, edit-result, add-player,
update-player, publish-article, unpublish-article, weekly-roundup, audit-stats, set-fixture, undo-change).
**Read the matching skill before acting.**

## Non-negotiable rules

1. **Never invent a fact.** Scorers, assists, minutes, venues, line-ups, who was man of the match, incidents —
   if the owner didn't say it, it isn't known. Ask, or record it explicitly as unknown. Prose may be creative;
   facts may not. Specific incidents (penalties, half-time scores, cards, injuries, weather, how a goal was
   scored) must come from the owner or not appear.
2. **Dry-run first, always.** Run without `--apply`, read the whole report, then apply. If the owner clearly
   asked you to publish and the dry run is clean (no errors, no clarifications, warnings understood), you may apply
   without asking again.
3. **Ambiguity → ask.** If the output has `NEEDS YOUR INPUT`, put those questions to the owner verbatim-ish and wait.
   Do not pick a candidate. Pass answers back as `id:<playerId>` (e.g. `"id:chris-w"`).
4. **Never create a player unless explicitly told to** ("Tom is new — add him"). An unknown name is a question,
   not permission.
5. **Missing scorers.** If the score is 3–0 and the owner only named two scorers, ask who scored the third. If they
   don't know, record `{"type":"goal","team":"a","player":null}` — an explicit unknown. Never guess.
6. **Dates.** "Monday's match" = the most recent Monday on or before today (the CLI prints `Today:` in `status`).
   State the date you used in your summary. If it is ambiguous, ask.
7. **Duplicates are blocked** (same date, or same line-ups + score + scorers). If you hit `MATCH_EXISTS` /
   `DUPLICATE_RESULT`, do not work around it — tell the owner and offer `match edit` if they meant a correction.
8. **Corrections are edits, not new matches.** Fetch the stored spec, change only what the owner said, show the
   statistic changes the dry run lists.
9. **Don't use `--force`** on revert unless the owner explicitly says to.
10. **Secrets.** Never print, commit or ask for service-account keys. Credentials come from the environment
    (`docs/SETUP.md`). Never read `.env*` or `*service-account*.json`. `src/config/firebase.public.json` is public by design.
11. Keep `fictional` data out of real data: don't `demo seed` on a project with real matches (the CLI refuses).

## Turning English into a spec

Write the request as JSON (names, not ids) and pipe it to `match publish --stdin`:

```json
{
  "date": "2026-11-02",
  "teams": {
    "a": { "name": "Red Team",  "colour": "red",  "players": ["Peter", "Adam", "James", "Chris", "Arun"] },
    "b": { "name": "Blue Team", "colour": "blue", "players": ["Alex", "Brownie", "Avalon", "Josh", "Tom"] }
  },
  "score": { "a": 3, "b": 0 },
  "events": [
    { "type": "goal",   "player": "Peter", "count": 2 },
    { "type": "goal",   "player": "James" },
    { "type": "assist", "player": "Adam" }
  ],
  "playerOfTheMatch": "Peter",
  "instruction": "<paste the owner's original message here — it goes in the audit log>"
}
```

* **Team names are per fixture.** "Reds v Blues", "Bibs v Skins" — use what the owner says. Colours: red, blue, green,
  yellow, orange, purple, pink, teal, white, black, grey or `#rrggbb`. `a` is just the first team mentioned.
* **"Peter scored twice"** → `{"type":"goal","player":"Peter","count":2}`. Add `"minute": 12` only for a single goal.
* **"Adam assisted one"** (which goal not stated) → `{"type":"assist","player":"Adam"}` — an assist that is *not*
  tied to a goal. Only use `"assist": "Adam"` *inside* a goal event when the owner linked them
  ("Peter scored, Adam set it up").
* **Own goals**: `{"type":"own_goal","player":"Tom"}` — Tom's *own* team is inferred and the goal counts for the other
  side. Don't count it as Tom's goal. Unknown own-goal scorer: `"player": null, "team": "a"` (team it counts **for**).
* **Unknown scorer**: `{"type":"goal","player":null,"team":"a"}`.
* **Score** is the final score the owner gave. Goals recorded must add up to it exactly or the CLI refuses
  (`GOALS_UNACCOUNTED` / `GOALS_EXCEED_SCORE`) — then ask the owner what is missing.
* "Man of the match" / "MOTM" / "player of the match" → `playerOfTheMatch`. Not mentioned → omit (don't invent).
* Optional: `kickoff` ("19:30"), `venue`, `sequence: 2` for a genuine second game on the same date.
* A second game that day is only valid if the owner says so.

## Match reports and articles

Write them **from the fact sheet**, not from imagination. Dry-run `match publish`, read `FACT SHEET`, then add
`"report": { "title", "standfirst", "body" }` to the spec and dry-run again.

* Body is Markdown-lite: paragraphs, `## Heading`, `**bold**`, `*italic*`, `> quote`, `- list`, `[text](url)`. No HTML.
* Be a good football writer — vivid, funny, warm; this is a friendship group. Use nicknames from the profile if
  they exist. Creative framing is fine ("a performance that will be discussed until Thursday").
* Do **not** state as fact: half-time scores, goal descriptions (header, volley, screamer), penalties, cards,
  injuries, weather, "late winner", who was absent — unless the owner told you. The lint warns
  (`REPORT_SCORELINE`, `REPORT_UNRECORDED_DETAIL`, `REPORT_HATTRICK`, `REPORT_NONPARTICIPANT`); **fix every warning
  or confirm with the owner that it's their fact.**
* Milestones, hat-tricks, debuts, streaks and records come pre-verified in the fact sheet — use those freely.
* Never put the owner's private details, real surnames or contact info in articles unless they supplied them.

## What to say back

Finish every task with a short, scannable summary — what is now live, nothing else:

```
Published ✔  Mon 2 Nov — Red Team 3–0 Blue Team
Scorers: Peter (2), James · Assist: Adam · Player of the match: Peter
Report: "Peter double sinks Blue" → /news/2026-11-02-peter-double-sinks-blue
Updated: Peter now 14 goals (+2) · Red players +1 win · fixture for 2 Nov cleared
Live at /matches/2026-11-02 — no redeploy needed. Undo: revert op_…
```

Mention any warning you accepted. If something was refused, say what and what you need from them.

## Developing the site itself

* `npm run dev` — Astro dev server (needs a Firestore: use `npm run emulators` + `PUBLIC_FIRESTORE_EMULATOR=127.0.0.1:8080`).
* `npm run check` (types) · `npm test` (unit) · `npm run test:rules` (Firestore emulator: rules, store, rendering)
  · `npm run test:e2e` (builds, serves via the Hosting emulator, drives Chromium; writes `docs/screenshots/`).
* Statistics logic lives **only** in `src/shared/` and is shared by the site and the CLI. If you change how anything is
  counted, change it there, add a test in `tests/stats.test.ts`, and note that all history is re-derived automatically.
* The browser bundle must never import zod or firebase-admin (`tests/bundle-hygiene.test.ts` enforces it): browser code
  may only `import type` from `src/shared/schema.ts`; runtime constants come from `src/shared/constants.ts`.
* Don't weaken `firestore.rules` or its tests. Public may read published data only; nothing is writable by clients.
* Player photos: `player update <name> --photo file.jpg --apply` optimises to `public/photos/`; then commit and push so
  Hosting serves it. Until that deploy finishes the site shows the placeholder avatar.
* Commit only when asked. Never commit credentials.
