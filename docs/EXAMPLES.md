# Example publishing workflows

These show what happens when the owner messages Claude Code in plain English. The terminal output is **real**, captured from the
CLI against the local emulator (trimmed). The roster is the one from the brief; "Chris" is deliberately ambiguous in the first example.

> Nothing is written until `--apply`. Claude always dry-runs first, and only applies when the report is clean.

---

## 1. "Publish the result and write a match report"

> **Owner:** Monday's match finished 3-0. Red Team had Peter, Adam, James, Chris and Arun. Blue Team had Alex, Brownie, Avalon, Josh and
> Tom. Peter scored twice and James scored once. Adam assisted one. Peter was man of the match. Publish the result and write a match report.

Claude (skill `publish-result`) checks `status` (target, today = Wed 4 Nov → "Monday" = **2 Nov**) and `players`, builds this request and dry-runs it:

```json
{ "date": "2026-11-02",
  "teams": { "a": { "name": "Red Team", "colour": "red", "players": ["Peter","Adam","James","Chris","Arun"] },
             "b": { "name": "Blue Team", "colour": "blue", "players": ["Alex","Brownie","Avalon","Josh","Tom"] } },
  "score": { "a": 3, "b": 0 },
  "events": [ {"type":"goal","player":"Peter","count":2}, {"type":"goal","player":"James"}, {"type":"assist","player":"Adam"} ],
  "playerOfTheMatch": "Peter",
  "instruction": "Monday's match finished 3-0 …" }
```

### 1a. The roster has two Chrises → Claude must ask

```text
NEEDS YOUR INPUT — nothing has been written:
  ? "Chris" (Red Team line-up) could be Chris B (use "id:chris") or Chris W (use "id:chris-w"). Which one?
Ask the user the question(s) above, then re-run with the answer.
```

**Claude:** "Which Chris was that — Chris B or Chris W?" · **Owner:** "Chris B." → Claude uses `"id:chris"`.

### 1b. If the owner had only named two scorers

```text
ERRORS — nothing has been written:
  ✖ [GOALS_UNACCOUNTED] Red Team: the score is 3 but only 2 goal(s) are accounted for (1 missing). Ask who scored the rest.
    If it is genuinely unknown, record each as an explicit unknown-scorer goal ({"type":"goal","team":"a","player":null}).
```

**Claude:** "That's 3–0 but I only have two scorers — who got the third?" If the answer is "no idea", the goal is recorded as an explicit
*unknown scorer*: it counts for the score and the result, but credits nobody. It is never guessed.

### 1c. Clean dry run → fact sheet → report → apply

```text
Command: match publish  —  DRY RUN (nothing written; add --apply to write)
Summary: Publish Red Team 3–0 Blue Team (2026-11-02)
Player statistics that change (all-time):
  • Adam: appearances 0→1, assists 0→1, wins 0→1
  • James: appearances 0→1, goals 0→1, wins 0→1
  • Peter: appearances 0→1, goals 0→2, wins 0→1, potm 0→1
  • Tom: appearances 0→1, losses 0→1          … (10 players)
FACT SHEET — write the report using ONLY these facts (plus anything the user told you):
  • Monday 2 November 2026: Red Team 3–0 Blue Team, a 3-goal win for Red Team.
  • Peter scored 2 goals.   • James scored 1 goal.   • Adam provided an assist.   • Peter was named player of the match.
  Not recorded (do not state as fact):
    – The venue was not recorded.   – Goal times were not recorded.   – Minute-by-minute action, cards, injuries and weather …
```

Claude writes a report **from those facts only**, adds it to the request as `"report"`, dry-runs again (the linter checks the prose), then applies:

```text
Command: match publish  —  APPLIED
Written (2, atomically):
  + matches/2026-11-02 — Published Red Team 3–0 Blue Team (2026-11-02)
  + articles/2026-11-02-peter-double-sinks-blue — Published match report "Peter double sinks Blue"
✔ Done. Site data revision 1793819204878. Browsers pick the change up on their next page load — no redeploy needed.
  Match page:   /matches/2026-11-02
  Report:       /news/2026-11-02-peter-double-sinks-blue
  Undo with:    npm run mnf -- revert op_20261104190645_3c910a --apply
```

**Claude → owner:**

> Published ✔ Mon 2 Nov — Red Team 3–0 Blue Team
> Scorers: Peter (2), James · Assist: Adam · Player of the match: Peter
> Report: "Peter double sinks Blue" → /news/2026-11-02-peter-double-sinks-blue
> Peter now on 2 goals, 1 win, 1 POTM. Live at /matches/2026-11-02 — no redeploy needed. Undo: `op_20261104190645_3c910a`.

