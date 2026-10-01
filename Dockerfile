FROM node:22-alpine
RUN apk add --no-cache libc6-compat wget && corepack enable
WORKDIR /app

# Deps layer (cached): lockfile + package.jsons only
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

# Source + build
COPY . .
# Build-time placeholders so module evaluation of db/auth doesn't throw.
# BETTER_AUTH_SECRET is an ARG (build-only) — it must NOT ship as a runtime ENV;
# the server refuses to start without a real secret (see src/server.ts).
ENV DATABASE_URL=postgresql://placeholder:placeholder@placeholder:5432/placeholder
ENV BETTER_AUTH_URL=http://localhost:3000
ARG BETTER_AUTH_SECRET=build-time-placeholder
RUN pnpm --filter @markpocket/web build

ENV NODE_ENV=production
ENV PORT=3000
# Runtime uploads live in /app/data (writable by the node user).
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
ENV UPLOAD_DIR=/app/data/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1
# Migrate on boot, then serve (idempotent — drizzle skips applied migrations).
CMD ["sh", "-c", "pnpm --filter @markpocket/web exec drizzle-kit migrate && exec pnpm --filter @markpocket/web exec tsx src/server.ts"]
