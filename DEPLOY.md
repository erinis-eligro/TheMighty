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
- `CORS_ORIGIN` (backend): 허용할 프론트엔드 origin. 쉼표로 여러 개 지정 가능, `*` 는 전체 허용. 기본값 `http://localhost:3000`.
- `NEXT_PUBLIC_BACKEND_URL` (frontend): 백엔드 주소. 소켓은 이 주소의 `/game` 네임스페이스로 연결합니다.
