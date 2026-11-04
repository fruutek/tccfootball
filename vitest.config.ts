import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.emulator.test.ts', 'node_modules/**'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
