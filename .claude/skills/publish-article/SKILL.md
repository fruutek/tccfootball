---
name: publish-article
description: Write and publish a news article — player spotlight, humorous piece, records & milestones, or any feature (match reports normally go through publish-result). Use for "write a spotlight on Danny", "do something funny about the bibs", "publish a piece on the biggest wins".
---

# Publish an article

Categories: `match-report`, `spotlight`, `roundup`, `humour`, `records`.

1. **Gather facts, don't recall them.** For anything with numbers, get them from the data:
   `npm run mnf -- player show "<name>"`, `npm run mnf -- stats show --board goals --period season:2026`,
   `npm run mnf -- facts match <id>`. Quote only what these (or the owner) say.
2. **Write it.** Title, one-sentence **standfirst**, Markdown **body** (see `CLAUDE.md` for the allowed subset).
   Humour pieces may be entirely invented *as comedy* — but never attribute fake quotes or events to **real named players** in
   a way that reads as fact, and keep it kind: nothing humiliating, nothing about private life. If in doubt, ask the owner.
3. Spec (`--stdin`):
   ```json
   { "title": "…", "standfirst": "…", "body": "…", "category": "spotlight",
     "players": ["Danny"], "slug": "optional-custom-slug",
     "featuredImage": { "src": "/images/news/x.webp", "alt": "…" },
     "instruction": "<owner's message>" }
   ```
   `players` links the article to profiles ("In this story"). Images are optional; if supplied, copy to `public/images/news/`
   and deploy (same as player photos).
4. Dry run `npm run mnf -- article publish --stdin`; fix errors (`SLUG_EXISTS` → different slug, or `article edit` to update).
5. `--apply`. Reply with the link `/news/<slug>`.
6. To revise a published piece: same JSON with the existing `slug`, via `article edit --stdin`.
