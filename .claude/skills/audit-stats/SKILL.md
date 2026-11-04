---
name: audit-stats
description: Recalculate and audit every player statistic and the integrity of all stored data. Use for "check the stats", "something looks off", "are the numbers right?", before a season ends, after any bulk change, or when the owner asks to recalculate.
---

# Recalculate and audit

> **Running commands:** where this skill says `npm run mnf -- X`, in a session without database credentials run the **Publish workflow** with `command: X` (see `CLAUDE.md` → "Reaching the database"): dry run first, then the identical inputs with `apply: "true"`.

Statistics are never stored — they are recomputed from the matches on every page view. So "recalculate" means
**verify that the matches are consistent and the totals add up**.

1. `npm run mnf -- stats audit --table`
   Checks: every match validates (score = named goals + unknown + own goals; assists ≤ goals; scorers on the right team);
   derived indexes and fingerprints match content; no duplicate results; every referenced player/match exists;
   articles point at real matches; the demo flag matches reality; and the cross-totals (Σ player goals = named goal events,
   Σ appearances = Σ line-up sizes, W+D+L = appearances for every player).
2. `PASSED` → report the totals and say so. `ℹ` notes are informational (e.g. unknown-scorer goals, ambiguous first names).
3. `FAILED` → list each problem. **Do not "fix" by editing Firestore directly.** Identify the match (`match show <id> --spec`),
   work out the correction **with the owner** (never guess), then use `edit-result`.
4. For a browser-visible spot check: `npm run mnf -- stats show --period season:2026` prints the same leaderboards the site shows.
5. If the owner edited data by hand in the Firebase console, the audit will catch bad fingerprints/indexes; fix via `match edit`
   (which recomputes them) — and every CLI write refreshes visitors' caches automatically.
