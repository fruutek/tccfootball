/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_FIREBASE_API_KEY?: string;
  readonly PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
  readonly PUBLIC_FIREBASE_PROJECT_ID?: string;
  readonly PUBLIC_FIREBASE_APP_ID?: string;
  /** "host:port" — when set the site reads from the local Firestore emulator. */
  readonly PUBLIC_FIRESTORE_EMULATOR?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
