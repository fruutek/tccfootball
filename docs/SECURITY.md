# Security model

## The short version

* **The public can read published data. Nothing else.** No client — anonymous or signed-in — can create, change or delete any document.
* **There are no logins.** No player accounts, no admin dashboard, no Firebase Auth. So there is no credential in the browser to steal.
* **Writes come from one place:** the `mnf` CLI using the Firebase Admin SDK. In production it runs inside the `Publish` GitHub workflow as a dedicated, least-privilege service account reached **keylessly** (Workload Identity Federation) — no key or password exists to leak.
* **Every change is reversible:** the full before/after of each document is kept in a private audit log.

## What each layer guarantees

| Layer | Guarantee | Proof |
|---|---|---|
| `firestore.rules` | Public `get`/`list` allowed only on `players`, `matches` and `articles` with `status == 'published'`, and `settings/site` (`get` only). Every write is `false`. `auditLog` and every other path are fully denied. | `tests/rules.emulator.test.ts` — **51 cases**, run as an anonymous user *and* as a signed-in user, covering reads, unpublished leaks, unfiltered list queries, auto-id creates, batched writes, status-flip attacks and "bump `dataRevision` to force reloads". |
| The tests themselves | They fail when the rules are weak. | Mutation-checked: with writes opened, **19** tests fail; with unpublished reads opened, **6** fail. |
| Live behaviour | The real browser build, talking to the emulated Firestore with the real rules, is refused when it tries to write (HTTP 403) and cannot read the audit log or an unpublished match. | `scripts/e2e.ts` — "Security" step. |
| Publisher | `mnf-publisher`: only `roles/datastore.user`. Cannot deploy, change rules, or touch IAM or other services. Usable only by `publish.yml` on `main`; **no downloadable key exists** (verified). | `docs/SETUP.md` §5 |
| Deployer | A *different* account, `mnf-hosting-deployer`: Hosting only. Cannot read or write Firestore data. Usable only by `ci-deploy.yml` on `main`. | `docs/SETUP.md` §5 |
| Workflow inputs | Untrusted text (the repo is public): allow-listed command, hand tokenised, never passed to a shell; `--apply/--file/--project` refused inside the text. | `tests/run-mnf.test.ts` |
| Repository | `.gitignore` blocks service-account/key/env files. `CLAUDE.md` forbids printing or committing credentials. The browser bundle imports neither `firebase-admin` nor zod (a test enforces it, and CI greps the build). | `tests/bundle-hygiene.test.ts`, `ci-deploy.yml` |

## Data integrity and reversibility

* Every document is validated against a strict schema before writing (unknown fields are rejected).
* Writes are single atomic transactions; `create` refuses to overwrite and `update`/`delete` refuse if the document changed since the plan
  was made (optimistic concurrency) — so two simultaneous publishes cannot both win and a stale plan cannot clobber a newer edit.
* `auditLog` records `before`, `after`, the command, the actor and the owner's original message. `revert <opId>` restores it, and refuses if
  a later change touched the same document.
* Statistics are never stored, so a bad number can only come from a bad match record — and `stats audit` re-checks every match.

## Rendering safety

Article bodies are rendered by a small Markdown renderer that **builds React elements directly and never emits raw HTML**. `<script>` and
`<img onerror>` in content appear as inert text; `javascript:`, `data:` and protocol-relative links are dropped
(`tests/markdown.test.tsx`).

## Things that are public by design

* The Firebase web config (`apiKey`, `appId`, `projectId`) in `src/config/firebase.public.json`. Firebase documents these as identifiers, not secrets.
* Player display names, nicknames, bios, photos, results and articles. Don't put anything in a profile you wouldn't put on a public page —
  `CLAUDE.md` tells Claude not to add real surnames, contact details or private information unless the owner supplies it.

## Residual risks (and what to do about them)

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Someone scripts lots of reads to burn the Spark daily read quota (50 000) so the site stops until tomorrow | Low for a private friends' site; nuisance only (no data loss, no cost on Spark) | Optional: enable Firebase App Check; or simply wait for the quota reset |
| Someone with write access to the repo runs the Publish workflow | They can publish — the same power as the owner; nobody else can (forks and other branches get no Google access) | Keep repository write access to people you trust; every change is in the audit log and reversible; revoke instantly by deleting the identity provider (`SETUP.md` §5) |
| Workflow logs are public (public repo) | Requests and dry-run reports are visible to anyone | Publish only website-bound content; Claude never copies private chat into requests |
| The owner's instruction is misunderstood by Claude | Wrong result published | Dry-run-first design, refusal on inconsistent data, explicit questions on ambiguity, stat-change preview, one-command revert |
| The Admin SDK bypasses rules | By design | The credential is the gate — hence least privilege and no key in the repo |
