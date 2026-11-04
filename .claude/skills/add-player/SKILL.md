---
name: add-player
description: Create a new player profile when the owner explicitly says to ("Tom is new, add him", "create a profile for Josh"). Never create players implicitly — an unknown name in a result is a question, not permission.
---

# Add a player

1. Only proceed when the owner **explicitly** asked to add/create the player. If a result mentioned an unknown name, ask first.
2. Get the **full display name** the site should show. Display names must be unique. If another player shares the first name
   (e.g. "Chris W" and "Chris B"), use a distinguishing name — otherwise plain "Chris" becomes ambiguous in future messages.
3. `npm run mnf -- players` to check they don't already exist (maybe under a nickname — `player show <name>` resolves nicknames).
4. Dry run: `npm run mnf -- player add --name "Josh Brown" [--nickname "Brownie"] [--alias "Josh B"] [--bio "…"]`.
   - `FIRST_NAME_OVERLAP` warning → tell the owner how to refer to them from now on.
   - `PLAYER_EXISTS` / `NAME_TAKEN_BY_ALIAS` → don't create a clash; ask.
5. `--apply`. The id is generated once from the name (`josh-brown`) and **never changes**, even if they are renamed.
6. Photos are optional. If the owner supplies one now, run the `update-player` skill.
7. If a pending result was waiting on this player, go back to `publish-result` and re-run its dry run.
8. Reply: "Added **Josh Brown** (id josh-brown). Say 'Josh Brown' or 'Brownie' in future results."
