# Daily progress log

One entry per working day, newest first. Each entry maps to that day's commit(s).

## 2026-11-14
- Phase 3 scaffold: Prisma 7 schema (Auth.js tables, `Review`, `FindingState`), Neon adapter, Auth.js v5 with GitHub sign-in and database sessions.
- `/api/reviews` now requires sign-in and saves each review; added history API, `/signin`, `/history`, `/history/[id]` with delete, and saved resolve/ignore.
- Removed the shared access-token field from the UI.
- Tests: 67 passing (4 new ownership tests, mocked). Typecheck and production build pass.
- Not done: no Neon database or GitHub OAuth app connected yet, so no migration has run and sign-in is untested.

## 2026-11-13
- Initialised git repository.
- Baseline: phases 1, 2 and 2b (JEV integration, review UI, Claude analysis layer, mocked tests).
- Decided Phase 3 stack: Neon (Postgres) + Prisma, per-user auth, persistent history.
