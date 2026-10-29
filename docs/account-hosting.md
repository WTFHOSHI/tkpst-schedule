# One account address on Cloudflare Workers

Canonical account URL: **https://tkpst-account.telling-math.workers.dev/**. The public schedule at **https://wtfhoshi.github.io/tkpst-schedule/** redirects account routes there automatically. This is one login and one account UI with and without VPN. The Cloudflare Worker serves static files from `dist/` immediately and forwards only the allowlisted student `/api/*` POST routes to the existing Vercel API. The browser never contacts Vercel directly for account requests. Vercel keeps the existing Neon database, accounts, password hashes and student links. Users must sign in once on the new hostname because secure session cookies are host-scoped.

The Worker checks the exact same-origin `Origin`, rejects cross-site and admin requests, limits JSON bodies to 16 KiB, and forwards only a session cookie to the fixed Vercel origin. Authentication and attendance responses are never cached. The Worker UI reads current schedule overrides from the public GitHub Pages file, which permits cross-origin reads. No database password, Cloudflare token or Neon endpoint is shipped to the browser or committed to Git.

Build with `npm run build`, then deploy with `npx wrangler deploy` after authenticating the Cloudflare account. `wrangler.jsonc` configures static SPA assets and the API Worker. The original Render service remains an alternate deployment; its daytime cron-job.org warmup is not part of the canonical account route and can be disabled after the new address is confirmed. The account is on Cloudflare's Free plan; do not create paid resources.

## Previous Render deployment

Main static site: **https://wtfhoshi.github.io/tkpst-schedule/**. User confirmed it opens with VPN. The former account entry offered **https://tkpst-schedule.onrender.com/** without VPN and **https://tkpst-schedule.vercel.app/** with VPN; the user confirmed both routes in the respective network mode. Render service `srv-dbg97mmc6qcc73eo871g`, My Workspace, Free plan, Frankfurt.

Render runs `node server/hosted.mjs` and serves both `web/` and `/api/*` under the same HTTPS origin. Use only the **Free** plan in the confirmed workspace. `render.yaml` describes the service. No Render database or persistent disk is required.

The Render service is configured to track `codex/accounts-hosting`, the verified hosting branch. GitHub Pages deploys `main`. Keep future application changes merged into the hosting branch as well until the service's branch is changed in the Render dashboard. Automatic deploys also require repository authorization in Render: inspect the live commit instead of assuming every push was deployed. The Render connector cannot edit that setting; do not create another service or enable paid resources to work around it.

Set `DATABASE_URL` privately to the existing production Neon connection string. Do not copy it into Git, logs or the browser. Hosted startup refuses to run without it and never falls back to SQLite. The database schema, account IDs, password hashes, verification links and existing server-side sessions stay unchanged. Browser cookies are scoped to the new hostname, so users must sign in once there.

`RENDER_EXTERNAL_URL` supplies the fixed public origin. An optional `PUBLIC_ORIGIN` overrides it for a custom HTTPS domain; request headers never select trusted origins. Cookies remain `__Host-…; Secure; HttpOnly; SameSite=Lax`. Existing POST-only APIs, origin checks, rate limits and admin authorization remain in place.

`/overrides.json` fetches the fixed GitHub Pages source with `no-store`, so admin schedule changes do not wait for a Render rebuild. Private server files, database files and environment files remain outside the static allowlist.

Free Render services sleep after 15 idle minutes and can take about one minute to restart. The GitHub Pages entry loads independently. The user chose daytime warmup to avoid exhausting the shared 750 monthly Free instance hours across three services. Two cron-job.org jobs in the user's account send HEAD requests to the public manifest in the Asia/Yekaterinburg timezone: `50,55 6 * * *` (prewarm) and `2,7,12,17,22,27,32,37,42,47,52,57 7-22 * * *` (daytime). The standalone `scripts/keep-render-awake.mjs` performs the same check when run manually. GitHub Actions is not used as a keepalive service. No database operation or credential is sent. Outside the window the account site can still start slowly. Scheduled requests and Render restarts are not guaranteed to be instantaneous. Existing durable rate limits use the socket address in this standalone mode, so people behind the same reverse proxy can share a bucket; no unverified forwarding header is trusted.

Verification: `npm ci`, `npm test`, `npm run build`, then the deployment's `scripts/smoke-cloud.mjs` check and a real browser registration/refresh/logout using a synthetic account. Check the actual service URL without VPN before updating the Pages link.

Verified 2026-10-27: 56 application tests after preserving concurrent admin changes; 24 admin-client tests; deployed HTTP register/login/session/profile/grades/logout, Secure/HttpOnly cookie, private file denial, hostile-origin rejection, admin preflight and unauthenticated rejection, current overrides, and browser register/refresh/logout. User confirmed the actual service login page without VPN. Admin client and CSP now use the Render API. No real student links or credentials were used in tests. Both Pages publications succeeded; the published account link opens the working Render login form.

The rejected Neon `accounts` function is a fixed JSON connectivity probe only, without credentials or account operations. It was not made the account backend because the user reported it was unavailable without VPN.
