/**
 * 테스트 전용 가짜 GitHub. 테스트가 `Transport`로 직접 주입한다 — 런타임(`runtime.ts`)에는 이것을 고르는 경로가 없다.
 * 요청 형식(App JWT 서명 · token 범위 · commit status 값)을 실제 API처럼 검사하고, 장애(timeout · 응답 유실 · status)를 주입할 수 있다.
 */
import { createHash, createPublicKey, createVerify, type KeyObject } from 'node:crypto';

import type { Transport } from './http.ts';
import { STATUS_CONTEXT } from './statuses.ts';

export type FakePull = {
  repositoryId: number;
  number: number;
  headSha: string;
  state: 'open' | 'closed';
  merged: boolean;
  title: string;
  author: string;
};

export type FakeStatus = {
  id: number;
  repositoryId: number;
  sha: string;
  state: string;
  context: string;
  description: string | null;
  target_url: string | null;
};

type FaultMode =
  | { kind: 'timeout' }
  | { kind: 'lose-response' }
  | { kind: 'status'; status: number; headers?: Record<string, string> };
type Fault = { method: string; path: RegExp; mode: FaultMode; remaining: number };

type Repo = { id: number; owner: string; name: string };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-github-request-id': `REQ-${status}`,
      ...headers,
    },
  });

export class FakeGitHub {
  readonly repos = new Map<number, Repo>();
  readonly pulls: FakePull[] = [];
  /** 받은 commit status 전부. GitHub처럼 덮어쓰지 않고 쌓인다 — 같은 context는 마지막 것이 보인다. */
  readonly statuses: FakeStatus[] = [];
  readonly requests: { method: string; path: string }[] = [];
  suspended = false;
  /** `commits/{sha}/pulls` 한 페이지 크기. 페이지네이션 시험용. */
  commitPullsPerPage = 100;
  /** 요청을 처리하기 직전에 부른다. 동시 push 같은 상황을 끼워 넣는다. */
  beforeRequest: ((method: string, path: string) => void | Promise<void>) | null = null;

  private readonly publicKey: KeyObject;
  private readonly tokens = new Map<string, Set<number>>();
  private readonly oauthCodes = new Map<
    string,
    { challenge: string; user: { id: number; login: string } }
  >();
  private readonly userTokens = new Map<string, { id: number; login: string }>();
  private faults: Fault[] = [];
  private nextStatusId = 9000;
  private nextToken = 1;

  constructor(
    readonly clientId: string,
    readonly clientSecret: string,
    readonly installationId: number,
    privateKey: KeyObject,
  ) {
    this.publicKey = createPublicKey(privateKey);
  }

  addRepo(repo: Repo) {
    this.repos.set(repo.id, repo);
  }

  addPull(
    pull: Partial<FakePull> & Pick<FakePull, 'repositoryId' | 'number' | 'headSha'>,
  ): FakePull {
    const full: FakePull = {
      state: 'open',
      merged: false,
      title: `PR ${pull.number}`,
      author: 'octocat',
      ...pull,
    };
    this.pulls.push(full);
    return full;
  }

  pull(repositoryId: number, number: number): FakePull {
    const found = this.pulls.find(
      (pull) => pull.repositoryId === repositoryId && pull.number === number,
    );
    if (!found) throw new Error(`No fake PR ${repositoryId}#${number}`);
    return found;
  }

  /** SHA에 쓰인 status 이력(오래된 것부터). */
  statusesOf(sha: string) {
    return this.statuses.filter((status) => status.sha === sha);
  }

  /** SHA에서 PR 화면에 보이는 status — 같은 context의 마지막 값. */
  latestStatus(sha: string, context = STATUS_CONTEXT): FakeStatus | undefined {
    return this.statusesOf(sha)
      .filter((status) => status.context === context)
      .at(-1);
  }

  /** 다음 `times`번의 일치하는 요청에 장애를 넣는다. */
  fail(method: string, path: RegExp, mode: FaultMode, times = 1) {
    this.faults.push({ method, path, mode, remaining: times });
  }

