---
name: publish-result
description: Publish a Monday night match result (and optionally its match report) from the owner's plain-English message, e.g. "Monday's match finished 3-0. Red Team had Peter, Adam… Peter scored twice… Peter was man of the match. Publish it and write a report." Use whenever the owner reports a score, scorers, or line-ups for a game that has not been published yet.
---

# Publish a result

Read `CLAUDE.md` first (rules + spec format). Then:

1. **Orient.** `npm run mnf -- status` (check `Target:` and `Today:`), then `npm run mnf -- players` to see the roster
   (ids, names, nicknames). Work out the match **date** from "Monday"/"last night"/an explicit date and say which you used.
2. **Extract the facts** from the message into the spec JSON (`CLAUDE.md` → "Turning English into a spec"):
   teams (names, colours, players), final score, scorers, assists, own goals, player of the match, optional
   minutes/venue/kick-off. Put the owner's message in `"instruction"`.
   Anything not stated stays absent — do not fill gaps.
3. **Dry run.** `npm run mnf -- match publish --stdin <<'JSON' … JSON` (no `--apply`).
4. **Read the whole report.**
   - `NEEDS YOUR INPUT` (ambiguous/unknown names) → ask the owner, quoting the question. Wait. Pass the answer back
     as `"id:<playerId>"`. If they want a **new** player created, only then run the `add-player` skill.
   - `ERRORS` → almost always missing facts (`GOALS_UNACCOUNTED`: ask who scored; if unknown use `"player": null`),
     or a duplicate (`MATCH_EXISTS` / `DUPLICATE_RESULT` → tell the owner; offer `edit-result`).
   - `Warnings` → read each. `TEAM_SIZE_UNEQUAL`, `DATE_NOT_MONDAY`: confirm with the owner if you weren't told. `NO_REPORT`: fine.
5. **Write the report** if asked (or if the owner's standing preference is to always have one). Use only the
   `FACT SHEET`. Add `"report": {"title","standfirst","body"}` to the spec and dry-run **again**: every `REPORT_*` warning
   must be fixed (or confirmed as the owner's own fact).
6. **Apply.** Re-run the identical command with `--apply`.
7. **Verify (cheap).** `npm run mnf -- match show <id>` or `npm run mnf -- stats show --board goals`.
8. **Reply** with the short summary format from `CLAUDE.md`: what's live, key stat movement, the report link, the undo id.

Never apply while anything is unresolved. Never retry a refused duplicate with tweaks to get past the guard.
