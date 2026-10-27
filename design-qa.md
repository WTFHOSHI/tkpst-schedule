# Web redesign QA — 27 October 2026

Historical report for the design-only stage. Registration and real local login were added afterwards; current verification is in `docs/auth-qa.md`.

final result: passed

## Target and scope

Selected source: `design/mockups/01-personal-grades-light.png` (853 × 1844). Normalized to 390 × 844 for comparison with the app at a 390 × 844 CSS viewport, devicePixelRatio 1. Existing static web app retained; no new framework or device-frame template. Android and iOS were not modified.

Comparison: `design/qa/reference-vs-implementation.png` (reference left, implementation right). Both sides were inspected together. The full-size comparison is legible enough to assess typography, chips, rows, and icons without additional crops.

## Visual checks

- Typography: native sans stack, 35.88px mobile heading, 16px body, 15px subject names; hierarchy, wrapping, decimal commas and Cyrillic checked. System font rendering differs slightly from the generated image.
- Spacing: 16px mobile content margins, one semester control, one summary panel and a unified subject list. Five subjects remain visible at 390 × 844. Narrow screens scroll vertically. Footer can require a small scroll; body padding allows it to clear the fixed navigation.
- Tokens: original light olive #4F6F2F / #F6F8F1 palette retained. Existing dark and system choices remain available. Completed schedule items no longer lose contrast through whole-card opacity.
- Assets: local Lucide 0.468.0 SVG icon assets, license included. No raster illustrations required. Existing application icons retained.
- Copy: grades and account are explicitly demonstrations. Example date is 26 October 2026; no live student identity or fake successful sign-in is shown. A profile entry was added to the header alongside settings as requested.

## Browser checks

- 390 × 844: grades list, personal subject history, back navigation, empty second semester, return to first semester, account and settings.
- Main navigation: schedule, grades, buses; address form reachable, accessible name present; no GPS permission or real address needed for visual testing.
- Schedule week controls: 26–31 October → 2–7 November → original week. Navigation away while a request is pending leaves the grade screen intact.
- Light theme selected through settings; dark/system theme inspected separately. Explicit stored theme preferences are honored.
- 320 × 740: grades and bus address prompt have no horizontal overflow. All three navigation links remain visible and measure at least 53px high.
- 1440 × 1000: content is centered at a maximum width of 560px with no horizontal overflow.
- Browser error log inspected: empty at the time of the check.

Screenshots: `design/qa/grades-mobile.png`, `grades-dark.png`, `grades-320.png`, `grades-desktop.png`, `grades-empty.png`, `subject-mobile.png`, `account-mobile.png`, `schedule-mobile.png`, `buses-mobile.png`, `buses-320.png`.

## Code and regression verification

- `node --test web/test/*.test.mjs`: 18 tests passed.
- Syntax checks passed for app, grade view/model, shared UI and service worker.
- `git diff --check`: passed.
- Offline shell: all 21 referenced resources exist, including the new modules and icons. Actual offline device operation was not simulated.
- Independent code review found one regression: announcements disappeared on empty/error schedule states after removal of the old home screen. A renderer regression test failed first, then passed after moving announcements outside the schedule-state branch. No other important findings were reported.
- Impeccable detector: only an existing `transition: width` warning in the schedule progress bar. It updates once per second; no new layout animation was introduced.

## Limits

Real grade API and authentication are intentionally deferred. Bus route calculation tests pass, but live bus arrivals and GPS were not exercised. External schedule availability varies; cached/error states remain supported. No production deployment or native build was performed.
