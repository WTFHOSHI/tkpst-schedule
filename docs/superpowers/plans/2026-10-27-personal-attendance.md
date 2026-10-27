# Personal attendance implementation plan

> Execute the independent backend, student UI and admin bridge tasks using superpowers:subagent-driven-development, followed by integration and whole-change review.

**Goal:** Show the signed-in student's real attendance from the admin panel inside Успеваемость, initially for the current Tyumen month with month navigation.

**Architecture:** The admin browser keeps decrypting its private source. After a successful source write/load it pushes a validated minimal week snapshot to the existing protected Render API. A separate attendance-writer bearer, cryptographically checked against the existing role vault, can publish attendance but cannot manage accounts. Existing administrator bearers can publish too. Students read only the snapshot projection for their server-confirmed linked student; no GitHub token, data key, whole class or supplied userId is accepted by the student API.

**Tech stack:** Existing Node.js 24, SQLite/Postgres shared stores, Neon production database, Render services, browser ES modules and existing olive design tokens. No new paid infrastructure or dependencies.

**Spec:** This document records the user's requested feature and explicit preference: current month with month switching.

## Global constraints
- Source statuses: P present; N unexcused absence; B illness; U excused; R work; Z application. Empty cells are unmarked, never absences. Hidden pairs are excluded.
- Default month uses Asia/Yekaterinburg. Dates are strict ISO calendar dates. Months are bounded and cannot select another person.
- Preserve current admin login/offline source saving; failed LK sync must not undo or falsely report failure of saved GitHub marks. Show a separate sync state and retry/history button.
- Same-origin HttpOnly student cookie, POST/no-store, exact-origin admin CORS, no public attendance exports. Private source decryption stays in the admin browser.
- Snapshot tickets are single-use, actor/course/week-bound and monotonically ordered. Older delayed reads cannot overwrite newer snapshots. Deleted marks/empty weeks replace old records.
- Existing verified link, active roster and enrollment dates gate student reads on every request. Unlink/deletion/withdrawal fails closed.

## API contract
- POST /api/attendance with `{month:'YYYY-MM'}` returns `{linked,month,syncedAt,records:[{date,pair,status}],counts:{P,N,B,U,R,Z,marked,attended,missed,unexcused}}`. Unlinked accounts return linked:false and no records; anonymous requests401. Student identity comes only from session.
- POST /api/admin/attendance/login `{password,role}` (admin/kurator/starosta) returns `{token,expiresAt}`. Its bearer is limited to the attendance routes. Existing admin tokens also work for attendance.
- POST /api/admin/attendance/start `{course,monday}` returns `{ticket}`. Reserve before reading the authoritative week.
- POST /api/admin/attendance/sync `{course,monday,ticket,week}` replaces that week; week is the existing `{m,pairs,hide,at}` shape. No config/keys/credentials are sent.
- POST /api/admin/attendance/logout revokes attendance writer token.

## Tasks and interfaces
- [x] Backend: server attendance schema/store, role authentication, ordered snapshot validation, private student read and HTTP tests. Owns server/ only. SQLite and PGlite verify isolation, stale snapshots, replay, hiding, clearing and withdrawal.
- [x] Student UI: web attendance model/view and current app integration; auth-client attendance request with stale401 protection; default month/navigation, counts/reasons/date/pair journal, unlinked/loading/empty/error states. Owns web/ only, preserves grades demo and honest not-connected grade state. Add all public modules to SW shell and no private caching.
- [x] Admin bridge: isolated admin checkout; separate attendance client, scoped writer credential in existing session, background role login exchange, automatic sync after source saves/loads and explicit historical course sync button. It must read after reserving a ticket, discard work after logout/role change, and retry failed sync without resaving source marks.
- [ ] Integrate: full app/admin tests, source review, idempotent additive production migration, deploy both existing Render services and GitHub Pages, browser synthetic checks in light/dark and320/390/desktop. Real initial sync needs a signed-in authorized admin; do not retrieve their passwords or browser secrets.

## Ledger
- Read source: encrypted private GitHub attendance weeks are authoritative; the server currently stores only directory links. Admin source saves may be performed by all three vault roles.
- User chose current month with month switching. Inherit existing UI; no visual redesign.
- Workspaces: schedule managed worktree accounts-neon; admin isolated checkout in temporary tkpst-admin-hosting-ce7a0755ebbc4ae0ba35fcb394d1c2ed/source. Do not touch concurrent local admin edits.

## Completion evidence (2026-10-27)
- Server and student application: 2881c04; admin bridge: d2388a3. Both main branches pushed, schedule hosting branch pushed. Independent task reviews and final integration review passed with no findings.
- Tests: 66 schedule/server (including SQLite and PGlite) and 38 admin passed. Browser synthetic checks covered real login, month navigation, missing-month state, reasons disclosure, history retry and light/dark layouts at desktop/390/320px. No horizontal overflow at 320px. Design detector reported only the existing width transition outside this change.
- Additive production migration succeeded. Both Render services are live on 2881c04 (deploys dep-dbgdll2vcj2c73edrbtg and dep-dbgdllgu01pc73fk9c50). GitHub Pages deployments passed in both repositories. Live HTTP checks: app/modules200, API health200, anonymous private APIs401/no-store.
- Public Git URL services required manual deployments; neither had an automatic deployment after push. Existing free plans preserved.
- First authorized real history sync remains a user login action. Production admin browser showed its login form, so no credentials or source keys were extracted. User was given the attendance sync and personal performance links. No real attendance visibility claim was made before this initial sync.
