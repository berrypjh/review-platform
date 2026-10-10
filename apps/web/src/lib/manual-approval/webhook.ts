import { revokeUserSessions } from '../auth/store.ts';
import { getPullRequest } from '../github/pulls.ts';
import {
  classifyWebhook,
  MAX_WEBHOOK_BYTES,
  verifyWebhookSignature,
  type WebhookEvent,
} from '../github/webhook.ts';
import { beginDelivery, type DeliveryHeader, finishDelivery } from './deliveries.ts';
import {
  applyObservation,
  blockRepositories,
  releaseClaim,
  setInstallationBlocked,
} from './repository.ts';
import { acquireClaim, type ApprovalDeps, syncPullRequest } from './sync.ts';

export type WebhookRequest = {
  event: string | null;
  deliveryId: string | null;
  signature: string | null;
  body: Uint8Array;
};

export type WebhookResponse = {
  status: number;
  result: 'processed' | 'ignored' | 'duplicate' | 'in-progress' | 'failed' | 'rejected';
};

/** 이전 시도가 이 시간 넘게 `processing`이면 버려진 것으로 보고 다시 처리한다. webhook deadline보다 길다. */
const STALE_DELIVERY_MS = 60_000;

/**
 * webhook 하나를 응답 전에 끝까지 처리한다. 응답 뒤에 남겨 두는 작업은 없다.
 * 실패 · 미확인은 delivery `failed`와 sync 상태로 DB에 남기고 503 — GitHub Redeliver나 재동기화로 복구한다.
 */
export async function handleWebhook(
  deps: ApprovalDeps,
  request: WebhookRequest,
): Promise<WebhookResponse> {
  if (request.body.byteLength > MAX_WEBHOOK_BYTES) return { status: 413, result: 'rejected' };
  const config = deps.github.config;
  if (!verifyWebhookSignature(config.webhookSecret, request.body, request.signature)) {
    return { status: 401, result: 'rejected' };
  }
  if (!request.event || !request.deliveryId) return { status: 400, result: 'rejected' };
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(request.body));
  } catch {
    return { status: 400, result: 'rejected' };
  }
  const event = classifyWebhook(request.event, payload);
  if (!event) return { status: 400, result: 'rejected' };

  const start = await beginDelivery(
    deps.sql,
    deliveryHeader(request.deliveryId, request.event, event, payload),
    STALE_DELIVERY_MS,
  );
  if (start.kind === 'duplicate') return { status: 200, result: 'duplicate' };
  if (start.kind === 'in-progress') return { status: 503, result: 'in-progress' };
  try {
    const result = await dispatch(deps, event);
    await finishDelivery(deps.sql, request.deliveryId, start.attempt, {
      status: result === 'ignored' ? 'ignored' : 'done',
    });
    return { status: 200, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed';
    await finishDelivery(deps.sql, request.deliveryId, start.attempt, {
      status: 'failed',
      error: message,
    });
    return { status: 503, result: 'failed' };
  }
}

function deliveryHeader(
  deliveryId: string,
  eventName: string,
  event: WebhookEvent,
  payload: unknown,
): DeliveryHeader {
  const action =
    typeof payload === 'object' && payload !== null && 'action' in payload ? payload.action : null;
  return {
    deliveryId,
    event: eventName,
    action: typeof action === 'string' ? action : null,
    repositoryId: event.kind === 'pull-request' ? event.repository.repositoryId : null,
    installationId: 'installationId' in event ? event.installationId : null,
    pullNumber: event.kind === 'pull-request' ? event.number : null,
  };
}

async function dispatch(deps: ApprovalDeps, event: WebhookEvent): Promise<'processed' | 'ignored'> {
  const config = deps.github.config;
  if ('installationId' in event && event.installationId !== config.installationId) return 'ignored';
  switch (event.kind) {
    case 'ignored':
      return 'ignored';
    case 'installation': {
      const reason =
        event.action === 'deleted'
          ? 'installation-deleted'
          : event.action === 'suspend'
            ? 'installation-suspended'
            : null;
      await setInstallationBlocked(deps.sql, event.installationId, reason);
      return 'processed';
    }
    case 'repositories-removed':
      await blockRepositories(deps.sql, event.repositoryIds);
      return 'processed';
    case 'authorization-revoked':
      await revokeUserSessions(deps.sql, event.githubUserId);
      return 'processed';
    case 'pull-request':
      if (!config.allowedRepositoryIds.has(event.repository.repositoryId)) return 'ignored';
      await observeAndSync(deps, event.repository, event.number);
      return 'processed';
  }
}

/** claim을 잡은 뒤 GitHub에서 PR을 다시 읽어 반영하고 commit status를 맞춘다. 하나라도 반영되지 않으면 던진다. */
async function observeAndSync(
  deps: ApprovalDeps,
  repository: { repositoryId: number; owner: string; name: string },
  number: number,
): Promise<void> {
  const key = { repositoryId: repository.repositoryId, number };
  const claim = await acquireClaim(deps.sql, key, 2_000);
  if (!claim)
    throw new Error(`PR ${key.repositoryId}#${number} is being processed by another worker`);
  try {
    await applyObservation(deps.sql, claim, await getPullRequest(deps.github, repository, number));
    if (!(await syncPullRequest(deps, claim))) {
      throw new Error(`PR ${key.repositoryId}#${number} is not fully synced to GitHub`);
    }
  } finally {
    await releaseClaim(deps.sql, claim);
  }
}
