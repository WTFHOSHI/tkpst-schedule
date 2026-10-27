# Account hosting implementation plan

**Goal:** Make the account application available without the Vercel or Neon invocation domains in the browser.

**Architecture:** Render hosts the existing Node.js server and all public application files under one HTTPS origin. The server accesses the existing Neon database; account IDs, password hashes and directory links remain in place. GitHub Pages continues to serve public sections and links to the verified Render address.

**Approaches:** Vercel is unavailable without VPN. A Neon Function probe is also unavailable in the user's network; it was not connected to account data. The user confirmed Render's official demo is reachable without VPN, selected My Workspace, and authorized only a free service. Use Render; no cross-site session rewrite is needed.

**Constraints:** Node.js 24.x; existing database only; no paid resources; no SQLite fallback in hosted mode; same-origin HttpOnly/Secure/SameSite=Lax cookies; secrets stay out of Git. Isolated worktree excludes concurrent admin edits.

## Task 1: Hosted server
- [ ] Add failing tests for required database configuration, trusted HTTPS origin and live overrides forwarding.
- [ ] Implement a hosted entry point with validated environment settings and no SQLite fallback.
- [ ] Proxy overrides.json from the fixed GitHub Pages source, preserving live admin updates.
- [ ] Run the full suite and build.

## Task 2: Deploy and verify
- [ ] Add a free Render blueprint and deployment documentation.
- [ ] Commit and push the hosting branch; deploy in the confirmed workspace with the existing database secret.
- [ ] Verify registration, session restore, profile, wrong password, logout, origin isolation and private file denial using synthetic data.
- [ ] Verify real browser cookies and refresh; request the user's no-VPN check on the actual service address.
- [ ] Update the Pages link only after successful checks; merge and push without overwriting concurrent work.

## Ledger
- Probe: Neon accounts function returns a fixed health response only; user reports it is unavailable without VPN. No account APIs or secrets deployed there.
- Render connected; user explicitly selected My Workspace and free service. Official express.onrender.com demo works without VPN for the user.
