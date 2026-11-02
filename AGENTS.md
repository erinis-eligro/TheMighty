# AGENTS.md

마이티(Mighty) 1인용 싱글 플레이어 웹 게임. 유저 1명(Player 0) + 백엔드 AI 4명(Player 1~4).
상세 요구사항은 `.prompt/instructure.prompt`, `.prompt/instructure-detail.prompt` 를 반드시 먼저 읽는다.
작업 항목은 GitLab work item(Issue)으로 관리하며, 각 이슈의 "현황 / 작업 / 의존" 섹션을 따른다.

## 핵심 원칙 (절대 어기지 말 것)

1. **백엔드 주도(Backend-Authoritative)**: 카드 분배, 턴 검증, 룰 판정, 점수 계산, 상태 전이는 모두 백엔드에서만 수행한다. 프론트엔드는 서버가 보낸 `state_sync` 를 렌더링하고 유저 액션을 소켓 이벤트로 보내는 역할만 한다. 프론트에서 게임 상태를 임의로 변경하지 않는다.
2. **FSM 준수**: 게임은 다음 순서로만 전이한다.
   `READY → DEALING → BIDDING → KITTY_EXCHANGE → FRIEND_SELECTION → TRICK_PLAYING → TRICK_RESOLVED → ROUND_SCORING → GAME_OVER`
   phase 변경은 엔진(`GameEngine`) 내부에서만 하고, gateway/service 가 `state.phase` 를 직접 대입하지 않는다.
3. **Auto Turn Driver**: 현재 차례가 AI이면 클라이언트 입력을 기다리지 않고 서버 `setTimeout` 스케줄러가 1~1.5초 딜레이 후 자동으로 진행한다. 게임 종료/방 삭제 시 타이머를 반드시 정리한다.
4. **숨겨야 할 정보 비노출**: 타인의 손패, 키티(주공 제외), 공개 전 프렌드 정보를 클라이언트로 보내지 않는다. 모든 broadcast 는 플레이어별로 마스킹된 state 한 경로로만 보낸다.
5. **신원은 서버가 결정**: 클라이언트가 보낸 `playerId` 를 그대로 신뢰하지 않는다. 소켓과 playerId 의 매핑을 서버가 검증한다.
6. **오류 노출 최소화**: 엔진의 규칙 위반은 `GameRuleError`(`core/errors.ts`)로 던지고, `GameWsExceptionFilter` 는 이것만 메시지를 그대로 클라이언트에 보낸다. 그 외 예외는 `INTERNAL_ERROR` 로 마스킹하고 원문은 서버 로그에만 남긴다. 소켓 payload 는 DTO + `ValidationPipe` 로 검증한다.

> 전적은 의도적으로 **닉네임 기준이며 인증이 없다**. 같은 닉네임을 쓰면 누구든 같은 전적을 조회/누적할 수 있다(1인용 캐주얼 게임이라 계정 시스템을 두지 않는다). 세션은 rejoin token 으로만 보호한다.
> 세션 자원: 전체 세션 수는 `MAX_SESSIONS`(기본 200) 로 제한하고, 끝난 게임의 세션은 `FINISHED_SESSION_TTL_MS`(5분) 후 정리한다.

## 기술 스택 및 구조

- Backend: NestJS 10 + TypeScript + Socket.io + Prisma 5 + PostgreSQL (`backend/`)
- Frontend: Next.js 14 (App Router) + TypeScript + Tailwind CSS + Zustand + Framer Motion (`frontend/`)

```
backend/
  prisma/schema.prisma        # User, GameHistory
  src/game/core/              # 순수 TS 게임 로직 (deck, deal, rules, bidding, trick, score, ai, game-engine)
  src/game/game.gateway.ts    # Socket.io 게이트웨이 (namespace: /game)
  src/game/game.service.ts    # 방 관리, 전적 저장
  src/game/constants.ts       # GAME_EVENTS 등 상수
  src/game/entities, dto/
frontend/src/
  app/                        # 라우트 (lobby, game/[roomId])
  components/                 # Card, PlayerArea, TrickBoard, UserHand, Lobby ...
  store/useGameStore.ts       # Zustand 스토어
```

