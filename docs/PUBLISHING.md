# Publishing guide

How results, players and articles get onto the site. Day to day you never run these yourself — you message Claude Code and it follows
[`CLAUDE.md`](../CLAUDE.md) and the playbooks in [`.claude/skills/`](../.claude/skills). This page is the reference for what is happening underneath.

## How a request reaches the database

A Claude session has **no database credentials** by design. Instead it starts the **`Publish` GitHub workflow** (Actions → Publish), which runs one `mnf`
command as the restricted `mnf-publisher` account — keyless, usable only by that workflow on `main`. Typical timings: about a minute per run.

1. Dry run — `command: "match publish"`, `request: { …JSON… }`, `apply: false` → Claude reads the log (names resolved, stat changes, fact sheet, warnings).
2. Apply — the identical inputs with `apply: true` → the log ends `MNF_RESULT exit=0 mode=apply` and gives the undo id.

`exit=2` means the CLI needs an answer or refused (ambiguous name, missing scorer, duplicate…) — Claude asks you. The workflow rejects anything that is not an allow-listed
`mnf` command, never uses a shell, and refuses `--apply/--file/--project` inside the command text (`scripts/run-mnf.ts`, tested).

> **This repository is public, so workflow logs are public.** Only publish what is meant for the website. Claude keeps the audit-log note to a neutral one-liner
> instead of your verbatim chat.

## The model

```
 request (JSON, names)  ──►  resolve names  ──►  validate  ──►  plan  ──►  [--apply]  ──►  one atomic transaction
                              ambiguous? ASK     inconsistent?   preview of     │             writes + audit entries
                              unknown?  ASK      REFUSE          stat changes   │             + dataRevision bump
                                                 duplicate? REFUSE              └── nothing happens without --apply
```

* **Dry run by default.** Every command that writes shows `DRY RUN` until `--apply`.
* **Names, not ids** in requests ("Peter", "Brownie"). Resolution order: full display name → nickname → alias → unique first name → id.
  More than one match, or none, is *never* guessed — it becomes a question. An id is passed back as `id:<playerId>`.
* **Validation** refuses: scores that don't equal the recorded goals (own goals and explicit unknown scorers included), scorers on the wrong team,
  too many assists, a player on both teams, a player of the match who didn't play, future dates, duplicate results.
* **Atomic and conflict-safe.** All documents of an operation are written in one transaction; creates never overwrite; updates/deletes abort if the
  document changed since the plan was made.
* **Reversible.** `revert <opId>` restores the previous state of everything in an operation.

## Command reference

`npm run mnf -- help` is authoritative. Summary:

```text
READ     status · players · player show <name> · match list · match show <id> [--spec] · article list|show
         stats show [--period all|season:2026|month:2026-11] [--board goals] · stats audit [--table]
         facts match <id> · facts roundup [--week DATE] · audit [--limit N]
WRITE    match publish|edit <id> (--stdin | --file F)      match unpublish|republish|delete <id>
         player add --name … [--nickname --alias --bio]     player update <name> [--display-name --nickname --add-alias --bio --photo --archive …]
         article publish|edit (--stdin | --file F)          article unpublish|republish|delete <slug>
         fixture set --date … [--kickoff --venue --note]    fixture clear       settings set key=value
         revert <opId> [--force]                            demo seed | demo purge
FLAGS    --apply  --json  --project ID  --instruction "…"
```

Exit codes: `0` ok · `2` needs input / refused · `64` usage error · `77` can't authenticate · `78` setup problem.

## Request format (match)

See `CLAUDE.md` → "Turning English into a spec" for the full mapping, and [`docs/EXAMPLES.md`](EXAMPLES.md) for real runs. Event types:

| Event | Meaning |
|---|---|
| `{"type":"goal","player":"Peter","count":2}` | Peter scored twice (team inferred) |
| `{"type":"goal","player":"Peter","assist":"Adam","minute":12}` | a specific goal with a linked assist and minute |
| `{"type":"assist","player":"Adam"}` | an assist whose goal isn't known |
| `{"type":"own_goal","player":"Tom"}` | Tom's own goal; counts for the other team, **not** a Tom goal |
| `{"type":"goal","player":null,"team":"a"}` | a goal for team a with an explicitly unknown scorer |

Optional match fields: `kickoff`, `venue`, `sequence` (second game that day), `playerOfTheMatch`, `report`, `instruction`.

**Preseason result** (score + scorers, no line-ups, counts towards no statistic):
`{"date":"2026-10-12","preseason":true,"teams":{"a":{"name":"Team 1"},"b":{"name":"Team 2"}},"score":{"a":4,"b":1},"events":[{"type":"goal","player":"Katie","team":"a"},{"type":"goal","player":null,"team":"a"},{"type":"goal","player":"Andrew","team":"b"}]}`
— every goal needs its `team`; no `players`, `playerOfTheMatch` or `report`.

## What triggers a deploy

| Change | Needs a deploy? |
|---|---|
| Results, players, nicknames, bios, articles, fixtures, settings | **No** — live on the next page load |
| Player photos / article images (static files in `public/`) | Yes — commit + push to `main`; the placeholder avatar shows until then |
| Site code / design | Yes — push to `main` |
| Firestore rules | `npm run deploy:rules` (deliberately not automated) |
