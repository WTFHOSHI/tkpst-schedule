# Student registration and login

**User decision:** students register themselves. Use the approved light account screens. Grade source is deliberately deferred.

**Goal:** real local account registration, login, server sessions, profile and logout; no simulated authentication and no demo grades presented as personal data.

**Architecture:** Node.js HTTP server serves the existing `web/` and a same-origin JSON API. SQLite lives outside the public directory. Passwords use salted scrypt hashes; browser sessions use random opaque HttpOnly SameSite cookies, with only token hashes stored in SQLite. HTTPS deployments require Secure cookies and an explicit public origin. No external service or deployment in this change.

**Boundaries:** schedule and transit remain public. Registration creates an application account, not a verified college identity. Real grade linking and password recovery are later work. No email collection or sending. Existing public demo journal remains accessible only through a clearly named example route.

## Tasks

- [x] Write integration tests and observe failure: registration/login/restart/logout, isolation, password storage, validation, CSRF, expiry, rate limits, private files and API cache headers.
- [x] Implement password, SQLite account/session service, HTTP API and safe static serving. Bind to loopback for local preview.
- [x] Add client session API, real login/registration forms and profile. Gate personal grades; keep demo journal explicitly separate. Add API exclusion to service worker.
- [x] Run full tests, browser registration/login/reload/logout/invalid-input flows and mobile layout checks. Review security boundaries independently and fix concrete findings.
- [x] Document startup, storage, deployment limits and verification; leave working preview open.

Execution: implementation kept in the existing `codex/web-design-v1` checkout alongside the earlier redesign. No commits or publication. Initial server tests failed on missing implementation, then passed. Review identified two regressions (late 401 and legacy private GET cache); both had reproducing failing tests followed by passing fixes. Private API reads use POST intentionally for old-worker migration safety. Full evidence in `docs/auth-qa.md`.

## Review focus

- A user cannot choose another account ID to access its profile; client-selected group is not authorization.
- Registration duplicates and concurrent requests do not create partial accounts/sessions.
- Authentication responses and API failures are never served from the offline shell cache.
- Cross-origin state changes, malformed/oversized requests and brute-force attempts fail safely.
- Passwords/tokens never appear in public files, localStorage, responses or logs.
