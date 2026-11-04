/**
 * Browser Firestore client. Uses the Lite SDK (REST, no realtime/offline) —
 * about a third of the size of the full SDK, and all this site needs is reads.
 * There is deliberately no Auth: visitors are anonymous and read-only.
 */
import { getApps, initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore/lite';
import publicConfig from '../config/firebase.public.json';

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.PUBLIC_FIREBASE_API_KEY ?? publicConfig.apiKey,
  authDomain: env.PUBLIC_FIREBASE_AUTH_DOMAIN ?? publicConfig.authDomain,
  projectId: env.PUBLIC_FIREBASE_PROJECT_ID ?? publicConfig.projectId,
  appId: env.PUBLIC_FIREBASE_APP_ID ?? publicConfig.appId,
};

export const isConfigured = !firebaseConfig.apiKey.startsWith('REPLACE_');

let db: Firestore | undefined;

export function getDb(): Firestore {
  if (db) return db;
  const app = getApps()[0] ?? initializeApp(firebaseConfig);
  db = getFirestore(app);
  const emu = env.PUBLIC_FIRESTORE_EMULATOR;
  if (emu) {
    const [host, port] = emu.split(':');
    connectFirestoreEmulator(db, host ?? '127.0.0.1', Number(port ?? 8080));
  }
  return db;
}
