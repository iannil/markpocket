FROM node:22-alpine
RUN apk add --no-cache libc6-compat && corepack enable
WORKDIR /app

# Deps layer (cached): lockfile + package.jsons only
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

# Source + build
COPY . .
# Placeholder envs so build-time module evaluation of db/auth doesn't throw;
# runtime values come from docker-compose.
ENV DATABASE_URL=postgresql://placeholder:placeholder@placeholder:5432/placeholder
ENV BETTER_AUTH_SECRET=placeholder
ENV BETTER_AUTH_URL=http://localhost:3000
RUN pnpm --filter @markpocket/web build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
# Migrate on boot, then serve (idempotent — drizzle skips applied migrations).
CMD ["sh", "-c", "pnpm --filter @markpocket/web exec drizzle-kit migrate && exec pnpm --filter @markpocket/web exec tsx src/server.ts"]
