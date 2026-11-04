---
name: weekly-roundup
description: Generate and publish the weekly roundup article — the week's result(s), top performers, scoring-chart movement, winning streaks and next Monday's fixture. Use for "do the weekly roundup", "write up the week", or as a follow-up after publishing a result.
---

# Weekly roundup

1. Make sure the week's result is published (`npm run mnf -- match list --limit 3`).
2. `npm run mnf -- facts roundup` (latest week) or `facts roundup --week 2026-11-02` (any date inside the Monday–Sunday week).
   The JSON gives: matches with scorers/POTM, top performers, season leaderboards (goals, assists, wins, streaks),
   active win streaks, the next fixture, and ready-made `statements`.
3. Write the article in the house voice: lead with the result, then the individual stories, then the chart ("who moved"),
   then a look-ahead to the fixture **only if one is set**. Every number from the fact sheet; colour is yours.
   Don't mention a week with no recorded match as if one happened — if `matches` is empty, say there was no game recorded.
4. Publish: category `roundup`, slug like `roundup-2026-11-02`, `players` = those featured:
   `npm run mnf -- article publish --stdin` (dry run) → `--apply`.
5. Reply with the link and a one-line teaser.
