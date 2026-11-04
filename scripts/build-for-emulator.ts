/** Builds the site pointed at the local Firestore emulator (used by the end-to-end test). */
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['astro', 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PUBLIC_FIREBASE_PROJECT_ID: 'demo-mnf',
    PUBLIC_FIREBASE_API_KEY: 'demo-api-key',
    PUBLIC_FIREBASE_APP_ID: 'demo-app',
    PUBLIC_FIRESTORE_EMULATOR: '127.0.0.1:8080',
  },
});
process.exit(r.status ?? 1);
