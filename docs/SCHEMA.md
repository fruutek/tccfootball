# Firestore schema

The single definition lives in [`src/shared/schema.ts`](../src/shared/schema.ts) (zod). The publishing CLI validates
**every** document against it before writing; the website only imports its *types*.

## Design rules

1. **Matches are the source of truth.** No collection stores goals, assists, appearances, wins, win %, streaks or
   rankings. The single, deliberate exception is a player's optional **`startingTotals`** (below): numbers the owner stated from *before* match records began. They are derived on demand by [`src/shared/stats.ts`](../src/shared/stats.ts), used identically by the site and
   the CLI. There is nothing to fall out of sync, and editing a historical match re-derives everything.
2. **Teams belong to a match, not to the group.** Each match carries its own two named rosters.
3. **Stable ids.** Every id is created once and never changes (renaming a player or correcting a match date does not move it).
4. **Plain JSON types only** (strings, numbers, arrays, maps, `null`). Dates are `"YYYY-MM-DD"` strings and timestamps are
   ISO-8601 strings — they sort lexicographically, never shift time zone and survive the browser's JSON cache.
5. **Soft states over deletion.** `status` is `published` or `unpublished`; the public can only ever read `published`.

## Collections

| Collection | Document id | Public read | Written by |
|---|---|---|---|
| `players` | slug of the display name, e.g. `marco-rinaldi` (`-2`… on collision) | yes | CLI only |
| `matches` | the date, `2026-11-02` (`2026-11-02-2` for a second game that day) | **published only** | CLI only |
| `articles` | the slug, = the URL `/news/<slug>` | **published only** | CLI only |
| `settings` | `site` (one document) | yes (`get` only) | CLI only |
| `auditLog` | auto id | **never** | CLI only |

No composite indexes are needed (`firestore.indexes.json` is empty): the site's only queries are `where status == 'published'`.

### `players/{playerId}`

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `1` | |
| `id` | string | = document id. Never changes. |
| `displayName` | string ≤ 40 | Unique (case/accent-insensitive). |
| `nickname` | string? | Shown on profiles; also matched in messages. |
| `aliases` | string[] ≤ 10 | Extra spellings used **only** to match names in instructions. |
| `photo` | `/photos/<id>.<hash>.webp`? | Static asset deployed by Hosting. Optional — a deterministic initials avatar is used otherwise. |
| `bio` | string ≤ 600? | |
| `startingTotals` | `{ appearances?, goals?, assists? }`? | **Preseason**: totals from *before match records began* (e.g. "4 games, 3 goals"). Count in **all-time** appearances, goals and assists only, and are labelled as such on the profile. They create **no results**: wins, draws, losses, win % and streaks use recorded matches only. Per-game averages use preseason goals and games as a pair. Not in season/month views. Set only for numbers the owner actually stated. **If the matches behind them are later recorded, clear them** (`player update <name> --clear-starting-totals`) or they would be counted twice. |
| `status` | `active` \| `archived` | Archived players keep their history. |
| `fictional` | `true`? | Marks demo data (removed by `demo purge`). |
| `revision`, `createdAt`, `updatedAt` | | Optimistic-concurrency counter + ISO timestamps. |

**Not stored (derived):** first appearance, appearances, goals, assists, wins, draws, losses, win %, goals per game, form, streaks,
match history, player-of-the-match awards.

### `matches/{matchId}`

```jsonc
{
  "schemaVersion": 1,
  "id": "2026-11-02",
  "status": "published",              // or "unpublished"
  "date": "2026-11-02",               // the Monday it was played
  "kickoff": "19:30",                 // optional
  "venue": "Astro 3",                 // optional
  "teams": {
    "a": { "name": "Red Team",  "colour": "red",  "playerIds": ["peter","adam","james","chris","arun"] },
    "b": { "name": "Blue Team", "colour": "blue", "playerIds": ["alex","brownie","avalon","josh","tom"] }
  },
  "score": { "a": 3, "b": 0 },        // the declared final score
  "events": [
    { "type": "goal",   "team": "a", "playerId": "peter", "assistId": "adam", "minute": 12 },
    { "type": "goal",   "team": "a", "playerId": "peter" },
    { "type": "goal",   "team": "a", "playerId": null },                        // scorer explicitly unknown
    { "type": "own_goal","team": "a", "playerId": "tom" },                      // counts FOR team a; Tom plays for b
    { "type": "assist", "team": "a", "playerId": "adam" }                       // assist not tied to a specific goal
  ],
  "playerOfTheMatch": "peter",        // or null
  "playerIds": ["adam","alex", …],    // DERIVED, sorted index of everyone who played
  "fingerprint": "9f2c…",             // sha-256 of the match content (duplicate guard)
  "fictional": true,                  // demo data only
  "revision": 1, "createdAt": "…", "updatedAt": "…"
}
```

**Team names and colours are per fixture** — `Red Team`, `Bibs`, `Whites`… A colour is a name
(`red blue green yellow orange purple pink teal white black grey`) or `#rrggbb`.

**Event semantics**

* `goal.team` is the team the goal counts for; `playerId` (a member of that team) or `null` for an *explicitly unknown* scorer.
* `own_goal.team` is the team the goal counts **for**; `playerId` is on the *other* team. An own goal is **not** a goal for its
  scorer and cannot carry an assist. It is tracked separately (`ownGoals`).
