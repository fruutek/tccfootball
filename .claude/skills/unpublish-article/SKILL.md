---
name: unpublish-article
description: Take an article or a match offline, bring it back, or delete it permanently. Use for "take that article down", "unpublish last week's report", "hide the Tuesday game, it was a friendly", "delete the joke piece".
---

# Unpublish, republish or delete

Prefer **unpublish** (reversible, keeps the content) over **delete**. All of these are reversible via `revert` while the audit log has them.

**Articles**
- `npm run mnf -- article list` → find the slug.
- `article unpublish <slug>` / `article republish <slug>` / `article delete <slug>` (dry run first, then `--apply`).

**Matches** (this changes everyone's statistics — the dry run lists exactly how)
- `match unpublish <id>` hides the match and **its match report together**; it disappears from every stat and leaderboard.
- `match republish <id>` brings back the match and the report that went down with it. A report that was unpublished
  separately stays unpublished (you'll be told).
- `match delete <id>` removes the match and its report. Only when the owner says the game never happened.

Always show the owner the `Player statistics that change` lines before applying a match change, and give them the undo id afterwards.
