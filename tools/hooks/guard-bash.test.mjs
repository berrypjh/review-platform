/**
 * .claude/hooks/guard-bash.mjs 회귀 테스트.
 *
 * 정규식만 직접 검사하지 않고 훅 프로세스를 실제로 실행한다.
 * 차단 규칙뿐 아니라 stdin 입력과 stdout 응답 형식까지 함께 검증하기 위해서다.
 * import가 깨진 hook은 exit 1로 조용히 무력해지므로, 종료 코드도 본다.
 *
 * 실행:
 *   pnpm test:hooks
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../../.claude/hooks/guard-bash.mjs', import.meta.url));

/**
 * Bash 명령을 훅에 전달한다.
 * 허용된 명령이면 null, 차단된 명령이면 차단 사유를 반환한다.
 */
const decide = (command) => {
  const stdout = execFileSync('node', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
    }),
    encoding: 'utf8',
  });

  if (!stdout.trim()) {
    return null;
  }

  const { hookSpecificOutput } = JSON.parse(stdout);
  assert.equal(hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(hookSpecificOutput.permissionDecision, 'deny');
  return hookSpecificOutput.permissionDecisionReason;
};

const BLOCKED_PORT = [
  'pnpm dev',
  'pnpm run dev',
  'nx dev web',
  'npx nx run web:dev',
  'nx run-many -t dev',
  'pnpm --dir apps/web exec next dev --port 3200',
  'pnpm exec next start -p 3100',
  'pnpm e2e',
  'nx e2e web-e2e',
  'npx nx run-many -t e2e --skip-nx-cache',
  'pnpm exec playwright test',
  'nx build web',
  'npx nx build web --skip-nx-cache',
  'nx run web:build',
  'pnpm exec http-server libs/react-ui/storybook-static -p 6006',
];

const BLOCKED_SECRET = [
  "printf 'x' > apps/web/probe.key",
  "node -e \"require('fs').readFileSync('.env')\"",
  'grep . .env.local',
  'cat .env > /tmp/x',
  'python3 -c "print(open(\'.env.production.local\').read())"',
  'base64 certs/apple.p8',
  'cp .env /tmp/leak',
];

const ALLOWED = [
  // 이 저장소의 일상 검증 명령.
  'pnpm lint',
  'pnpm typecheck',
  'pnpm test',
  'pnpm build',
  'pnpm tools:check',
  'pnpm test:hooks',
  'pnpm format:check',
  'nx run-many -t lint typecheck test',
  'nx test visual-contracts',
  'nx build visual-contracts',
  'pnpm exec playwright --version',
  'pnpm exec playwright test --list',
  'pnpm exec playwright install chromium',
  // 브라우저 없이 도는 CLI. 서버는 사용자가 띄운다.
  'pnpm visual:compare -- --run-id sample --repository x --base-sha a1b2c3d --head-sha a1b2c3d --targets fixtures/visual/targets/sample.json',
  'pnpm visual:summary -- --run-id sample --data-dir fixtures/visual/review-data',
  // 검색어 · 출력 문자열 안의 명령은 실행이 아니다.
  "grep -rn 'pnpm dev' docs",
  'echo "run pnpm e2e in your terminal"',
  // secret 경로여도 우회 수단이 없거나, 우회 수단이 있어도 secret 경로가 아니면 통과.
  'cat .env.example',
  'ls -la apps/web',
  'echo x > /tmp/out',
  'grep -rn REVIEW_DATA_DIR apps/web/src',
  // 파이프의 fd 리다이렉트는 파일 쓰기가 아니다.
  'pnpm lint 2>&1 | tail -5',
];

describe('guard-bash', () => {
  test('hook 프로세스가 정상 종료한다 (import 오류는 조용히 무력화된다)', () => {
    assert.doesNotThrow(() => decide('pnpm lint'));
  });

  for (const command of BLOCKED_PORT) {
    test(`포트 바인딩 차단: ${command}`, () => {
      const reason = decide(command);
      assert.ok(reason, '차단되어야 한다');
      assert.match(reason, /포트 바인딩/);
      assert.match(reason, /사용자에게 직접 실행을 요청/);
    });
  }

  for (const command of BLOCKED_SECRET) {
    test(`secret 우회 차단: ${command}`, () => {
      const reason = decide(command);
      assert.ok(reason, '차단되어야 한다');
      assert.match(reason, /secret 파일에 접근/);
      assert.match(reason, /\.env\.example/);
    });
  }

  for (const command of ALLOWED) {
    test(`허용: ${command}`, () => {
      assert.equal(decide(command), null);
    });
  }

  test('command가 없는 payload는 통과한다', () => {
    const stdout = execFileSync('node', [HOOK], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: {} }),
      encoding: 'utf8',
    });
    assert.equal(stdout, '');
  });
});
