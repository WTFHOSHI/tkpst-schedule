# Account hosting implementation plan

**Goal:** Make the account application available without the Vercel or Neon invocation domains in the browser.

**Architecture:** Render hosts the existing Node.js server and all public application files under one HTTPS origin. The server accesses the existing Neon database; account IDs, password hashes and directory links remain in place. GitHub Pages continues to serve public sections and links to the verified Render address.

**Approaches:** Vercel is unavailable without VPN. A Neon Function probe is also unavailable in the user's network; it was not connected to account data. The user confirmed Render's official demo is reachable without VPN, selected My Workspace, and authorized only a free service. Use Render; no cross-site session rewrite is needed.

**Constraints:** Node.js 24.x; existing database only; no paid resources; no SQLite fallback in hosted mode; same-origin HttpOnly/Secure/SameSite=Lax cookies; secrets stay out of Git. Isolated worktree excludes concurrent admin edits.

## Task 1: Hosted server
- [x] Add failing tests for required database configuration, trusted HTTPS origin and live overrides forwarding.
- [x] Implement a hosted entry point with validated environment settings and no SQLite fallback.
- [x] Proxy overrides.json from the fixed GitHub Pages source, preserving live admin updates.
- [x] Run the full suite and build.

## Task 2: Deploy and verify
- [x] Add a free Render blueprint and deployment documentation.
- [x] Commit and push the hosting branch; deploy in the confirmed workspace with the existing database secret.
- [x] Verify registration, session restore, profile, wrong password, logout, private file denial and origin isolation using synthetic data.
- [x] Verify real browser cookies and refresh; user confirmed the actual Render login page works without VPN.
- [ ] Update the Pages link only after successful checks; merge and push without overwriting concurrent work.

## Ledger
- Probe: Neon accounts function returns a fixed health response only; user reports it is unavailable without VPN. No account APIs or secrets deployed there.
- Render connected; user explicitly selected My Workspace and free service. Official express.onrender.com demo works without VPN for the user.
- Actual Render login also confirmed without VPN. Real-browser synthetic registration, refresh and logout passed. Independent migration review found no actionable defects.
- Ruling: retain the Render service's explicit hosting branch; connector cannot edit it and the dashboard needs interactive sign-in. Document future branch synchronization rather than inventing an update capability.
