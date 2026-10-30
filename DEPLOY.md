# Docker Compose로 Mighty 마이티 게임 배포 가이드

## 사전 준비
- Docker 및 Docker Compose 설치 필요
- 포트 3000 (프론트엔드), 3001 (백엔드), 5432 (PostgreSQL, 호스트 `127.0.0.1` 에만 바인딩) 사용 가능해야 함

## 배포 방법

### 1. 프로젝트 루트에서 실행
```powershell
docker compose up -d --build
```

### 2. 서비스 확인
```powershell
docker compose ps
```

### 3. 로그 확인
```powershell
docker compose logs -f
```

### 4. 중지
```powershell
docker compose down
```
컨테이너와 네트워크만 삭제하며 `mighty_pg_data` 볼륨(전적)은 유지됩니다. 다시 `docker compose up -d` 하면 기존 데이터를 그대로 사용합니다.

### 5. DB 데이터까지 초기화 (주의)
```powershell
docker compose down -v
```
`-v` 는 `mighty_pg_data` 볼륨까지 삭제하므로 **전적이 모두 사라집니다.** DB 를 처음 상태로 되돌릴 때만 사용하세요.

## 접속 정보
- 프론트엔드: http://localhost:3000
- 백엔드 API: http://localhost:3001
- PostgreSQL: `127.0.0.1:5432` (기본값 postgres/postgres/mighty) — 로컬 디버깅 전용이며 호스트 loopback 에만 공개됩니다. 다른 PC 에서는 접속할 수 없으므로(필요하면 SSH 터널 사용), 외부에 `5432` 를 열지 마세요. 컨테이너 간 통신은 compose 네트워크의 `postgres:5432` 를 사용합니다.
- 백엔드 헬스체크: `GET /stats/healthcheck` (200 이면 정상, DB 조회를 포함). `docker compose ps` 에서 backend 가 `healthy` 가 되면 프론트엔드가 기동합니다. 첫 기동 시 마이그레이션 때문에 최대 약 1분 걸릴 수 있습니다.

## 파일 구조
- `docker-compose.yml` : 전체 오케스트레이션
- `.dockerignore` : 빌드 컨텍스트에서 제외할 파일 (`node_modules`, `dist`, `.next`, `.git`, `.env*` 등)
- `backend/Dockerfile` : NestJS 백엔드 이미지
- `frontend/Dockerfile` : Next.js 프론트엔드 이미지 (standalone 출력)

## 참고
- PostgreSQL 데이터는 `mighty_pg_data` 볼륨에 영구 저장됩니다.
- 백엔드 컨테이너는 시작 시 `npx prisma migrate deploy` 를 자동 실행하므로, 빈 DB에서도 `docker compose up` 만으로 스키마가 생성됩니다.
- 스키마를 변경하면 `cd backend && npx prisma migrate dev --name <name>` 으로 마이그레이션을 만들어 `backend/prisma/migrations` 에 함께 커밋하세요.

## 환경변수
- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` (postgres, backend): DB 계정/비밀번호/DB 이름. postgres 컨테이너 초기화와 backend 의 `DATABASE_URL`(`postgresql://USER:PASSWORD@postgres:5432/DB?schema=public`)에 함께 쓰입니다. 기본값 `postgres` / `postgres` / `mighty` 라서 `.env` 없이도 로컬에서 동작합니다. **운영/외부 공개 환경에서는 `POSTGRES_PASSWORD` 를 반드시 바꾸세요.** 비밀번호에 `@`, `:`, `/` 같은 URL 예약 문자가 있으면 `DATABASE_URL` 이 깨지므로 피하거나 URL 인코딩이 필요합니다.
  - 주의: postgres 는 **볼륨이 비어 있을 때만** 이 값으로 계정을 만듭니다. 이미 `mighty_pg_data` 볼륨이 있는 상태에서 값을 바꾸면 backend 의 `DATABASE_URL` 과 어긋나 접속에 실패합니다. 이 경우 데이터를 지워도 되면 `docker compose down -v` 후 다시 기동하세요.
  - `DATABASE_URL` 은 이미지에 포함되지 않으며 `docker-compose.yml` 의 backend `environment` 로만 주입됩니다.