- 게임 룰 로직은 `backend/src/game/core/` 안에 **Nest/Socket/Prisma 의존 없는 순수 함수/클래스**로 둔다. 테스트 가능성을 위해 이 원칙을 유지한다.
- 소켓 이벤트 이름은 `backend/src/game/constants.ts` 의 `GAME_EVENTS` 에 추가하고 문자열 리터럴을 직접 쓰지 않는다. (프론트는 현재 리터럴을 쓰고 있으므로 수정 시 가능하면 상수로 맞춘다.)

## 게임 룰 요약

- 덱: 52장 + 조커 1장 = 53장. 5명에게 10장씩, 바닥패(키티) 3장.
- 카드 강도: 2 < 3 < ... < 10 < J < Q < K < A (A 가 가장 강함). 점수 카드는 10, J, Q, K, A (총 20장, 각 1점).
- 마이티: 기본 ♠A. 기루다가 ♠ 이면 ♦A. (노기루다는 ♠A)
- 조커콜: 기본 ♣3. 기루다가 ♣ 이면 ♠3. (노기루다는 ♣3) 조커콜이 선언된 트릭에서는 조커가 무력화된다. 조커콜 카드를 가진 사람은 그 트릭에서 해당 카드를 반드시 내야 한다.
- 조커: 첫 트릭과 마지막 트릭에는 일반적인 효력을 발휘할 수 없다.
- 비딩: 13~20점, 기루다(♠ ◆ ♥ ♣) 또는 노기루다 선언. 패스 가능. 최고 점수가 주공.
- 키티 교환: 주공이 바닥패 3장을 가져온 뒤 3장을 버리고 기루다를 최종 확정.
- 프렌드: 주공이 조건(마이티 / 특정 카드 / 초구 / 노프렌드)으로 선언. 정체는 공개 전까지 숨긴다.
- 트릭: 선이 낸 무늬(리드 수트)가 손에 있으면 반드시 따라야 한다. 없으면 다른 무늬나 기루다를 낼 수 있다. 매 카드마다 서버가 합법성을 검증한다.
- 승패: 주공팀이 획득한 점수 카드 수가 비딩 점수 이상이면 주공팀 승리.

### 기획서에 없는 확정 규칙 (현행 동작 유지로 결정)

- 첫 트릭 기루다 선공 금지: 주공은 첫 트릭에서 기루다로 선공할 수 없다. 기루다 외의 카드(조커 제외)가 손에 없으면 허용. 노기루다에는 적용하지 않는다. (`restrictsGirudaLead`, `validatePlay`)
- 키티 교환 시 기루다 변경: 변경하려면 비딩 점수를 최소 +2(`GIRUDA_CHANGE_RAISE`) 올려야 하며 최대 20. 기루다를 유지하면 점수는 바뀌지 않는다.
- 버린 키티의 점수 카드는 주공팀(여당) 점수에 포함한다(`RoundResult.kittyPoints`, `teamPoints` 에 이미 합산됨; 조커는 점수 카드가 아니다). 따라서 여당 + 야당 점수 합계는 항상 20.
- 비딩 순서: 항상 Player 0(사람)이 첫 비딩자이며 라운드/재분배 시에도 회전하지 않는다. 앞의 네 명이 모두 패스하면 마지막 좌석이 비딩/패스를 선택하고, 전원이 패스하면 재분배한다.
- 승패/전적: 승패만 판정한다(노기루다/노프렌드/런 등 점수 배수·정산 없음). DB 에는 `is_win`, `bid_score`, `team_points` 만 저장한다.

## 개발 명령어

```bash
# Backend
cd backend
npm ci
npx prisma generate
npm run build          # 타입 오류 확인 (nest build)
npm run start:dev      # 개발 서버 (포트 3001, DATABASE_URL 필요)

# Frontend
cd frontend
npm ci
npm run typecheck      # tsc --noEmit
npm run lint           # next lint
npm run build

# 전체 (Docker)
docker compose up -d --build
```

