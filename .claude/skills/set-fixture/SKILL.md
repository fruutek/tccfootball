---
name: set-fixture
description: Set, change or clear next Monday's scheduled fixture shown on the homepage. Use for "next game is 9th at 7:30 at the usual pitch", "cancel next week", "no game on bank holiday Monday".
---

# Next fixture

> **Running commands:** where this skill says `npm run mnf -- X`, in a session without database credentials run the **Publish workflow** with `command: X` (see `CLAUDE.md` → "Reaching the database"): dry run first, then the identical inputs with `apply: "true"`.

- Set: `npm run mnf -- fixture set --date 2026-11-09 --kickoff 19:30 --venue "Astro 3" --note "Bring bibs"` (dry run, then `--apply`).
  Only include venue/note the owner actually gave. A past date or a date that already has a result is refused.
- Clear: `npm run mnf -- fixture clear --apply`.
- It is **cleared automatically** when a result for that date (or later) is published.
- Teams are never part of a fixture — they're picked on the night and appear with the result.
