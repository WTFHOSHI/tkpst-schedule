# TKPST web redesign implementation plan

> Execute inline in the current checkout; user selected mockup 1 and requested implementation. Do not publish or change the native apps in this pass.

**Goal:** Implement the selected light olive mobile design in the existing web app, with persistent navigation and clearly marked demonstration grades.

**Architecture:** Preserve the static ES-module application and its schedule/transit data layers. Add a small standalone grades module, reuse existing theme storage, and extend route rendering with a shared header and bottom navigation. No backend, real authentication or credential storage.

**Spec:** `design/review-and-brief.md`, `design/mockups/01-personal-grades-light.png`.

## Global constraints

- Keep schedule, transit, offline shell, local timezone and existing settings working.
- Exactly three primary tabs: Расписание, Успеваемость, Автобусы.
- Grade figures are demonstration data, never represented as a real account.
- Adapt to 320px screens, desktop widths, safe areas, keyboard and existing dark theme.
- Default landing screen becomes schedule; direct existing hash links remain supported.

## Review focus

- Rapidly leaving schedule while a request is pending must not mutate another screen.
- Empty grade semesters must show no grades and no zero mean.
- Long subject titles and enlarged text must wrap without horizontal scrolling.
- Bottom navigation must not cover content, notifications or input fields.
- Account UI must not accept or retain real credentials before a backend exists.

## Tasks

- [x] Add a grade model with fixed synthetic data, average calculation and semester selection. Test empty data and subject lookup with Node tests, first observe failure.
- [x] Implement shared shell, grade list/detail and demonstration profile. Preserve existing navigation and data functionality.
- [x] Apply mockup typography, spacing, colors and controls across schedule, grades, buses and settings. Vendor only needed Lucide icon assets with license.
- [x] Run existing and new tests, JS syntax checks, local browser interactions, screenshot comparison at mobile/desktop sizes, dark theme and overflow checks.
- [x] Save screenshots and `design-qa.md`; leave the verified preview open. No deployment.

## Execution record

Used existing clean checkout on branch `codex/web-design-v1`, preserving the earlier untracked design artifacts. No commits or remote writes. Grade tests failed on the missing module, then passed. Independent review found the announcement regression; its renderer test failed before the fix and passed afterwards. Final suite: 18/18. See `design-qa.md` for browser evidence and verification limits.