- 로컬 DB 접속 문자열: `postgresql://postgres:postgres@localhost:5432/mighty?schema=public` (`docker-compose.yml` 의 postgres 서비스 기준).
- 변경 후 최소한 `backend` 는 `npm run build`, `frontend` 는 `npm run typecheck` 가 통과해야 한다.
- 백엔드는 Jest(`npm test`), 프론트는 Playwright E2E 가 있다. 게임 로직(`core/`)을 수정하면 Jest 단위 테스트를 함께 추가한다.
- `.gitlab-ci.yml` 은 MR/기본 브랜치 파이프라인에서 `backend-test`(build + jest), `frontend-check`(typecheck + lint + build), `protocol-sync`(`backend/src/game/protocol.ts` 와 `frontend/src/types/protocol.ts` 동일성), `prisma-check`(`prisma validate` + migration 누락 검사)를 실행한다. `frontend-e2e` 는 수동/야간 전용이다. `sonarqube-check`(SonarQube SAST)는 `SONAR_HOST_URL`/`SONAR_TOKEN` CI 변수가 있을 때만 `main` 대상 MR 파이프라인과 `main` 푸시 파이프라인에서 실행되며 `allow_failure: true` 이다(설정은 `sonar-project.properties`).
- CI 이미지는 Dockerfile 과 같은 Node 20 이다. 버전을 바꿀 때는 `.gitlab-ci.yml` 과 두 Dockerfile 을 함께 맞춘다.
- `backend/src/game/protocol.ts` 를 수정하면 `frontend/src/types/protocol.ts` 에 그대로 복사한다. (`protocol-sync` 가 검사)
- `frontend` 의 `npm run lint` 는 `.eslintrc.json`(`next/core-web-vitals`)을 사용하며 경고 없이 통과해야 한다.
- `backend` 의 `npm run lint`, `npm run format` 은 `--fix`/`--write` 로 파일을 수정한다. 의도하지 않은 대량 포맷 변경이 생기지 않게 변경한 파일에만 적용한다.

## 코딩 컨벤션

- TypeScript strict 지향. `any` 사용은 최소화하고 새 코드에는 쓰지 않는다. 기존 코드의 `as any` 를 건드릴 때는 가능하면 타입을 정리한다.
- 기존 코드 스타일을 따른다: 작은 순수 함수, 명시적 에러 reason 문자열(`'must_follow_lead_suit'` 등) 반환.
- 룰 검증 실패는 `{ valid: false, reason }` 형태로 반환하고, gateway 에서 `game_error` 이벤트(또는 ack 의 error)로 클라이언트에 전달한다.
- 백엔드 enum/타입 변경 시 `frontend/src/store/useGameStore.ts` 의 타입도 함께 수정한다. (무늬는 백엔드/Prisma 모두 `CLUB` 을 사용하며, 명세 문서의 `CLOVER` 와 다르므로 `CLUB` 으로 통일한다.)
- UI 는 밝은 파스텔톤의 캐주얼 보드게임 스타일, 둥근 모서리(rounded). 어두운 카지노 느낌은 피한다. 색상은 하드코딩 hex 대신 가능하면 `tailwind.config.js` 토큰을 사용한다.
- 반응형: PC 는 중앙 트릭 보드 + 하단 유저 덱, 모바일은 세로 화면 기준으로 상단 AI 4명 + 하단 손패(부채꼴/스와이프).
- 턴 순서는 화면 기준 시계 방향이다. 좌석 배정 순서(`SEAT_POSITIONS`)가 `bottom → left → top → center(우상단) → right` 이며 인덱스 순서(= 턴/비딩 순서)와 같다. 모바일 상단 AI 가로 배열도 왼쪽에서 오른쪽이 턴 순서다.
- 프론트 컴포넌트는 `useGameStore(s => s.xxx)` 형태의 selector 로 구독한다. 렌더 중 `useGameStore.getState()` 를 호출하지 않는다.
- 불필요한 문서 파일이나 요약 파일을 추가하지 않는다.

## 작업 방식

- 한 MR 에는 하나의 work item 만 다룬다. MR 설명에 `Closes #<iid>` 를 넣는다.
- 이슈의 "의존" 항목에 선행 작업이 있으면, 해당 작업이 `develop` 에 반영되었는지 먼저 확인한다. 반영되지 않았다면 필요한 최소 범위만 구현하고 MR 설명에 명시한다.
- 이슈에 적힌 "현황"은 작성 시점의 코드 기준이다. 구현 전에 실제 코드를 다시 읽고 달라졌으면 코드를 기준으로 판단한다.
- 커밋 메시지는 `type: 설명` 형식 (`feat`, `fix`, `refactor`, `chore`, `test`, `docs`).
- 기본 브랜치는 `main` 이다.

## 주의

- `docker-compose.yml` 의 DB 계정(`postgres/postgres`)은 로컬 개발용이다. 운영 비밀 값을 저장소에 커밋하지 않는다.
- Prisma 스키마를 수정하면 `prisma/migrations` 에 마이그레이션 파일을 함께 커밋한다.
