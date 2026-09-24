import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: 'web',
    watch: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
