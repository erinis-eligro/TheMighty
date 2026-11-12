# syntax=docker/dockerfile:1
ARG DOCKER_REGISTRY=jfrog.eunbajaeba.com/cpe-docker-virtual
FROM ${DOCKER_REGISTRY}/node:20-alpine AS base

# 1. 소스 빌드 & Prisma 바이너리 생성
FROM base AS builder
RUN apk add --no-cache libc6-compat openssl ca-certificates python3 make g++ && update-ca-certificates
WORKDIR /app
COPY backend/package.json backend/package-lock.json* backend/.npmrc* ./
RUN npm ci
COPY backend/prisma ./prisma
ENV PRISMA_CLI_BINARY_FETCH=true

# 사내 프록시 SSL 검증 오류가 있을 때만 `--build-arg NODE_TLS_REJECT_UNAUTHORIZED=0` 으로 우회한다. (기본: 검증 유지)
ARG NODE_TLS_REJECT_UNAUTHORIZED=1
RUN NODE_TLS_REJECT_UNAUTHORIZED=${NODE_TLS_REJECT_UNAUTHORIZED} npx prisma generate

COPY backend/ ./
RUN npm run build

# 2. 실제 컨테이너 구동 런타임 이미지
FROM base AS runner
RUN apk add --no-cache openssl ca-certificates && update-ca-certificates
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

# ★ 필수: npm run start:prod 가 읽을 수 있도록 package.json 복사
COPY --from=builder /app/package.json ./package.json

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

USER nestjs

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:prod"]