#!/usr/bin/env bash
set -euo pipefail

# ─── markpocket dev environment ───
# One-shot startup: Postgres + web. Ctrl-C kills everything.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# ─── Ports (7400-7450 range) ───
PG_PORT=7400
WEB_PORT=7420
REALTIME_PORT=7419

# ─── State ───
PIDS=()
COMPOSE_PROJECT="markpocket-dev"
COMPOSE_FILE="$ROOT_DIR/.dev-compose.yml"
ENV_FILE="$ROOT_DIR/apps/web/.env"

cleanup() {
  echo ""
  echo "▸ Shutting down markpocket dev…"
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" down --remove-orphans 2>/dev/null || true
  echo "▸ Done."
}
trap cleanup EXIT INT TERM

# ─── 1. Write ephemeral compose (separate from production docker-compose.yml) ───
cat > "$COMPOSE_FILE" <<YAML
services:
  postgres:
    image: postgres:16-alpine
    container_name: markpocket-dev-pg
    environment:
      POSTGRES_USER: markpocket
      POSTGRES_PASSWORD: markpocket_dev
      POSTGRES_DB: markpocket
    ports:
      - "${PG_PORT}:5432"
    volumes:
      - markpocket_dev_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U markpocket -d markpocket']
      interval: 3s
      timeout: 3s
      retries: 15
volumes:
  markpocket_dev_pgdata:
YAML

# ─── 2. Write .env (if missing or ports differ) ───
NEEDS_WRITE=false
if [ ! -f "$ENV_FILE" ]; then
  NEEDS_WRITE=true
elif ! grep -q ":${PG_PORT}/" "$ENV_FILE" 2>/dev/null; then
  NEEDS_WRITE=true
elif ! grep -q "NEXT_PUBLIC_REALTIME_URL=" "$ENV_FILE" 2>/dev/null; then
  NEEDS_WRITE=true
fi
if [ "$NEEDS_WRITE" = true ]; then
  SECRET=$(openssl rand -base64 32)
  cat > "$ENV_FILE" <<ENV
DATABASE_URL=postgresql://markpocket:markpocket_dev@localhost:${PG_PORT}/markpocket
BETTER_AUTH_SECRET=${SECRET}
BETTER_AUTH_URL=http://localhost:${WEB_PORT}
PORT=${WEB_PORT}
REALTIME_PORT=${REALTIME_PORT}
NEXT_PUBLIC_REALTIME_URL=ws://localhost:${REALTIME_PORT}/realtime
ENV
  echo "▸ Wrote apps/web/.env (pg=${PG_PORT}, web=${WEB_PORT}, realtime=${REALTIME_PORT})"
fi

export PORT="$WEB_PORT"
export REALTIME_PORT="$REALTIME_PORT"
export NEXT_PUBLIC_REALTIME_URL="ws://localhost:${REALTIME_PORT}/realtime"
export DATABASE_URL="postgresql://markpocket:markpocket_dev@localhost:${PG_PORT}/markpocket"
export BETTER_AUTH_URL="http://localhost:${WEB_PORT}"

# ─── 3. Start Postgres ───
echo "▸ Starting Postgres on :${PG_PORT}…"
docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" up -d postgres
echo "  Waiting for health…"
for i in $(seq 1 30); do
  STATUS=$(docker inspect --format '{{.State.Health.Status}}' markpocket-dev-pg 2>/dev/null || echo "")
  if [ "$STATUS" = "healthy" ]; then
    echo "  ✓ Postgres healthy"
    break
  fi
  sleep 1
done
if [ "$STATUS" != "healthy" ]; then
  echo "  ✗ Postgres failed to start"
  exit 1
fi

# ─── 4. Install deps if needed ───
if [ ! -d "node_modules" ]; then
  echo "▸ Installing dependencies…"
  pnpm install
fi

# ─── 5. Run migrations ───
echo "▸ Running migrations…"
pnpm --filter @markpocket/web exec drizzle-kit migrate 2>/dev/null || echo "  (migrations may already be applied)"

# ─── 6. Start dev servers ───
# Two processes: `next dev` serves pages (bundler in its own worker — flat memory),
# and a standalone realtime gateway hosts the /realtime WebSocket. Running Next's
# dev compiler inside the custom server leaked ~40MB/s to OOM; this split avoids it.
echo "▸ Starting realtime gateway on :${REALTIME_PORT}…"
pnpm --filter @markpocket/web dev:realtime &
PIDS+=("$!")

echo "▸ Starting web dev server on :${WEB_PORT}…"
pnpm --filter @markpocket/web dev &
DEV_PID=$!
PIDS+=("$DEV_PID")

# ─── 7. Wait for web to be ready ───
echo "  Waiting for web…"
for i in $(seq 1 40); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${WEB_PORT}" 2>/dev/null || echo "000")
  if [ "$CODE" != "000" ]; then
    echo "  ✓ Web ready (HTTP $CODE)"
    break
  fi
  sleep 1
done

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  markpocket dev is running                   ║"
echo "║                                              ║"
echo "║  Web:      http://localhost:${WEB_PORT}           ║"
echo "║  Postgres: localhost:${PG_PORT}                    ║"
echo "║                                              ║"
echo "║  Press Ctrl-C to stop all services.          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ─── 8. Wait for dev server (foreground) ───
wait "$DEV_PID"
