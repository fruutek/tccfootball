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
| Automatic deploys from GitHub | **Pending** — needs the keyless trust link in §5–6 below; until then the deploy job skips with a notice |
| Publishing credentials | **Pending** — see §5 |

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

## 5. Publisher credentials — how Claude is allowed to write

Writes use the Firebase **Admin SDK**, which bypasses security rules, so the credential is the real gate. Give it the least
privilege that works: a dedicated service account that can read/write Firestore and **nothing else**.

```bash
PROJECT=tcc-monday-night-football
gcloud iam service-accounts create mnf-publisher --project $PROJECT \
  --display-name "MNF publisher (Firestore read/write only)"
gcloud projects add-iam-policy-binding $PROJECT \
  --member "serviceAccount:mnf-publisher@$PROJECT.iam.gserviceaccount.com" \
  --role roles/datastore.user
```

`roles/datastore.user` ("Cloud Datastore User") covers Firestore documents. It cannot deploy hosting, change rules or IAM, or
touch other services. Then choose **one** way to hand it to the CLI:

**A. Key stored as a secret in Claude's environment (best for Claude Code on the web / remote sessions).**

```bash
gcloud iam service-accounts keys create mnf-publisher.json \
  --iam-account mnf-publisher@$PROJECT.iam.gserviceaccount.com
```

Paste the file's contents (or its `base64` form) into the session's environment secret **`MNF_SERVICE_ACCOUNT_JSON`**, then delete the
local file (`rm mnf-publisher.json`). The CLI reads it from the environment only; `.gitignore` blocks key-shaped files and
`CLAUDE.md` forbids printing it. If the key is ever exposed: Google Cloud console → IAM → Service accounts → Keys → delete, create a new one.
(If your organisation blocks key creation, use B.)

**B. No key file at all (best on your own computer).** Impersonate the account with your own login:

```bash
gcloud iam service-accounts add-iam-policy-binding mnf-publisher@$PROJECT.iam.gserviceaccount.com \
  --member "user:YOU@gmail.com" --role roles/iam.serviceAccountTokenCreator
gcloud auth application-default login \
  --impersonate-service-account=mnf-publisher@$PROJECT.iam.gserviceaccount.com
```

The CLI picks up Application Default Credentials automatically. Nothing long-lived is stored.

**C. Your own account** (`gcloud auth application-default login`) works too, but carries *your* full permissions. Fine on your laptop for
a hobby project; not recommended for a cloud agent.

**Verify:**

```bash
npm run mnf -- status       # must say  Target: PRODUCTION project tcc-monday-night-football
```

If it reports `PERMISSION_DENIED`, the account is missing `roles/datastore.user` on that project. If it reports it could not find
credentials, the environment variable / login from this step is not visible to the shell running Claude.

## 6. GitHub → Firebase Hosting (automatic deploys)

The repository is `fruutek/tccfootball`. The workflow `.github/workflows/ci-deploy.yml` verifies every push and, on `main`, builds and
deploys to Hosting. It needs a **Hosting-only** credential and the project id:

```bash
gcloud iam service-accounts create mnf-hosting-deployer --project $PROJECT --display-name "MNF Hosting deploy (CI)"
for ROLE in roles/firebasehosting.admin roles/serviceusage.apiKeysViewer; do
  gcloud projects add-iam-policy-binding $PROJECT \
    --member "serviceAccount:mnf-hosting-deployer@$PROJECT.iam.gserviceaccount.com" --role $ROLE
done
gcloud iam service-accounts keys create deployer.json \
  --iam-account mnf-hosting-deployer@$PROJECT.iam.gserviceaccount.com

gh secret   set FIREBASE_SERVICE_ACCOUNT --repo fruutek/tccfootball < deployer.json
gh variable set FIREBASE_PROJECT_ID      --repo fruutek/tccfootball --body $PROJECT
rm deployer.json
```

(Alternative: `npx firebase init hosting:github` creates a similar account and secret interactively — if you use it, decline overwriting
the workflow and rename the secret it created, or edit the workflow's secret name.) These are the roles documented for
`FirebaseExtended/action-hosting-deploy`; if the first run fails with a permissions error it names the role to add.

Then merge the work to `main` (this build is on branch `claude/monday-night-football-site-i2oa6j`). The first run creates the
`production` GitHub environment; you can add required reviewers to it if you want a manual gate. After it succeeds the site is live at
`https://tcc-monday-night-football.web.app` (or your project id). One-time, if Hosting says there is no site: `npx firebase hosting:sites:create <project-id>`.

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
