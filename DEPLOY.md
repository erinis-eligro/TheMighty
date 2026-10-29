# Docker Compose로 Mighty 마이티 게임 배포 가이드

## 사전 준비
- Docker 및 Docker Compose 설치 필요
- 포트 3000 (프론트엔드), 3001 (백엔드), 5432 (PostgreSQL) 사용 가능해야 함

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

### 4. 중지 및 삭제
```powershell
docker compose down -v
```

## 접속 정보
- 프론트엔드: http://localhost:3000
- 백엔드 API: http://localhost:3001
- PostgreSQL: localhost:5432 (postgres/postgres/mighty)

## 파일 구조
- `docker-compose.yml` : 전체 오케스트레이션
- `backend/Dockerfile` : NestJS 백엔드 이미지
- `frontend/Dockerfile` : Next.js 프론트엔드 이미지 (standalone 출력)

## 참고
- PostgreSQL 데이터는 `mighty_pg_data` 볼륨에 영구 저장됩니다.
- 백엔드 컨테이너는 시작 시 `npx prisma migrate deploy` 를 자동 실행하므로, 빈 DB에서도 `docker compose up` 만으로 스키마가 생성됩니다.
- 스키마를 변경하면 `cd backend && npx prisma migrate dev --name <name>` 으로 마이그레이션을 만들어 `backend/prisma/migrations` 에 함께 커밋하세요.

## 환경변수
- `NEXT_PUBLIC_BACKEND_URL` (frontend, **빌드 인자**): 브라우저가 접근할 수 있는 백엔드 주소 (예: `https://api.example.com`). Next.js 가 클라이언트 번들에 빌드 시점에 인라인하므로 런타임 `environment` 로는 바꿀 수 없고, 변경 시 프론트 이미지를 다시 빌드해야 합니다. 소켓(`/game`)과 전적 REST(`/stats/*`) 모두 이 주소를 사용합니다. 기본값 `http://localhost:3001`. `backend` 같은 컨테이너 호스트명은 브라우저가 해석할 수 없으므로 사용하지 마세요.
- `CORS_ORIGIN` (backend): 허용할 프론트엔드 origin. 쉼표로 여러 개 지정 가능, `*` 는 전체 허용. 기본값 `http://localhost:3000`. **프론트엔드에 접속하는 origin 과 반드시 일치**해야 합니다.
- `NODE_TLS_REJECT_UNAUTHORIZED` (backend, 빌드 인자): 사내 프록시 SSL 오류로 `prisma generate` 가 실패할 때만 `0` 으로 지정합니다. 기본값 `1` (검증 유지).

`NEXT_PUBLIC_BACKEND_URL` 과 `CORS_ORIGIN` 은 함께 맞춰야 합니다. 루트의 `.env` 파일이나 셸 환경변수로 지정하면 `docker-compose.yml` 이 읽어갑니다.

```powershell
# 예: 다른 PC/도메인에서 접속하는 경우
$env:NEXT_PUBLIC_BACKEND_URL="http://192.168.0.10:3001"
$env:CORS_ORIGIN="http://192.168.0.10:3000"
docker compose up -d --build
```
