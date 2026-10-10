import { MAX_WEBHOOK_BYTES, readLimitedBody } from '@/lib/github/webhook';
import { approvalRuntime, failureResponse, json } from '@/lib/manual-approval/runtime';
import { handleWebhook } from '@/lib/manual-approval/webhook';

/** GitHub 제한(10초)보다 짧게 끝낸다. 내부 deadline은 8초. */
export const maxDuration = 10;

/** GitHub App webhook. 서명 확인 · 처리를 응답 전에 끝낸다. 실패는 DB에 남기고 non-2xx. */
export async function POST(request: Request) {
  try {
    const deps = approvalRuntime(8_000);
    const body = await readLimitedBody(request.body, MAX_WEBHOOK_BYTES);
    if (!body) return json(413, { result: 'rejected' });
    const result = await handleWebhook(deps, {
      event: request.headers.get('x-github-event'),
      deliveryId: request.headers.get('x-github-delivery'),
      signature: request.headers.get('x-hub-signature-256'),
      body,
    });
    return json(result.status, { result: result.result });
  } catch (error) {
    return failureResponse(error);
  }
}
