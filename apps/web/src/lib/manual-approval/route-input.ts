import type { MutationGuard } from '../auth/session.ts';
import { json } from './runtime.ts';

/** mutation guard 실패를 응답으로. 인증이 없으면 401, Origin · CSRF가 틀리면 403. */
export function guardFailure(kind: Exclude<MutationGuard['kind'], 'ok'>): Response {
  return json(kind === 'unauthenticated' ? 401 : 403, { error: kind });
}

/** form 값 하나. 파일이나 없는 값은 null. */
export function formText(form: FormData | null, name: string): string | null {
  const value = form?.get(name);
  return typeof value === 'string' ? value : null;
}
