# 수동 승인 DB로 Neon 무료 플랜 선정

수동 승인 DB는 Neon 무료 플랜. 현재 접속 코드를 바꾸지 않고 쓸 수 있고, 유휴 뒤에도 요청이 오면 compute가 다시 켜짐.

## 상황

- 승인 상태는 전용 PostgreSQL에만 둠. 앱은 Vercel 서버리스 함수
- 접속 조건(`apps/web/src/lib/db/config.ts`)
  - localhost가 아니면 TLS `verify-full`. CA 인증서를 지정하는 옵션 없음 → 서버 인증서가 Node 기본 CA로 검증돼야 함
  - `prepare: false`, 인스턴스당 연결 최대 3 → transaction pooler 사용 가능
- GitHub은 실패한 webhook을 자동 재전송하지 않음. DB가 응답하지 않는 동안 온 PR 이벤트는 운영자가 복구해야 함
- 사용량 — PR 이벤트 · 승인 시에만 짧은 쿼리. 데이터는 PR · revision · 세션 · delivery 기록

## 판단

| 후보            | 무료 플랜                                                 | 결과                                                                              |
| --------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Neon            | 0.5 GB · 월 100 CU-hour. 유휴 시 자동 정지 · 요청 시 재개 | 선정                                                                              |
| Supabase        | 500 MB. 약 1주 미사용 시 일시정지 · 수동 복구             | 제외 — 정지 중 webhook 실패                                                       |
| Aiven           | 5 GB 단일 노드. 미사용 시 꺼짐                            | 제외 — 꺼진 동안 webhook 실패                                                     |
| Prisma Postgres | 500 MB · 월 10만 operation                                | 제외 — ORM operation 단위 과금. 이 앱은 `postgres` 드라이버 직접 사용             |
| Railway         | 1회 체험 크레딧                                           | 제외 — 지속 무료 아님                                                             |
| PlanetScale     | 없음(월 약 $5부터)                                        | 제외 — 유료                                                                       |
| Cloud SQL       | 없음(`db-f1-micro` 월 약 $8~12, compute만)                | 제외 — 유료. 자체 CA 인증서 · Vercel 출발 IP 비고정으로 코드 · 네트워크 변경 필요 |

- 가격 · 한도는 2026-10 기준 제3자 비교 자료와 [Neon pricing](https://neon.com/pricing)

## 반영

- `docs/manual-approval/setup.md` §1 — DB를 Neon으로 명시
- 코드 변경 없음

## 검증

- 실제 Neon 접속 · migration은 미실행
