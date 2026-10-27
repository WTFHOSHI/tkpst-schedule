# Vercel + Neon implementation plan

**Goal:** deploy the existing self-registration and session flow on Vercel, storing accounts, sessions and rate limits in Neon Postgres. Preserve local SQLite mode and the frontend API contract.

**Authorization:** user accepted Vercel + Neon adaptation and publication. Use free plans; no paid upgrades. Connections are not yet available; prepare and test everything independently while user connects the suggested integrations.

## Architecture

- Extract account persistence behind async store methods; local SQLite and Neon HTTP implementations share password/session logic.
- One Node Vercel API handler, rewrites for `/api/*`, static output restricted to `web/`.
- POST-only private APIs, exact trusted-origin checks and secure host cookies remain intact.
- PostgreSQL rate buckets persist across function instances. Never trust arbitrary Host or forwarded headers outside the Vercel adapter.
- Cloud mode requires DATABASE_URL, never falls back to SQLite. Explicit idempotent migration creates tables; account migration, if needed, preserves IDs/hashes without uploading data without permission.
- Keep DATABASE_URL out of browser files, build artifacts and tool output. Preserve current local database.

## Tasks

- [x] Add failing persistence contract tests and deployment/origin tests.
- [x] Extract SQLite store, implement Postgres store + atomic rate limiting, migration and Neon driver adapter. Run contract tests against embedded real PostgreSQL (PGlite); actual Neon remains a separate live check.
- [x] Extract shared API handler; add Vercel wrapper and deployment configuration; verify packaged static output excludes private files.
- [x] Run all tests and local browser smoke checks; independent review of database transactions, trusted origin/IP, serverless persistence and packaging.
- [x] Connect Neon and Vercel, create free resources, migrate, deploy and test public registration/login/logout. If user connections are missing, report the concrete remaining step without claiming deployment.

## Result

Connections became available during execution. Free Neon project and personal Vercel project created, one existing local account copied insert-only, schema migrated. Production deployment `dpl_BusugHWvwdU53sqrkCqjwkF9avEi` is READY at https://tkpst-schedule.vercel.app/. Browser login of migrated account succeeded; isolated public smoke checks covered new registration/login/logout without altering the user's active browser session. Current admin overrides proxy verified 200/no-store. Cloud packaging uses an explicit allowlist; zero private data files uploaded. No Git push or paid plan changes. See `docs/vercel-neon.md`.
