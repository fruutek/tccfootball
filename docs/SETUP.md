# Setup — what only you can do

Everything in this repository is built, tested and verified against the **local Firebase emulators**. Creating the real
Firebase project, signing in to Google, and granting the two service accounts require *your* Google account, so they are
the manual steps below. Budget about 20 minutes. Everything fits on the free **Spark** plan — no billing account is needed.

> **Honest status.** The commands below use the Firebase and gcloud CLIs as documented, and the repository's own code paths are
> covered by tests. The Google-side steps themselves (project creation, IAM, first deploy) could **not** be exercised from the
> build environment because it has no Google credentials. If a step errors, the message names what is missing — typically a role —
> and the fix is a one-line change. Start with the "Verify" checks at each stage.

## Status of this installation (project `tccfootball`)

| | |
|---|---|
| Firebase project | `tccfootball` (Spark plan, no billing) — created by the owner |
| Firestore | `(default)` database, Native mode, **eur3** (EU multi-region), free-tier eligible — created by the owner |
| Security rules | **Deployed and verified** against the live database (anonymous read of published data allowed; every write, the audit log and unfiltered lists refused) |
| Website | **Live:** https://tccfootball.web.app — deployed to Hosting site `tccfootball` |
| Web config | `src/config/firebase.public.json` holds the project's public web identifiers |
| Code | Merged to `main` through a pull request whose CI (types, unit, emulator, browser end-to-end, bundle guard) passed |
| Automatic deploys from GitHub | **Live and keyless.** Every merge to `main` is tested, deployed and smoke-tested against the live URL; no secret is stored anywhere (§5) |
| Publishing | **Live and keyless.** Claude publishes through the `Publish` workflow; verified end to end on production (publish → live site → duplicate refused → audit → removal) (§5) |
| Default branch | Still the original branch name (the repo was empty when first pushed). **Cosmetic:** change it to `main` in GitHub → Settings → Branches. Nothing depends on it |

Everything below is the general procedure; steps already done are marked above.

## 0. Prerequisites

