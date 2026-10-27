# Unified admin login and Users interface

> Use superpowers:executing-plans. Implementation choices below follow the user's request for one password source and a consistent admin interface.

**Goal:** One vault-based role login, remember setting and logout for all three admin tabs; a finished Users workspace matching existing cards, toolbar, typography and mobile layout.

**Architecture:** Keep the existing encrypted vault and administrator/starosta/curator passwords. A common main-level login opens that vault; administrators also obtain the server-verified Users bearer in the same submission. Store it inside the existing admin_session, with the same maximum one-day lifetime and storage choice. No password is retained. Users reuse this shared session on navigation/reload; other roles see a clear permission state. Old admin sessions without a server token require one common re-login. The users refresh button sends the current config read/decrypted by the existing authenticated admin backend to an admin-authorized validated roster-sync endpoint, avoiding another password prompt.

**UI:** Shared compact card login with password visibility, remember checkbox, error/focus/loading states and setup link. Users have the same centered bar with role and logout, a card with search and status filters, compact account list with deliberate detail expansion for linking, clear counts, empty/error/retry states and pagination. Keep palette/theme and schedule/attendance workflows.

## Tasks

- [ ] Regression tests: shared session reuse across reload, logout/role-switch/late-login isolation, curator rights, sync validation and expiry.
- [ ] Shared backend login/client persistence, main auth gate, common login view; remove duplicated old forms via shared wrapper.
- [ ] Authorized roster sync API and matching one-day server token expiry.
- [ ] Refine Users interface with shared components, filters, details, pagination, explicit binding confirmation and no extra password.
- [ ] Run both suites/build, independent review, desktop/mobile UI verification on synthetic data; deploy Vercel and GitHub Pages and verify published page.

## Constraints

- Student LK username/password authentication remains separate; this request concerns admin role passwords.
- Server verifies administrator vault password; a forged client role never grants account access.
- Cloud bearer is stored only alongside existing role credentials, never in a new password store; local logout clears it before network revocation.
- Old clients/tokens retain only their original expiry; no automatic lifetime extension without password verification.
- Do not inspect/export real session storage, passwords, roster or account identity in browser testing.
