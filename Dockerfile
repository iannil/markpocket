# syntax=docker/dockerfile:1

# ── Stage 1: builder — full install (incl. devDependencies) + next build ──
FROM node:26-alpine AS builder
RUN apk add --no-cache libc6-compat && corepack enable
WORKDIR /app

# Deps layer (cached): lockfile + every workspace package.json first.
# Copying ALL package.jsons matters: pnpm install links workspace packages,
# and missing manifests leave dangling symlinks that poison the cache layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/plugin-sdk/package.json packages/plugin-sdk/
COPY packages/plugin-csv/package.json packages/plugin-csv/
COPY packages/plugin-storage-local/package.json packages/plugin-storage-local/
RUN pnpm install --frozen-lockfile

# Source + build
COPY . .
# Build-time env is scoped to this RUN only: module evaluation of db/auth
# needs DATABASE_URL/BETTER_AUTH_URL present, but no placeholder may leak
# into the runtime image — the server refuses to start without a real secret
# (see src/server.ts).
RUN DATABASE_URL=postgresql://placeholder:placeholder@placeholder:5432/placeholder \
    BETTER_AUTH_URL=http://localhost:3000 \
    NEXT_TELEMETRY_DISABLED=1 \
    pnpm --filter @markpocket/web build

# ── Stage 2: runner — production dependencies only, no devDependencies ──
FROM node:26-alpine AS runner
# libc6-compat: Next's native bindings need glibc compat on musl. No wget
# package: alpine's busybox wget covers the HEALTHCHECK below (plain HTTP on
# loopback). corepack is enabled for the pnpm install layer ONLY — the runtime
# never invokes pnpm (CMD goes through ./node_modules/.bin/tsx) — but the
# shims must exist when the install RUN executes.
RUN apk add --no-cache libc6-compat && corepack enable
WORKDIR /app

# Prod-only install from the same manifests (tsx/next-rspack live in
# "dependencies" precisely because the runtime needs them: tsx boots the
# custom server, and Next loads next.config.js — which requires next-rspack —
# at server start). The root "prepare" script is `husky || true` because husky
# is a devDependency and must not fail the prod install here.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/plugin-sdk/package.json packages/plugin-sdk/
COPY packages/plugin-csv/package.json packages/plugin-csv/
COPY packages/plugin-storage-local/package.json packages/plugin-storage-local/
RUN pnpm install --prod --frozen-lockfile && pnpm store prune

# App source must ship in the image — this is the custom-server tradeoff:
# `next start` is not used; tsx runs src/server.ts (which mounts Next's request
# handler + the /realtime WebSocket gateway) straight from TypeScript, so the
# server sources, tsconfig chain (base + app — tsx needs the `@/*` paths to
# resolve), next.config.js and the drizzle migration folder all need to be
# present at runtime.
COPY --from=builder /app/apps/web/.next apps/web/.next
COPY tsconfig.base.json ./
COPY apps/web/src apps/web/src
COPY apps/web/next.config.js apps/web/tsconfig.json apps/web/
# Workspace packages export raw TS source (main: ./src/index.ts) — tsx
# compiles them on import, so their sources ship too.
COPY packages packages

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Runtime uploads live in /app/data (writable by the node user; bind-mount it
# to ./data via docker-compose to persist attachments).
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
ENV UPLOAD_DIR=/app/data/uploads
USER node
WORKDIR /app/apps/web
# EXPOSE documents the default; PORT can move the listener (server.ts reads
# process.env.PORT), and the healthcheck below follows it.
EXPOSE 3000
# Shell form on purpose: exec-form CMD would not expand ${PORT:-3000}, and a
# PORT passthrough (e.g. -e PORT=7420 or a stray PORT in compose's env_file)
# would otherwise leave a healthy server probed on the wrong port —
# permanently unhealthy. Busybox wget exits non-zero on connect failure and
# HTTP >= 400.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1 || exit 1
# server.ts applies pending migrations on boot (guarded by a pg advisory lock
# so concurrent replicas serialize) and then serves HTTP + WebSocket.
CMD ["./node_modules/.bin/tsx", "src/server.ts"]