* A Google account · Node 22 (`node -v`) · `git` · the [`gcloud` CLI](https://cloud.google.com/sdk/docs/install) · the [`gh` CLI](https://cli.github.com) (optional, for secrets)
* In this repo: `npm ci`

## 1. Create the Firebase project

```bash
npx firebase login
npx firebase projects:create tcc-monday-night-football --display-name "Monday Night Football"
```

The project id is global; if it is taken pick another (6–30 chars: lowercase letters, digits, hyphens). Your site will be
`https://<project-id>.web.app`. Stay on the free Spark plan.

## 2. Create the Firestore database (Native mode)

```bash
npx firebase firestore:locations                      # pick one close to you, e.g. europe-west2 (London)
npx firebase firestore:databases:create "(default)" --location europe-west2 --project tcc-monday-night-football
```

The location is permanent. Use the **(default)** database — it is the one covered by the free quota.

## 3. Register the web app and connect this repo to it

```bash
npx firebase apps:create web "MNF Website" --project tcc-monday-night-football     # prints an App ID
npx firebase apps:sdkconfig web <APP_ID> --project tcc-monday-night-football --out sdkconfig.txt
npm run setup:firebase -- --project tcc-monday-night-football --from-sdkconfig sdkconfig.txt
rm sdkconfig.txt
```

This rewrites `.firebaserc` and `src/config/firebase.public.json`. **Those values are public identifiers, not secrets** — they
ship to every browser by design. Security comes from the rules (next step) and from writes being impossible for the public.

## 4. Deploy the security rules and verify them

```bash
npm run deploy:rules        # = firebase deploy --only firestore  (rules + indexes)
```

Verify in the Firebase console → Firestore → Rules that the deployed text matches `firestore.rules`. The same rules are proven by
`npm run test:rules` (51 allow/deny cases, mutation-checked). Re-run `npm run deploy:rules` whenever `firestore.rules` changes —
CI deliberately does **not** hold a credential that can change rules.

## 5. Keyless access for GitHub — publishing and deploys (configured)

No passwords or keys exist for this project. GitHub Actions proves to Google *who it is* (an OIDC token that names the repository, branch and workflow), and
Google hands that exact workflow a short-lived token for one restricted service account.

| Service account | Can do | Cannot do | Usable only by |
|---|---|---|---|
| `mnf-hosting-deployer` | Update the website files on Firebase Hosting (`roles/firebasehosting.admin`, `roles/serviceusage.serviceUsageConsumer`) | Read or write Firestore data, change rules or permissions | workflow `ci-deploy.yml` running on `main` |
| `mnf-publisher` | Read and write Firestore documents (`roles/datastore.user`) | Deploy, change rules or permissions, touch any other service | workflow `publish.yml` running on `main` |

Trust link: workload identity pool `github-actions` / provider `github`, with the condition
`assertion.repository == 'fruutek/tccfootball' && assertion.ref == 'refs/heads/main'` — pull requests, forks and other branches get nothing.
Neither account has a downloadable key (verified by listing user-managed keys: zero).

**How publishing flows:** you message Claude → Claude starts the `Publish` workflow with the request (dry run) → reads the log → starts it again with *apply* ticked →
the CLI writes to Firestore → the site shows it on the next page load. See `docs/PUBLISHING.md`.

**Inspect:** Google Cloud console → IAM & Admin → *Workload Identity Federation*, and → *Service accounts*.
**Revoke instantly:** delete the provider `github` (or either service account) in those pages — publishing/deploys stop at once. Nothing else is affected.
**Recreate** (equivalent `gcloud` commands, for reference; the live setup was made through Google's API and verified by reading it back):

```bash
P=tccfootball; N=495407655486; R=fruutek/tccfootball
gcloud iam service-accounts create mnf-hosting-deployer --project $P
gcloud iam service-accounts create mnf-publisher --project $P
gcloud projects add-iam-policy-binding $P --member serviceAccount:mnf-hosting-deployer@$P.iam.gserviceaccount.com --role roles/firebasehosting.admin
gcloud projects add-iam-policy-binding $P --member serviceAccount:mnf-hosting-deployer@$P.iam.gserviceaccount.com --role roles/serviceusage.serviceUsageConsumer
gcloud projects add-iam-policy-binding $P --member serviceAccount:mnf-publisher@$P.iam.gserviceaccount.com --role roles/datastore.user
gcloud iam workload-identity-pools create github-actions --project $P --location global
gcloud iam workload-identity-pools providers create-oidc github --project $P --location global --workload-identity-pool github-actions \
  --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.workflow_ref=assertion.workflow_ref \
  --attribute-condition "assertion.repository=='$R' && assertion.ref=='refs/heads/main'"
for pair in mnf-hosting-deployer:ci-deploy.yml mnf-publisher:publish.yml; do
  gcloud iam service-accounts add-iam-policy-binding ${pair%%:*}@$P.iam.gserviceaccount.com --project $P --role roles/iam.workloadIdentityUser \
    --member "principalSet://iam.googleapis.com/projects/$N/locations/global/workloadIdentityPools/github-actions/attribute.workflow_ref/$R/.github/workflows/${pair##*:}@refs/heads/main"
done
```

*Alternative for a laptop:* the CLI also accepts `MNF_SERVICE_ACCOUNT_JSON` or `gcloud auth application-default login --impersonate-service-account=mnf-publisher@…`
and then runs directly — but nothing requires it.

## 6. Automatic deploys (configured)

`.github/workflows/ci-deploy.yml`: on every push and pull request it type-checks and runs the unit, emulator and real-browser end-to-end tests and checks the bundle.
On a push to `main` it then builds, signs in keylessly as `mnf-hosting-deployer`, runs `firebase deploy --only hosting`, and **smoke-tests the live URL**
(home page, the rewrite shells, the main pages). A failing test blocks the deploy. Security rules are deliberately *not* auto-deployed: run `npm run deploy:rules`
yourself (or ask Claude, signed in) when `firestore.rules` changes.

## 7. Before launch: remove the demo data

The repo ships a fictional demo dataset (12 invented players, 10 matches, articles), every document flagged `fictional: true`, with a
yellow **DEMO** banner on every page while any exists.

```bash
npm run mnf -- demo seed --apply     # optional: preview the finished site on your real project
npm run mnf -- demo purge --apply    # removes ONLY fictional documents; real data is never touched (reversible via revert)
```

Then add the real roster and publish the first real result — see `docs/EXAMPLES.md`.

## 8. Claude Code

* `.mcp.json` registers the official **Firebase MCP server** (`npx firebase mcp --only core,firestore`). Approve it when Claude Code asks, and
  run `npx firebase login` once so it can reach your project. Use it to *inspect* data conversationally; all validated writes go through `npm run mnf`.
* Skills in `.claude/skills/` and the rules in `CLAUDE.md` load automatically in this repo.
* Optional — fewer permission prompts. Claude Code asks before running commands. To pre-approve the **read-only** `mnf` commands and block
  secret files, you can add this to `.claude/settings.json` yourself (it was deliberately not added automatically, because it changes
  what Claude is allowed to do):

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run mnf -- status)", "Bash(npm run mnf -- players)", "Bash(npm run mnf -- player show *)",
      "Bash(npm run mnf -- match list*)", "Bash(npm run mnf -- match show *)", "Bash(npm run mnf -- article list)",
      "Bash(npm run mnf -- stats *)", "Bash(npm run mnf -- facts *)", "Bash(npm run mnf -- audit*)"
    ],
    "deny": ["Read(**/*service-account*.json)", "Read(**/*-adminsdk-*.json)", "Read(./.env)", "Read(./.env.*)"]
  },
  "hooks": { "SessionStart": [{ "hooks": [{ "type": "command", "command": "[ -d node_modules ] || npm ci --silent" }] }] }
}
```

Writes (`--apply`) are intentionally left to prompt, so you see each publish. Choose "always allow" for `npm run mnf -- … --apply`
if you want fully hands-off publishing.

## Limits to know about (Spark plan)

| Resource | Free quota | This site |
|---|---|---|
| Firestore reads | 50 000 / day | ~1 per page view; a full reload of the data (players + matches + articles ≈ 100–300 docs) only after something was published, once per visitor |
| Firestore writes | 20 000 / day | A publish is ~5–10 writes |
| Firestore storage | 1 GiB | A season of matches is well under 1 MB |
| Hosting | 10 GB storage, ~360 MB/day transfer | The whole site is ≈ 0.5 MB of JS/CSS/fonts + photos (≈ 40 KB each) |

Set a budget alert only if you ever move to the paid plan; on Spark the worst case is that the quota runs out and the site pauses until the next day.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Site shows "not connected to Firebase yet" | `src/config/firebase.public.json` still has `REPLACE_…` placeholders → step 3 |
| Site shows an error / empty after publishing | Rules not deployed (step 4), or no `settings/site` yet — publish anything and it is created |
| `mnf` says `Setup problem` / `Could not authenticate` | Step 5 credential missing in this shell's environment |
| `PERMISSION_DENIED` from `mnf` | Publisher account lacks `roles/datastore.user` on this project |
| Deploy fails on permissions | Add the role named in the error to `mnf-hosting-deployer` |
| New player photo not showing | Photos are static files — commit and push `public/photos/` so CI deploys them; the placeholder avatar shows meanwhile |
