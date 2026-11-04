---
name: update-player
description: Change a player's profile — display name, nickname, aliases, biography, profile photo, or archive/unarchive. Use for "give Adam the nickname Ads", "update Peter's bio", "here's a photo for Tom", "Josh has left the group".
---

# Update a player profile

> **Running commands:** where this skill says `npm run mnf -- X`, in a session without database credentials run the **Publish workflow** with `command: X` (see `CLAUDE.md` → "Reaching the database"): dry run first, then the identical inputs with `apply: "true"`.

Statistics are never edited here — they come from matches. Only profile fields change. The player **id never changes**,
so history and links stay intact when a name does.

1. Resolve who: `npm run mnf -- player show "<name>"`. If ambiguous, ask.
2. Dry run with the relevant flags:
   - name: `--display-name "Peter Hughes"`  · nickname: `--nickname "Pistol"` / `--clear-nickname`
   - aliases (extra spellings for matching names in messages): `--add-alias "Pete"` / `--remove-alias "Pete"`
   - bio: `--bio "…"` / `--clear-bio` (use only text the owner gave you; never invent biography)
   - archive a player who left: `--archive` (their matches and stats remain); `--unarchive`
   - photo: `--photo /path/to/image.jpg` — optimised to a 512 px square WebP in `public/photos/`
3. `--apply`.
4. **Photos need a deploy** (they are static files served by Hosting): after the command, run
   `git add public/photos && git commit -m "Add photo for <name>" && git push` **when the owner has asked you to commit**
   (CI on `main` deploys). Until that finishes the site shows the placeholder avatar, which is fine. A photo is never required.
5. Reply with what changed. Mention the deploy step for photos.
