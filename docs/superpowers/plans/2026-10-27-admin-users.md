# Admin users and existing student directory

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show registered accounts in the existing GitHub Pages admin and connect accounts to its encrypted student directory.

**Architecture:** Vercel verifies the existing administrator password against the pinned public AES-GCM vault, reads and decrypts the private config server-side, and imports a minimal roster snapshot into Neon. No GitHub token, data key, password or attendance marks are persisted. Short-lived hashed bearer sessions protect a separate admin API; existing student cookies never authorize it. The GitHub Pages users tab calls this API with exact-origin CORS. Explicit administrator linking, one account per course/student, makes a student's own name/group available in their LK.

**Tech Stack:** Existing Node 24, Neon Postgres/SQLite stores, browser ES modules, GitHub Pages.

**Spec:** This document; user requested reuse of existing people data and registered-user visibility. Design decisions are implementation choices, not additional user requirements.

## Constraints and review focus

- Preserve existing schedule/attendance and registration/login; no name-based automatic verification.
- Admin role must be cryptographically verified from the vault; curator/starosta and forged client roles fail.
- Pinned GitHub URLs only; no credentials or roster in public assets/logs. Timeouts and bounded responses.
- Vault rotation invalidates admin sessions. Expired/revoked sessions and student cookies fail closed.
- Roster refresh is atomic and validated; deleted/withdrawn students lose verification. Conflicting links return 409.
- All admin responses no-store, POST, exact allowed origin. Pagination includes every registered account.

## Tasks

- [x] Add failing tests for vault verification, roster decryption, admin isolation, pagination/link uniqueness, expiry/rotation and both SQL stores.
- [x] Implement versioned additive schema, roster/link store methods and protected admin service/HTTP routes.
- [x] Add Users tab in tkpst-admin with password login, search/pagination, roster sync, explicit linking/unlinking and no secrets persisted.
- [x] Show verified directory name/group and status in student's profile; preserve grades not-connected state.
- [x] Run both suites/build, independent review, test migration on Neon branch, migrate production and deploy Vercel and GitHub Pages.
- [x] Verify published unauthorized requests and actual admin tab UI. Existing real roster import occurs only on administrator's password login; do not request the password in chat.

## Decisions / results

- Existing admin has no live Netlify backend: its vault unlocks encrypted private GitHub files in-browser. Reuse that source and cryptographic administrator identity, rather than trusting the role sent by its client.
- Separate users-tab login avoids retaining the existing administrator password or changing schedule/attendance login behavior.
- Independent review found delayed token revocation during role-switch and out-of-order roster refresh. Both were reproduced with failing tests and fixed. Source ordering marker is captured after vault/KDF, immediately before fetching config; singleton row serializes DB replacement.
- Verified: application full suite 48/48, then added slow-vault ordering regression and focused admin suite 4/4; admin 21/21; build/diff checks clean. Additive schema ran successfully on Neon test branch and production.
- Vercel deployment `dpl_GoqZFTjyDoD85UZAMGqeX5vA6EnQ` READY; published API preflight204, missing authorization401, hostile origin403, invalid password401, anonymous student session200.
- GitHub connector write403; existing authenticated Git push succeeded. Admin commit `3471a6ade3f9d91e7d0e7c4224fad3a63881369e` pushed to main; Pages workflow run40495942238.
- Pages workflow completed successfully; published browser tab shows three sections and Users password form. Mobile/desktop login and synthetic user list visually checked. Mechanical detector findings concerned pre-existing attendance CSS only; unchanged.
- Final application suite 49/49 passed; admin suite21/21 passed. Published browser password form tested end-to-end across origins with an intentionally invalid password: refused correctly and returned input focus. Real directory awaits administrator login; no real account links were changed.
