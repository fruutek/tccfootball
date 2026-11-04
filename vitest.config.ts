import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/**/*.emulator.test.{ts,tsx}', 'node_modules/**'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
