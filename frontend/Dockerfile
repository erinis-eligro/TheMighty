# syntax=docker/dockerfile:1
ARG DOCKER_REGISTRY=jfrog.eunbajaeba.com/cpe-docker-virtual
FROM ${DOCKER_REGISTRY}/node:20-alpine AS base

# 1. 빌드
FROM base AS builder
RUN apk add --no-cache libc6-compat openssl ca-certificates python3 make g++ && update-ca-certificates
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci
COPY frontend/ ./
# NEXT_PUBLIC_* 값은 클라이언트 번들에 빌드 시점에 인라인되므로 반드시 build-arg 로 주입한다.
# 브라우저가 접근 가능한 백엔드 주소여야 한다 (컨테이너 호스트명 X).
ARG NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
RUN mkdir -p /app/public
RUN npm run build

# 2. 런타임 (standalone)
FROM base AS runner
RUN apk add --no-cache openssl ca-certificates && update-ca-certificates
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
