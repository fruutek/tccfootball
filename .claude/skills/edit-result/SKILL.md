---
name: edit-result
description: Correct a previously published match — wrong score, wrong scorer, forgot an assist, changed player of the match, different team name or line-up, wrong date — and recalculate all affected statistics. Use when the owner says "actually", "that was wrong", "Peter didn't score, it was James", "change last week's man of the match".
---

# Edit a historical result

> **Running commands:** where this skill says `npm run mnf -- X`, in a session without database credentials run the **Publish workflow** with `command: X` (see `CLAUDE.md` → "Reaching the database"): dry run first, then the identical inputs with `apply: "true"`.

Read `CLAUDE.md`. Edits recalculate everything automatically because statistics are derived from matches.

1. **Find it.** `npm run mnf -- match list --limit 20` → get the match `id` (the id keeps its original date even if the date is later corrected).
2. **Fetch the stored spec.** `npm run mnf -- match show <id> --spec` → this is the match as JSON with names.
3. **Change only what the owner said.** Leave everything else exactly as stored. If their correction is ambiguous, ask.
   Corrected totals must still add up: if you move a goal, the score must still match the events.
4. **Dry run.** `npm run mnf -- match edit <id> --stdin <<'JSON' … JSON`. Read:
   - `Changes:` — confirm it lists only what the owner asked for.
   - `Player statistics that change` — this is the recalculation preview; mention the notable ones in your reply.
   - `REPORT_STALE` → the match report still describes the old result. Rewrite it from `facts match <id>` / the dry-run fact sheet
     and include it as `"report"` in the spec (it updates the existing article in place; the slug cannot change).
5. **Apply** with `--apply`. The previous version is stored in the audit log, so it can be reverted (`undo-change`).
6. **Check.** `npm run mnf -- stats audit` must end with `AUDIT PASSED`.
7. **Reply:** what changed, which players' numbers moved (before→after), whether the report was updated, the undo id.

If the "correction" actually describes a *different* game, it is a new match → use `publish-result` instead.
Don't use `match delete` to "fix" a match; delete only if the owner says the game never happened.
