'use client';

import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type RefObject, useRef, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';

export type ActionOutcome = { tone: 'success' | 'info' | 'error'; message: string };

export type PostResult = { status: number; body: Record<string, unknown> };

/** 같은 origin의 API에 form을 POST한다. 브라우저가 Origin · 세션 cookie를 붙인다. 네트워크 실패는 status 0. */
export async function postForm(url: string, fields: Record<string, string>): Promise<PostResult> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      body: new URLSearchParams(fields),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, body };
  } catch {
    return { status: 0, body: {} };
  }
}

/**
 * 버튼 하나의 요청 상태. 진행 중이면 다시 실행하지 않는다 — state는 다음 render 전까지 두 번째 클릭에 보이지 않으므로
 * ref로 막는다(서버의 claim · 멱등성과 함께). 끝나면 서버 컴포넌트를 다시 읽고 결과 메시지로 focus를 옮긴다.
 */
export function useAction() {
  const router = useRouter();
  const inFlight = useRef(false);
  const messageRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);

  async function run(action: (progress: (message: string) => void) => Promise<ActionOutcome>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setOutcome(null);
    const result = await action((message) => setOutcome({ tone: 'info', message }));
    setOutcome(result);
    setPending(false);
    inFlight.current = false;
    router.refresh();
    requestAnimationFrame(() => messageRef.current?.focus());
  }

  return { run, pending, outcome, messageRef };
}

const ICONS = { success: CircleCheck, info: Info, error: CircleAlert };

function OutcomeAlert({ outcome }: { outcome: ActionOutcome }) {
  const Icon = ICONS[outcome.tone];
  // live region 역할은 감싼 `status` · `alert`가 맡는다. shadcn Alert의 role="alert"가 겹치지 않게 지운다.
  return (
    <Alert role="none" variant={outcome.tone === 'error' ? 'destructive' : 'default'}>
      <Icon aria-hidden="true" />
      <AlertDescription className="break-words">{outcome.message}</AlertDescription>
    </Alert>
  );
}

/**
 * 결과 안내. 진행 · 성공은 `role="status"`, 오류는 `role="alert"` — 두 live region을 처음부터 DOM에 둔다
 * (role을 바꾸면 읽어 주지 않는 스크린리더가 있다). 감싼 요소가 focus를 받아 버튼이 사라져도 focus를 잃지 않는다.
 */
export function ActionMessage({
  outcome,
  messageRef,
}: {
  outcome: ActionOutcome | null;
  messageRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={messageRef} tabIndex={-1} className="outline-none">
      <div role="status">
        {outcome && outcome.tone !== 'error' && <OutcomeAlert outcome={outcome} />}
      </div>
      <div role="alert">{outcome?.tone === 'error' && <OutcomeAlert outcome={outcome} />}</div>
    </div>
  );
}
