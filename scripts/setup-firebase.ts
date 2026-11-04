/**
 * Connects this repository to YOUR Firebase project by writing the two public config files:
 *
 *   .firebaserc                       default project id (used by the Firebase CLI and the mnf CLI)
 *   src/config/firebase.public.json   the web app's public identifiers (apiKey, appId …)
 *
 * Nothing here is secret: Firebase web config is meant to ship to browsers. What protects the
 * data is firestore.rules, and what protects writes is that only the Admin SDK can make them.
 *
 *   npm run setup:firebase -- --project my-project-id --from-sdkconfig sdkconfig.txt
 *   npm run setup:firebase -- --project my-project-id --api-key AIza… --app-id 1:123:web:abc
 *
 * Get sdkconfig.txt with:  npx firebase apps:sdkconfig web <APP_ID> --project my-project-id --out sdkconfig.txt
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

export interface PublicConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

/** Accepts the output of `firebase apps:sdkconfig web` (JS snippet or plain JSON) and extracts the config. */
export function parseSdkConfig(text: string): Partial<PublicConfig> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No config object found in that file.');
  const raw = text.slice(start, end + 1);
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // JS-style object literal with unquoted keys / single quotes.
    const fixed = raw.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/g, '}');
    obj = JSON.parse(fixed) as Record<string, unknown>;
  }
  const s = (k: string) => (typeof obj[k] === 'string' ? (obj[k] as string) : undefined);
  const out: Partial<PublicConfig> = {};
  const apiKey = s('apiKey'), authDomain = s('authDomain'), projectId = s('projectId'), appId = s('appId');
  if (apiKey) out.apiKey = apiKey;
  if (authDomain) out.authDomain = authDomain;
  if (projectId) out.projectId = projectId;
  if (appId) out.appId = appId;
  return out;
}

export function validateProjectId(id: string): string | null {
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(id)
    ? null
    : 'A project id is 6–30 characters: lowercase letters, digits and hyphens, starting with a letter.';
}

function main() {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      'api-key': { type: 'string' },
      'app-id': { type: 'string' },
      'auth-domain': { type: 'string' },
      'from-sdkconfig': { type: 'string' },
    },
  });
  let cfg: Partial<PublicConfig> = {};
  if (values['from-sdkconfig']) {
    if (!existsSync(values['from-sdkconfig'])) throw new Error(`File not found: ${values['from-sdkconfig']}`);
    cfg = parseSdkConfig(readFileSync(values['from-sdkconfig'], 'utf8'));
  }
  const projectId = values.project ?? cfg.projectId;
  const apiKey = values['api-key'] ?? cfg.apiKey;
  const appId = values['app-id'] ?? cfg.appId;
  if (!projectId || !apiKey || !appId) {
    console.error('Need a project id, an API key and an app id. See the comment at the top of scripts/setup-firebase.ts.');
    process.exit(64);
  }
  const bad = validateProjectId(projectId);
  if (bad) {
    console.error(bad);
    process.exit(64);
  }
  const config: PublicConfig = {
    apiKey,
    authDomain: values['auth-domain'] ?? cfg.authDomain ?? `${projectId}.firebaseapp.com`,
    projectId,
    appId,
  };
  writeFileSync('.firebaserc', `${JSON.stringify({ projects: { default: projectId } }, null, 2)}\n`);
  writeFileSync(
    'src/config/firebase.public.json',
    `${JSON.stringify(
      {
        _comment: 'Public Firebase web-app identifiers (NOT secrets). Written by `npm run setup:firebase`. Security comes from firestore.rules, not from hiding these.',
        ...config,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`✔ Wrote .firebaserc and src/config/firebase.public.json for project "${projectId}".`);
  console.log(`  Site URL once deployed: https://${projectId}.web.app`);
  console.log('  Next: deploy the rules (npm run deploy:rules), commit these two files, and push to main.');
}

if (process.argv[1] && /setup-firebase\.ts$/.test(process.argv[1])) main();
