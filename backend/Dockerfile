# syntax=docker/dockerfile:1
FROM node:20-alpine AS base

# 1. 의존성 설치 (캐시 레이어 분리용)
FROM base AS deps
RUN apk add --no-cache libc6-compat openssl ca-certificates && update-ca-certificates
WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev

# 2. 소스 빌드 & Prisma 바이너리 생성
FROM base AS builder
RUN apk add --no-cache libc6-compat openssl ca-certificates python3 make g++ && update-ca-certificates
WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci
COPY backend/prisma ./prisma
ENV PRISMA_CLI_BINARY_FETCH=true

# 사내 프록시 SSL 검증 오류 우회
RUN NODE_TLS_REJECT_UNAUTHORIZED=0 npx prisma generate

COPY backend/ ./
RUN npm run build

# 3. 실제 컨테이너 구동 런타임 이미지
FROM base AS runner
RUN apk add --no-cache openssl ca-certificates && update-ca-certificates
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_URL="postgresql://postgres:postgres@postgres:5432/mighty?schema=public"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

# ★ 필수: npm run start:prod 가 읽을 수 있도록 package.json 복사
COPY --from=builder /app/package.json ./package.json

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.env ./.env
COPY --from=builder /app/prisma ./prisma

USER nestjs

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:prod"]