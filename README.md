# Mighty (마이티)

마이티(Mighty) 카드 게임을 브라우저에서 혼자 즐기는 1인용 싱글 플레이어 웹 게임입니다. 유저 1명(Player 0)과 백엔드 AI 4명(Player 1~4)이 한 판을 진행합니다.

## 주요 특징

- **백엔드 주도(Backend-Authoritative)**: 카드 분배, 턴 검증, 룰 판정, 점수 계산, 상태 전이는 모두 서버에서 수행합니다. 프론트엔드는 서버가 보낸 `state_sync` 를 렌더링하고 유저 액션을 소켓 이벤트로 보내기만 합니다.
- **서버 FSM**: `READY → DEALING → BIDDING → KITTY_EXCHANGE → FRIEND_SELECTION → TRICK_PLAYING → TRICK_RESOLVED → ROUND_SCORING → GAME_OVER` 순서로만 전이합니다.
- **AI 자동 턴**: 차례가 AI이면 서버 스케줄러가 1~1.5초 딜레이 후 자동으로 진행합니다.
- **플레이어별 마스킹된 `state_sync`**: 타인의 손패, 키티(주공 제외), 공개 전 프렌드 정보는 클라이언트로 보내지 않습니다.

## 기술 스택

| 구분 | 스택 |
| --- | --- |
| Backend | NestJS 10, TypeScript, Socket.io, Prisma 5, PostgreSQL |
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, Zustand, Framer Motion |

## 디렉터리 구조

```
backend/                      # NestJS 백엔드 (포트 3001)
  prisma/                     # schema.prisma, migrations
  src/game/core/              # Nest/Socket/Prisma 의존 없는 순수 TS 게임 로직 (+ Jest 단위 테스트)
  src/game/game.gateway.ts    # Socket.io 게이트웨이 (namespace: /game)
  src/game/game.service.ts    # 방 관리, 전적 저장
  src/game/protocol.ts        # 소켓 프로토콜 타입 (frontend/src/types/protocol.ts 로 복사)
frontend/                     # Next.js 프론트엔드 (포트 3000)
  src/app/                    # 라우트 (lobby, game/[roomId])
  src/components/, src/store/ # UI 컴포넌트, Zustand 스토어
  e2e/                        # Playwright E2E 테스트
scripts/compose-smoke.sh      # docker compose 스모크 테스트
.prompt/                      # 요구사항 문서
docker-compose.yml            # postgres + backend + frontend
```

## 실행 방법

### 로컬 개발

사전 준비: Node.js 20, PostgreSQL (아래 예시는 `docker compose up -d postgres` 로 띄운 DB 기준).

```bash
# 1) DB (docker-compose.yml 의 postgres 서비스, 127.0.0.1:5432)
docker compose up -d postgres

# 2) Backend (포트 3001)
cd backend
npm ci
npx prisma generate
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/mighty?schema=public"
npx prisma migrate deploy   # 스키마 적용
npm run start:dev

# 3) Frontend (포트 3000) — 새 터미널에서
cd frontend
npm ci
npm run dev
```

### Docker

```bash
docker compose up -d --build
```

- 프론트엔드: http://localhost:3000 / 백엔드 API: http://localhost:3001
- 백엔드 컨테이너는 시작 시 `prisma migrate deploy` 를 자동 실행합니다.
- 루트의 `.env` 파일 또는 셸 환경변수로 아래 값을 바꿀 수 있습니다. (`.env` 예시 파일은 저장소에 없습니다.)

| 변수 | 대상 | 기본값 / 설명 |
| --- | --- | --- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | postgres, backend | `postgres` / `postgres` / `mighty` |
| `NEXT_PUBLIC_BACKEND_URL` | frontend (빌드 인자) | `http://localhost:3001`. 브라우저가 접근하는 백엔드 주소이며 빌드 시점에 고정됩니다. |
| `CORS_ORIGIN` | backend | `http://localhost:3000`. 프론트엔드 접속 origin 과 일치해야 합니다. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | backend (빌드 인자) | `1`. 사내 프록시 SSL 오류로 `prisma generate` 가 실패할 때만 `0` |
| `AI_TURN_DELAY_MIN_MS` / `AI_TURN_DELAY_MAX_MS` / `TRICK_RESOLVED_DELAY_MS` | backend | 비워두면 기본 지연. E2E/스모크용 |

운영 배포, HTTPS, 리버스 프록시 등 자세한 내용은 [DEPLOY.md](DEPLOY.md) 를 참고하세요.

## 테스트와 CI

```bash
# Backend
cd backend
npm run build      # 타입 오류 확인
npm test           # Jest

# Frontend
cd frontend
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
npm run build
npm run test:e2e   # Playwright E2E
```

`frontend` 의 Playwright E2E 는 DB 가 마이그레이션된 상태(`DATABASE_URL`)에서 백엔드와 빌드된 프론트엔드를 직접 띄웁니다. 이미 떠 있는 스택을 쓰려면 `E2E_BASE_URL` 을 지정합니다. (`frontend/playwright.config.ts` 참고)

`.gitlab-ci.yml` 은 MR 및 기본 브랜치 파이프라인에서 다음 job 을 실행합니다.

| job | 내용 |
| --- | --- |
| `backend-test` | `npm run build` + Jest |
| `frontend-check` | typecheck + lint + build |
| `protocol-sync` | `backend/src/game/protocol.ts` 와 `frontend/src/types/protocol.ts` 동일성 검사 |
| `prisma-check` | `prisma validate` + 마이그레이션 누락 검사 |

`frontend-e2e`(Playwright)는 수동 실행/스케줄(야간) 전용입니다.

## 게임 룰 요약

- 53장(52장 + 조커)을 5명에게 10장씩 나누고 3장은 키티(바닥패)로 둡니다.
- 비딩(13~20점, 기루다 또는 노기루다)으로 주공이 정해지고, 주공은 키티 3장을 교환한 뒤 프렌드를 선언합니다.
- 10번의 트릭을 진행하며, 주공팀이 획득한 점수 카드 수가 비딩 점수 이상이면 주공팀이 승리합니다.
- 마이티, 조커, 조커콜, 프렌드 조건 등 세부 룰과 확정 규칙은 [AGENTS.md](AGENTS.md) 를 참고하세요.

## 전적

전적은 **닉네임 기준이며 인증이 없습니다.** 같은 닉네임을 쓰면 누구든 같은 전적을 조회/누적할 수 있습니다. (1인용 캐주얼 게임이라 계정 시스템을 두지 않으며, 세션은 rejoin token 으로만 보호합니다.)

## 개발 문서

- [AGENTS.md](AGENTS.md): 핵심 원칙, 코딩 컨벤션, 룰, 작업 방식
- [DEPLOY.md](DEPLOY.md): Docker Compose 배포 가이드

## 버전

버전은 이 문서에 적지 않습니다. `frontend/package.json`, `backend/package.json` 의 `version` 과 git 태그 / GitLab Releases 에서 확인하세요. 버전은 SemVer `0.x.y` 방침을 따릅니다. ([#36](https://cpeteam.duckdns.org/cpe-team/eligro/themighty/-/work_items/36))

## 제작자

erinis eligro

© erinis eligro