* `assist` events record an assist whose goal is unknown ("Adam assisted one"). A `goal.assistId` links an assist to a specific goal.
* `minute` is optional on goals. If every goal has one the match page draws a timeline; otherwise order is never implied.

**Invariants enforced on every write** ([`src/shared/validate.ts`](../src/shared/validate.ts)):

| Rule | Code |
|---|---|
| For each team: named goals + unknown-scorer goals + opposition own goals **=** the declared score | `GOALS_UNACCOUNTED` / `GOALS_EXCEED_SCORE` |
| Scorers belong to the team credited; own-goal scorers to the *other* team | `SCORER_NOT_IN_TEAM`, `OWN_GOAL_WRONG_TEAM` |
| Assists ≤ non-own goals per team; no self-assists; assister on the scoring team | `ASSISTS_EXCEED_GOALS`, `ASSIST_SELF`, `ASSIST_NOT_IN_TEAM` |
| A player appears once, on one team; both teams non-empty and differently named | `PLAYER_ON_BOTH_TEAMS`, `TEAM_EMPTY`, `TEAM_NAME_DUPLICATE` |
| Player of the match played in the match | `POTM_NOT_PARTICIPANT` |
| Real date, not in the future (non-Monday → warning) | `DATE_INVALID`, `DATE_FUTURE` |
| No same-date match; no identical result under any date/labelling | `MATCH_EXISTS`, `DUPLICATE_RESULT` |

Unknown scorers are *allowed but explicit* and always raise a warning — they count towards the score but credit nobody.

**Duplicate fingerprint.** Computed from date + both line-ups + score + scorers/assists, canonicalised so that swapping which team
is "a", changing team names/colours, adding minutes, or reordering events does **not** change it. Changing *what happened*
does. The same-date guard is the document id itself (`create` fails if it exists), so two simultaneous publishes cannot both win.

### `articles/{slug}`

| Field | Type | Notes |
|---|---|---|
| `id` = `slug` | string | Document id and URL. |
| `status` | `published` \| `unpublished` | |
| `title` ≤ 140, `standfirst` ≤ 320, `body` ≤ 20 000 | string | Body is a Markdown subset (rendered without ever emitting raw HTML). |
| `category` | `match-report` \| `spotlight` \| `roundup` \| `humour` \| `records` | |
| `author` | string | Defaults to `settings.byline`. |
| `publishedAt` | ISO datetime | |
| `featuredImage` | `{ src: "/images/…", alt, credit? }`? | Optional static asset. Without one, match reports get a scoreline cover. |
| `matchId` | string? | A match report points at its match; the match does **not** point back (one direction only). |
| `playerIds` | string[]? | "In this story" links. |

### `settings/site`

| Field | Default | Meaning |
|---|---|---|
| `siteName`, `shortName`, `tagline`, `byline` | | Branding / default author. |
| `seasonStartMonth` | `1` | `1` = each calendar year is a season. `8` = seasons run Aug→Jul (`2026-27`). Seasons are **derived** from match dates, so changing this re-buckets history with no migration. |
| `minAppearances` | `5` | Ceiling for the minimum-appearances rule on win-rate and goals-per-game boards. The effective minimum is `min(this, ⌈½ × matches in the period⌉)` so a four-game month still has a board. |
| `formLength` | `5` | Matches in a form strip. |
| `nextFixture` | `null` | `{ date, kickoff?, venue?, note? }`. Cleared automatically when a result for that date is published. |
| `demoData` | `false` | `true` while fictional documents exist (shows the DEMO banner). Audited. |
| `dataRevision` | | **Bumped on every write.** Browsers compare it with their cache: unchanged → one Firestore read per page view; changed → refetch. This is a cache marker, not data. |

### `auditLog/{autoId}` (private)

One entry per document written: `{ opId, at, actor, command, summary, collection, docId, action, before, after, instruction?, revertedBy? }`.
`before`/`after` hold the complete document, so any operation can be reversed (`revert <opId>`); `instruction` keeps the owner's original message.

## Statistics definitions

Computed in [`src/shared/stats.ts`](../src/shared/stats.ts) from published matches only (optionally filtered to a season or month).

| Statistic | Definition |
|---|---|
| Appearances | Matches whose line-up includes the player (**+ preseason games** in the all-time "Apps" figure; win/draw/loss figures use recorded matches only) |
| Goals | `goal` events with the player as scorer (own goals and unknown scorers excluded), **plus `startingTotals.goals` in the all-time view** |
| Assists | `goal.assistId` links + `assist` events |
| Own goals | `own_goal` events by the player (tracked, not counted as goals) |
| W / D / L | Result of the team the player was on **in that match**, from the final score |
| Win % | wins ÷ appearances × 100 |
| Goals per game | (recorded goals + preseason goals) ÷ (recorded + preseason games) when preseason totals include games; otherwise recorded goals ÷ recorded games — a goals total without a games total can never inflate an average |
| Player of the match | matches where the player is `playerOfTheMatch` |
| Form | Last `formLength` results, most recent first |
| Current win streak | Consecutive wins ending at the player's latest appearance; a draw or loss resets it, missing a week does not |
| First appearance | Date of their earliest published match |

Leaderboards ([`leaderboards.ts`](../src/shared/leaderboards.ts)): goals, assists, appearances, wins, win %, goals/game, POTM, current streak.
Counting boards list only players with a non-zero value; ties share a rank (`3=`) and are ordered by documented tie-breakers.