  /** OAuth authorize를 사용자가 마친 상태를 만든다. callback이 받을 code를 돌려준다. */
  authorize(codeChallenge: string, user: { id: number; login: string }): string {
    const code = `code-${this.oauthCodes.size + 1}`;
    this.oauthCodes.set(code, { challenge: codeChallenge, user });
    return code;
  }

  readonly transport: Transport = async (target, init) => {
    const request = new Request(target, init);
    const url = new URL(target);
    const path = url.pathname;
    this.requests.push({ method: request.method, path });
    await this.beforeRequest?.(request.method, path);
    const fault = this.faults.find(
      (candidate) =>
        candidate.remaining > 0 && candidate.method === request.method && candidate.path.test(path),
    );
    if (fault) {
      fault.remaining--;
      if (fault.mode.kind === 'timeout') {
        return new Promise<Response>((_, reject) => {
          // 원본 signal을 듣는다. 파생된 request.signal은 GC 뒤 abort가 오지 않을 수 있다.
          init.signal.addEventListener('abort', () => reject(init.signal.reason));
        });
      }
      if (fault.mode.kind === 'status')
        return json(fault.mode.status, { message: 'injected' }, fault.mode.headers);
      await this.route(request, url);
      throw new TypeError('fetch failed');
    }
    return this.route(request, url);
  };

