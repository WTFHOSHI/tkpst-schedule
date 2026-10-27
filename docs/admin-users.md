# Existing admin directory and registered accounts

Admin: https://wtfhoshi.github.io/tkpst-admin/#users

The source checkout is `../tkpst-admin`. Its encrypted private GitHub config is the authoritative people directory. It currently contains people, courses and attendance, not subject grades. This integration copies minimal directory fields only; grades stay explicitly disconnected.

## Workflow

1. Students register normally at https://tkpst-schedule.vercel.app/#/register.
2. Administrator enters the existing admin password in the new Users tab. The backend verifies the AES-GCM admin vault entry (PBKDF2-SHA256) from the pinned public URL, decrypts private config and atomically refreshes the directory.
3. Administrator checks the person's identity and explicitly selects their course/student record. The confirmation shows both username and student's name.
4. Their LK shows verified full name, group and course. Other accounts cannot read these details. Unlinking, roster removal or withdrawal removes verification.

`POST /api/admin/login`, `/users`, `/link`, `/logout` use exact-origin CORS and independent 30-minute random bearer tokens, hashed in `admin_sessions`. Student cookies never authorize admin calls. Each authorized request rechecks public vault fingerprint, so vault rotation revokes old sessions. IP/global durable throttles limit password derivation. Tokens live only in the admin page's memory, and role-switch/logout clears them before awaiting the network. Private reads remain POST/no-store for old service workers.

`student_roster`, `roster_state`, `user_student_links`, `admin_sessions` are additive, idempotent schema changes shared by PostgreSQL and local SQLite. Refreshes serialize on the roster_state singleton and reject older request snapshots. Unique course/student prevents two accounts claiming the same student. Passwords, GitHub credentials, data keys and attendance marks are never persisted by this integration.

## Verification

- Auth/HTTP tests cover valid cryptography and decryption, invalid password/forged role, student-cookie isolation, CORS/preflight, rate limits, expiry/vault rotation, explicit linking, conflict, unlink and withdrawal.
- SQLite and PGlite tests cover 105-account pagination, literal wildcard and Cyrillic search, transactional rollback, stale snapshots and session persistence.
- Admin client tests cover XSS escaping, no cookie forwarding, request allowlist, expiry, stale login and role-switch/logout races.
- Production real roster import requires the administrator's password login. Do not copy their password into chat or impersonate a real student to test links.

Neon migration test branch: `br-polished-cake-b9f6u0pp`, `admin-users-schema-check`, min/max 0.25 CU on existing free project. It uses the account's default automatic suspension. Retained for migration review; no paid resources enabled.

Published 2026-10-27: Vercel deployment `dpl_GoqZFTjyDoD85UZAMGqeX5vA6EnQ` READY; admin main commit `3471a6ade3f9d91e7d0e7c4224fad3a63881369e`, GitHub Pages run40495942238 succeeded. New page visibly serves all three navigation tabs. Production preflight204, unauthenticated401, invalid password401, hostile origin403 and existing anonymous student session200 verified.