### 1d. Sending it twice is harmless

```text
ERRORS — nothing has been written:
  ✖ [MATCH_EXISTS] A match already exists for 2026-11-02: Red Team 3–0 Blue Team (2026-11-02) [published]. Nothing was written.
    To correct it use "match edit 2026-11-02". If this is genuinely a second game that day, add "sequence": 2 to the request.
```

The same result re-sent with the sides swapped, different team names or on a *different* date is caught too (`DUPLICATE_RESULT`, or a `POSSIBLE_DUPLICATE` warning for a nearby date).

---

## 2. Correcting a historical result

> **Owner:** Actually, the second goal was James's, not Peter's.

Claude (skill `edit-result`) fetches the stored request with `match show 2026-11-02 --spec`, changes **only** that, and dry-runs `match edit`:

```text
Command: match edit  —  DRY RUN
Summary: Edit Red Team 3–0 Blue Team (2026-11-02) — goals / assists changed
Changes:
  • goals / assists changed
Player statistics that change (all-time):
  • James: goals 1→2
  • Peter: goals 2→1
Would write (2, atomically):
  ~ matches/2026-11-02 — Edited …: goals / assists changed
  ~ articles/2026-11-02-peter-double-sinks-blue — Updated match report
```

If the report text still describes the old scorers, the edit warns `REPORT_STALE` and Claude rewrites it from the new fact sheet in the same operation. Everything derived —
profiles, leaderboards, streaks — updates by itself because nothing was ever stored. `stats audit` confirms: `✔ AUDIT PASSED`.

---

## 3. Other things you can just say

| You say | Claude does (skill) |
|---|---|
| "Tom is new — add him." | `player add --name "Tom"` — only because you said so (`add-player`) |
| "Give Adam the nickname Ads and use this photo." | `player update Adam --nickname Ads --photo …`, then commit the optimised photo so Hosting serves it (`update-player`) |
| "Own goal by Tom, so it's 2–1 to Red." | `{"type":"own_goal","player":"Tom"}` — counts for Red, not as a Tom goal |
| "Don't know who scored the third." | explicit unknown-scorer goal — counts for the score, credits nobody |
| "We played two games — the second finished 1–0." | `"sequence": 2`, id `2026-11-02-2` |
| "Next Monday's at 7:30 at Astro 3." | `fixture set --date … --kickoff 19:30 --venue "Astro 3"` (`set-fixture`); cleared automatically when that result is published |
| "Write a spotlight on Danny." | `player show Danny` + `stats show` → article from real numbers (`publish-article`) |
| "Do the weekly roundup." | `facts roundup` → `roundup` article (`weekly-roundup`) |
| "Take down that joke article." | `article unpublish <slug>` (`unpublish-article`) |
| "Hide last week's game, it was a friendly." | `match unpublish <id>` — drops out of every stat, report goes with it, `republish` restores both |
| "Are the numbers right?" | `stats audit --table` → `✔ AUDIT PASSED` or a precise list of problems (`audit-stats`) |
| "Undo that." | `audit` → `revert <opId> --apply` (`undo-change`) |

---

## 4. The audit trail

```text
$ npm run mnf -- audit --limit 4
operation                 when (UTC)        document                                     action  summary
op_20261104190645_3c910a  2026-11-04 19:06  articles/2026-11-02-peter-double-sinks-blue  create  Published match report "Peter double sinks Blue"
op_20261104190645_3c910a  2026-11-04 19:06  matches/2026-11-02                           create  Published Red Team 3–0 Blue Team (2026-11-02)
op_20261104190638_26e64c  2026-11-04 19:06  players/chris-w                              create  Created player Chris W (chris-w)
op_20261104190636_a66f5a  2026-11-04 19:06  players/chris                                update  Updated Chris: name "Chris" → "Chris B" (id stays "chris")
```

Note the last line: renaming "Chris" to "Chris B" kept the id `chris` — so history and links didn't move. And that stale id can never win an
ambiguous name: typing plain "Chris" now asks which one.

---

## 5. The complete fictional example

`npm run mnf -- demo seed --apply` creates 12 invented players, 10 matches (draws, a hat-trick, an own goal, an unknown scorer, a debut,
changing teams every week, different team names each week), three match reports, four articles and a next fixture — all flagged `fictional`,
with a **DEMO** banner on every page. The latest match is the 3–0 shown in the README screenshots. `demo purge --apply` removes exactly that data.
