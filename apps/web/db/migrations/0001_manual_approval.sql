-- PR 수동 승인 저장소. 설계: docs/manual-approval/architecture.md
-- GitHub ID는 bigint, SHA는 40자 소문자 hex. 상태 값은 CHECK로 닫는다.

CREATE TABLE pull_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repository_id bigint NOT NULL CHECK (repository_id > 0),
  installation_id bigint NOT NULL CHECK (installation_id > 0),
  number integer NOT NULL CHECK (number > 0),
  owner text NOT NULL,
  name text NOT NULL,
  title text NOT NULL,
  author_login text NOT NULL,
  html_url text NOT NULL,
  head_sha text NOT NULL CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  state text NOT NULL CHECK (state IN ('open', 'closed', 'merged')),
  active_revision_id bigint,
  blocked_reason text CHECK (
    blocked_reason IN ('installation-suspended', 'installation-deleted', 'repository-removed')
  ),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repository_id, number)
);

-- 승인 단위. HEAD 변경 · 재오픈마다 generation이 하나 늘고, 과거 행은 지우지 않는다.
-- desired_check_state · sync_state가 GitHub 반영 의도(outbox)다.
CREATE TABLE revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pull_request_id bigint NOT NULL REFERENCES pull_requests (id),
  generation integer NOT NULL CHECK (generation > 0),
  head_sha text NOT NULL CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'approved')),
  approver_id bigint CHECK (approver_id > 0),
  approver_login text,
  decision_at timestamptz,
  desired_check_state text NOT NULL DEFAULT 'queued' CHECK (desired_check_state IN ('queued', 'success')),
  check_run_id bigint UNIQUE,
  sync_state text NOT NULL DEFAULT 'pending' CHECK (sync_state IN ('pending', 'synced', 'error', 'unknown')),
  last_error text,
  last_synced_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pull_request_id, generation),
  UNIQUE (id, pull_request_id),
  CONSTRAINT revisions_decision_consistent CHECK (
    (decision = 'pending' AND desired_check_state = 'queued'
      AND approver_id IS NULL AND approver_login IS NULL AND decision_at IS NULL)
    OR
    (decision = 'approved' AND desired_check_state = 'success'
      AND approver_id IS NOT NULL AND approver_login IS NOT NULL AND decision_at IS NOT NULL)
  )
);

-- active revision은 반드시 같은 PR의 revision이다.
ALTER TABLE pull_requests
  ADD CONSTRAINT pull_requests_active_revision_fk
  FOREIGN KEY (active_revision_id, id) REFERENCES revisions (id, pull_request_id);

CREATE INDEX revisions_unsynced_idx ON revisions (pull_request_id) WHERE sync_state <> 'synced';

-- PR 단위 처리 claim. 만료되면 다른 처리자가 가져가고 fence가 늘어난다.
-- PR 행이 생기기 전(첫 webhook)에도 잡을 수 있게 pull_requests와 분리한다.
CREATE TABLE pull_request_claims (
  repository_id bigint NOT NULL CHECK (repository_id > 0),
  number integer NOT NULL CHECK (number > 0),
  token uuid NOT NULL,
  fence bigint NOT NULL CHECK (fence > 0),
  lease_until timestamptz NOT NULL,
  PRIMARY KEY (repository_id, number)
);

-- delivery ID 단위 중복 방지. Redeliver는 같은 ID로 오므로 failed · 만료된 processing은 다시 처리한다.
CREATE TABLE webhook_deliveries (
  delivery_id text PRIMARY KEY CHECK (length(delivery_id) BETWEEN 1 AND 100),
  event text NOT NULL,
  action text,
  repository_id bigint,
  installation_id bigint,
  pull_number integer,
  status text NOT NULL CHECK (status IN ('processing', 'done', 'ignored', 'failed')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- opaque session token의 SHA-256만 저장한다.
CREATE TABLE sessions (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  github_user_id bigint NOT NULL CHECK (github_user_id > 0),
  login text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX sessions_github_user_id_idx ON sessions (github_user_id);

-- OAuth state는 한 번만 소비한다. 브라우저 binding 쿠키 값은 hash로 둔다.
CREATE TABLE oauth_transactions (
  state text PRIMARY KEY CHECK (length(state) BETWEEN 32 AND 128),
  browser_binding_hash bytea NOT NULL CHECK (octet_length(browser_binding_hash) = 32),
  code_verifier text NOT NULL CHECK (length(code_verifier) BETWEEN 43 AND 128),
  return_to text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
