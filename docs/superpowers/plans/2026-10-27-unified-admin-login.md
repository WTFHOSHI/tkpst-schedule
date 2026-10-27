# Unified admin login and Users interface

> Use superpowers:executing-plans. Implementation choices below follow the user's request for one password source and a consistent admin interface.

**Goal:** One vault-based role login, remember setting and logout for all three admin tabs; a finished Users workspace matching existing cards, toolbar, typography and mobile layout.

**Architecture:** Keep the existing encrypted vault and administrator/starosta/curator passwords. A common main-level login opens that vault; administrators also obtain the server-verified Users bearer in the same submission. Store it inside the existing admin_session, with the same maximum one-day lifetime and storage choice. No password is retained. Users reuse this shared session on navigation/reload; other roles see a clear permission state. Old admin sessions without a server token require one common re-login. The users refresh button sends the current config read/decrypted by the existing authenticated admin backend to an admin-authorized validated roster-sync endpoint, avoiding another password prompt.

**UI:** Shared compact card login with password visibility, remember checkbox, error/focus/loading states and setup link. Users have the same centered bar with role and logout, a card with search and status filters, compact account list with deliberate detail expansion for linking, clear counts, empty/error/retry states and pagination. Keep palette/theme and schedule/attendance workflows.

## Tasks

- [x] Regression tests: shared session reuse across reload, logout/role-switch/late-login isolation, curator rights, sync validation and expiry.
- [x] Shared backend login/client persistence, main auth gate, common login view; remove duplicated old forms via shared wrapper.
- [x] Authorized roster sync API and matching one-day server token expiry.
- [x] Refine Users interface with shared components, filters, details, pagination, explicit binding confirmation and no extra password.
- [x] Run both suites/build, independent review, desktop/mobile UI verification on synthetic data; deploy Vercel and GitHub Pages and verify published page.

## Constraints

- Student LK username/password authentication remains separate; this request concerns admin role passwords.
- Server verifies administrator vault password; a forged client role never grants account access.
- Cloud bearer is stored only alongside existing role credentials, never in a new password store; local logout clears it before network revocation.
- Old clients/tokens retain only their original expiry; no automatic lifetime extension without password verification.
- Do not inspect/export real session storage, passwords, roster or account identity in browser testing.

## Results and rulings

- Review identified fresh setup being blocked by config-dependent login. Login now verifies only the vault; Users synchronization is separate, so missing config can be created from Attendance.
- Source ordering uses server-issued, session-bound, single-use 60-second tickets backed by a durable monotonic clock. Reserve before reading source, consume once on sync. Older responses cannot re-enable a withdrawn identity. Schema tested on existing Neon test branch before additive production migration.
- Expired shared sessions emit common logout and return to login. Initial roster sync remains mandatory across Retry/Refresh/search/filter until successful; returning to Users resets controls and query together.
- Application51/51 + admin24/24 tests passed; build and both diff checks passed. Mechanical design warning concerned unchanged attendance CSS.
- Isolated browser QA used synthetic vault and local source/API only: admin+remember, Users→Attendance→Users, filters and reset, reload persistence, inline binding confirmation/save, shared logout, curator permission state. Desktop and390px mobile verified. Preview screenshot explicitly labels test data.
- Production Vercel `dpl_6UBMWLmoKT8hzygiqiCT5yiucg7n` READY. Admin main commit `f25f22bb767e6c3cadc761e6e4b15fd80cdaf06d`; Pages run40499001550 succeeded. Published browser shows unified password form. Live Users/sync/start/sync reject missing bearer401 with exact-origin CORS/no-store; student anonymous session200 preserved.
