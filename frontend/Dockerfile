# syntax=docker/dockerfile:1
FROM node:20-alpine AS base

# 1. 의존성 설치
FROM base AS deps
RUN apk add --no-cache libc6-compat openssl ca-certificates && update-ca-certificates
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --omit=dev

# 2. 빌드
FROM base AS builder
RUN apk add --no-cache libc6-compat openssl ca-certificates python3 make g++ && update-ca-certificates
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN mkdir -p /app/public
RUN npm run build

# 3. 런타임 (standalone)
FROM base AS runner
RUN apk add --no-cache openssl ca-certificates && update-ca-certificates
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_PUBLIC_BACKEND_URL=http://backend:3001

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