  private async route(request: Request, url: URL): Promise<Response> {
    const { pathname: path, host } = url;
    const method = request.method;
    if (host === 'github.com' && method === 'POST' && path === '/login/oauth/access_token') {
      return this.exchange(new URLSearchParams(await request.text()));
    }
    if (host !== 'api.github.com') return json(404, { message: 'Not Found' });
    if (request.headers.get('x-github-api-version') !== '2026-03-10')
      return json(400, { message: 'API version' });
    const bearer = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';

    const match = path.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
    if (match && method === 'POST')
      return this.createToken(bearer, Number(match[1]), await request.json());
    if (path === '/user' && method === 'GET') {
      const user = this.userTokens.get(bearer);
      return user ? json(200, user) : json(401, { message: 'Bad credentials' });
    }
    const allowed = this.tokens.get(bearer);
    if (!allowed) return json(401, { message: 'Bad credentials' });
    if (path === '/installation/repositories' && method === 'GET') {
      const repositories = [...this.repos.values()]
        .filter((repo) => allowed.has(repo.id))
        .map((repo) => this.repoJson(repo));
      return json(200, { total_count: repositories.length, repositories });
    }
    const [, owner, name, rest] = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)$/) ?? [];
    const repo = [...this.repos.values()].find((r) => r.owner === owner && r.name === name);
    if (!repo || !rest || !allowed.has(repo.id)) return json(404, { message: 'Not Found' });
    return this.repoRoute(request, url, repo, rest);
  }

  private async repoRoute(request: Request, url: URL, repo: Repo, rest: string): Promise<Response> {
    const method = request.method;
    let match = rest.match(/^\/pulls\/(\d+)$/);
    if (match && method === 'GET') {
      const number = Number(match[1]);
      const pull = this.pulls.find((p) => p.repositoryId === repo.id && p.number === number);
      return pull ? json(200, this.pullJson(pull)) : json(404, { message: 'Not Found' });
    }
    if (rest === '/pulls' && method === 'GET') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const perPage = Number(url.searchParams.get('per_page') ?? 30);
      const open = this.pulls.filter((p) => p.repositoryId === repo.id && p.state === 'open');
      return this.page(
        url,
        open.map((p) => this.pullJson(p)),
        page,
        perPage,
      );
    }
    match = rest.match(/^\/commits\/([0-9a-f]{40})\/pulls$/);
    if (match && method === 'GET') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const head = match[1];
      const withHead = this.pulls.filter((p) => p.headSha === head);
      return this.page(
        url,
        withHead.map((p) => this.pullJson(p)),
        page,
        this.commitPullsPerPage,
      );
    }
    match = rest.match(/^\/statuses\/([0-9a-f]{40})$/);
    if (match && method === 'POST')
      return this.createStatus(repo, String(match[1]), await request.json());
    return json(404, { message: 'Not Found' });
  }

  private page(url: URL, items: unknown[], page: number, perPage: number) {
    const slice = items.slice((page - 1) * perPage, page * perPage);
    const headers: Record<string, string> = {};
    if (page * perPage < items.length) {
      const next = new URL(url);
      next.searchParams.set('page', String(page + 1));
      headers['link'] = `<${next}>; rel="next"`;
    }
    return json(200, slice, headers);
  }

  private createToken(
    jwt: string,
    installationId: number,
    body: { repository_ids?: number[]; permissions?: unknown },
  ) {
    if (!this.verifyJwt(jwt))
      return json(401, { message: 'A JSON web token could not be decoded' });
    if (installationId !== this.installationId) return json(404, { message: 'Not Found' });
    if (this.suspended) return json(403, { message: 'This installation has been suspended' });
    const ids = body.repository_ids ?? [];
    if (ids.length === 0 || ids.some((id) => !this.repos.has(id))) {
      return json(422, {
        message: 'There is at least one repository that does not exist or is not accessible',
      });
    }
    const wanted = JSON.stringify(body.permissions);
    if (wanted !== JSON.stringify({ statuses: 'write', pull_requests: 'read', metadata: 'read' })) {
      return json(422, { message: 'Unexpected permissions' });
    }
    const token = `ghs_fake_${this.nextToken++}`;
    this.tokens.set(token, new Set(ids));
    return json(201, { token, expires_at: new Date(Date.now() + 3_600_000).toISOString() });
  }

  private verifyJwt(jwt: string): boolean {
    const [header, payload, signature] = jwt.split('.');
    if (!header || !payload || !signature) return false;
    const valid = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(this.publicKey, Buffer.from(signature, 'base64url'));
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      iat: number;
      exp: number;
      iss: string;
    };
    const now = Math.floor(Date.now() / 1000);
    return (
      valid &&
      claims.iss === this.clientId &&
      claims.iat <= now &&
      claims.exp > now &&
      claims.exp - claims.iat <= 600
    );
  }

  private createStatus(repo: Repo, sha: string, body: Record<string, unknown>) {
    const description = (body['description'] as string | undefined) ?? null;
    if (!['error', 'failure', 'pending', 'success'].includes(String(body['state'])))
      return json(422, { message: 'Validation Failed' });
    if (description !== null && description.length > 140)
      return json(422, { message: 'description is too long (maximum is 140 characters)' });
    const status: FakeStatus = {
      id: this.nextStatusId++,
      repositoryId: repo.id,
      sha,
      state: String(body['state']),
      context: (body['context'] as string | undefined) ?? 'default',
      description,
      target_url: (body['target_url'] as string | undefined) ?? null,
    };
    this.statuses.push(status);
    const { id, state, context, target_url } = status;
    return json(201, { id, state, context, description, target_url });
  }

  private exchange(form: URLSearchParams) {
    const grant = this.oauthCodes.get(form.get('code') ?? '');
    const verifier = form.get('code_verifier') ?? '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (
      !grant ||
      form.get('client_id') !== this.clientId ||
      form.get('client_secret') !== this.clientSecret ||
      challenge !== grant.challenge
    ) {
      return json(200, { error: 'bad_verification_code' });
    }
    this.oauthCodes.delete(form.get('code') ?? '');
    const token = `gho_fake_${this.nextToken++}`;
    this.userTokens.set(token, grant.user);
    return json(200, { access_token: token, token_type: 'bearer', scope: '' });
  }

  private repoJson(repo: Repo) {
    return { id: repo.id, name: repo.name, owner: { login: repo.owner } };
  }

  private pullJson(pull: FakePull) {
    const base = this.repos.get(pull.repositoryId);
    if (!base) throw new Error(`No fake repository ${pull.repositoryId}`);
    return {
      number: pull.number,
      state: pull.state,
      merged_at: pull.merged ? '2026-10-10T00:00:00Z' : null,
      title: pull.title,
      html_url: `https://github.com/${base.owner}/${base.name}/pull/${pull.number}`,
      user: { login: pull.author },
      head: { sha: pull.headSha, repo: { id: 999_999, name: 'fork' } },
      base: { repo: this.repoJson(base) },
    };
  }
}
