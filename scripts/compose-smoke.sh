#!/usr/bin/env bash
# docker compose 스모크: 마이그레이션 자동 적용 → /stats 응답 → (브라우저 E2E 로) 한 판 완주 → GameHistory 저장 확인.
#   scripts/compose-smoke.sh            # 스택을 빌드/기동하고, 끝나면 내린다 (볼륨 포함)
#   KEEP_STACK=1 scripts/compose-smoke.sh   # 끝나도 스택을 유지한다
# 이미 떠 있는 스택을 검사만 하려면 SKIP_UP=1 (이때도 postgres 컨테이너 이름 mighty-postgres 가 필요하다).
set -euo pipefail
cd "$(dirname "$0")/.."

BACKEND_URL="${E2E_BACKEND_URL:-http://localhost:3001}"
FRONTEND_URL="${E2E_BASE_URL:-http://localhost:3000}"
PSQL=(docker exec mighty-postgres psql -U postgres -d mighty -tA -c)

cleanup() {
  if [ -z "${KEEP_STACK:-}" ] && [ -z "${SKIP_UP:-}" ]; then docker compose down -v; fi
}
trap cleanup EXIT

if [ -z "${SKIP_UP:-}" ]; then
  # 게임이 몇 초 만에 끝나도록 지연을 줄인다 (백엔드 컨테이너 환경변수로 전달된다).
  AI_TURN_DELAY_MIN_MS="${AI_TURN_DELAY_MIN_MS:-50}" \
  AI_TURN_DELAY_MAX_MS="${AI_TURN_DELAY_MAX_MS:-120}" \
  TRICK_RESOLVED_DELAY_MS="${TRICK_RESOLVED_DELAY_MS:-150}" \
    docker compose up -d --build
fi

echo "== waiting for the backend"
for _ in $(seq 1 60); do
  curl -fsS "$BACKEND_URL/stats/smoke-probe" >/dev/null 2>&1 && break
  sleep 2
done

echo "== migrations were applied by the container (prisma migrate deploy)"
applied=$("${PSQL[@]}" "select count(*) from _prisma_migrations where finished_at is not null")
[ "$applied" -ge 1 ] || { echo "no migration applied"; exit 1; }

echo "== GET /stats/:username"
stats=$(curl -fsS "$BACKEND_URL/stats/smoke-probe")
echo "$stats"
echo "$stats" | grep -q '"totalGames":0' || { echo "unexpected stats payload"; exit 1; }

echo "== one full game through the browser (Playwright)"
before=$("${PSQL[@]}" 'select count(*) from "GameHistory"')
(cd frontend && E2E_BASE_URL="$FRONTEND_URL" E2E_BACKEND_URL="$BACKEND_URL" npx playwright test --project=desktop)
after=$("${PSQL[@]}" 'select count(*) from "GameHistory"')
[ "$after" -gt "$before" ] || { echo "no GameHistory row was saved ($before -> $after)"; exit 1; }

echo "smoke OK: GameHistory $before -> $after"
