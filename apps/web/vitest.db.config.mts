import { defineConfig } from 'vitest/config';

// 실제 PostgreSQL이 필요한 통합 테스트. `TEST_DATABASE_URL`이 있어야 하고 `nx test-db web`으로만 돈다.
// 파일마다 schema를 따로 만들지만, 연결 수를 작게 유지하려고 파일을 순서대로 돌린다.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: 'web-db',
    watch: false,
    environment: 'node',
    include: ['src/**/*.db-test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
