---
name: undo-change
description: Reverse an earlier publish, edit, unpublish, deletion or other change made through the mnf tool. Use for "undo that", "that was a mistake, put it back", "revert the last thing".
---

# Undo

Every write records the full before/after of each document under an **operation id** (printed after `--apply`, e.g. `op_20261104…`).

1. Find it: `npm run mnf -- audit --limit 15`. Match on the time/summary the owner means (or use the id you gave them).
2. Dry run: `npm run mnf -- revert <opId>`. It inverts every document in that operation (publish → removed, edit → previous version restored,
   delete → recreated, fixture/setting → previous value).
3. It **refuses** if a later change touched the same document (`CHANGED_SINCE`) — revert the later operation first. Do not use `--force`
   unless the owner explicitly accepts overwriting later changes.
4. `--apply`, then confirm with `match list` / `stats audit`. Reverting is itself recorded, so it can't be silently lost.
5. Reply with what was restored.
