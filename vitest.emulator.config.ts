import { defineConfig } from 'vitest/config';

/** Tests that need the Firestore emulator. Run with `npm run test:rules`. */
export default defineConfig({
  test: {
    include: ['tests/**/*.emulator.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
