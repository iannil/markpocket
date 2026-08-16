# Contributing to markpocket

## Development Setup

```bash
./dev.sh    # One-shot: starts Postgres, runs migrations, starts web + realtime
```

Opens at http://localhost:7420.

## Code Quality

- **TypeScript**: `pnpm --filter @markpocket/web typecheck` — strict mode, no untyped internals
- **Lint**: `pnpm lint` — ESLint + Prettier (run `pnpm format` to auto-fix)
- **Tests**: `pnpm test` — vitest, co-located with source files as `*.test.ts` / `*.test.tsx`
- **Single test**: `pnpm test -- --run src/foo.test.ts`

## Pull Request Process

1. Branch from `master` — feature branches use `feat/` prefix, fixes use `fix/`
2. One logical change per commit — use conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`)
3. All tests must pass before opening a PR (`pnpm test && pnpm lint && pnpm --filter @markpocket/web typecheck`)
4. Architecture decisions require an ADR in `docs/adr/` — see existing ADRs for format
5. Keep PRs focused — a single feature or fix per PR

## Domain Language (from CONTEXT.md)

- **Expression Field**, never "Formula"
- **Select**, never "Single Select" in UI labels
- **Soft Real-time**, never "OT/CRDT" — we use LWW + WebSocket broadcast
- **Row-per-cell**, never "dynamic DDL" — schema changes are Drizzle migrations

## Code Review

All PRs are reviewed for:

- Correctness: does the code work as described?
- Security: are there data leaks or privilege escalation paths?
- Test coverage: new features include tests, bug fixes include regression tests
- Architecture: does it follow the existing patterns and ADRs?

## Plugin Development

See `docs/plugin-development.md` for writing plugins.