- `NEXT_PUBLIC_BACKEND_URL` (frontend, **빌드 인자**): 브라우저가 접근할 수 있는 백엔드 주소 (예: `https://api.example.com`). Next.js 가 클라이언트 번들에 빌드 시점에 인라인하므로 런타임 `environment` 로는 바꿀 수 없고, 변경 시 프론트 이미지를 다시 빌드해야 합니다. 소켓(`/game`)과 전적 REST(`/stats/*`) 모두 이 주소를 사용합니다. 기본값 `http://localhost:3001`. `backend` 같은 컨테이너 호스트명은 브라우저가 해석할 수 없으므로 사용하지 마세요.
- `CORS_ORIGIN` (backend): 허용할 프론트엔드 origin. 쉼표로 여러 개 지정 가능, `*` 는 전체 허용. 기본값 `http://localhost:3000`. **프론트엔드에 접속하는 origin 과 반드시 일치**해야 합니다.
- `NODE_TLS_REJECT_UNAUTHORIZED` (backend, 빌드 인자): 사내 프록시 SSL 오류로 `prisma generate` 가 실패할 때만 `0` 으로 지정합니다. 기본값 `1` (검증 유지).

`NEXT_PUBLIC_BACKEND_URL` 과 `CORS_ORIGIN` 은 함께 맞춰야 합니다. 루트의 `.env` 파일이나 셸 환경변수로 지정하면 `docker-compose.yml` 이 읽어갑니다.

### `.env` 사용법
저장소 루트에 `.env` 파일을 만들면 `docker compose` 가 자동으로 읽습니다. `.env` 는 `.gitignore` / `.dockerignore` 에 포함되어 있어 커밋되거나 이미지에 들어가지 않습니다. **실제 비밀번호를 저장소에 커밋하지 마세요.**

```dotenv
# .env 예시 (값은 반드시 본인 환경에 맞게 바꾸세요)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<강한-비밀번호>
POSTGRES_DB=mighty
NEXT_PUBLIC_BACKEND_URL=http://192.168.0.10:3001
CORS_ORIGIN=http://192.168.0.10:3000
```

`docker compose config` 로 치환된 최종 설정을 확인할 수 있습니다. (비밀번호가 출력되므로 공유에 주의)

```powershell
# 예: 다른 PC/도메인에서 접속하는 경우
$env:NEXT_PUBLIC_BACKEND_URL="http://192.168.0.10:3001"
$env:CORS_ORIGIN="http://192.168.0.10:3000"
docker compose up -d --build
```

## HTTPS 배포 시 주의
- 프론트엔드를 `https://` 로 서비스하면 `NEXT_PUBLIC_BACKEND_URL` 도 반드시 `https://` 여야 합니다. (https 페이지에서 http 백엔드/`ws://` 로 요청하면 브라우저가 mixed content 로 차단합니다.) 소켓은 같은 주소로 `wss://` 로 연결됩니다.
- 리버스 프록시(nginx, Caddy, Traefik 등)는 `/socket.io` 경로의 WebSocket 업그레이드(`Upgrade`/`Connection` 헤더)를 허용해야 합니다. 예: nginx 는 `proxy_http_version 1.1;`, `proxy_set_header Upgrade $http_upgrade;`, `proxy_set_header Connection "upgrade";` 설정이 필요합니다.
- `NEXT_PUBLIC_BACKEND_URL` 은 빌드 인자이므로 값을 바꾸면 프론트엔드 이미지를 다시 빌드해야 합니다. (`docker compose up -d --build frontend`)
- `CORS_ORIGIN` 은 브라우저 주소창의 origin(스킴+호스트+포트, 끝에 `/` 없음)과 정확히 일치해야 합니다. 예: `https://game.example.com`
- 운영에서는 PostgreSQL(5432)과 가능하면 백엔드(3001)를 호스트에 직접 공개하지 말고 프록시를 통해서만 노출하세요.
