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
- 백엔드 시작 시 `prisma migrate`가 자동으로 수행되지는 않으므로, 최초 1회만 아래 명령을 실행해 스키마를 적용하세요:
  ```powershell
  docker compose exec backend npx prisma migrate deploy
  ```
  (또는 Dockerfile의 CMD 앞에 마이그레이션 단계를 추가할 수 있습니다.)
