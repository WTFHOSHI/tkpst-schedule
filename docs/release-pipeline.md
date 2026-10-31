# Unified release

The single workflow in .github/workflows/build.yml runs Node/browser tests, Android tests/APK build and iOS tests/IPA build. Only main can deploy. Deployments are serialized and never interrupted mid-release. API publishes first, then the Worker built from the tested artifact, then Pages. Public version.json files must match the tested Git SHA before APK/IPA become a release. A failed deployment stops the release; the Actions artifacts remain available for diagnosis. This is sequential deployment, not a distributed atomic transaction: already published services are not automatically rolled back on a later failure.

## One-time credentials

In repository Settings → Secrets and variables → Actions add:
- CLOUDFLARE_API_TOKEN: Workers Scripts edit token restricted to the existing Telling Math account (96e67c17fe64e93d934322bc6cbdbe71); no billing/DNS access is needed for this workers.dev deployment.
- VERCEL_TOKEN: deployment access to the existing miryzzzs-projects team and tkpst-schedule project. The workflow uses existing project/environment configuration and does not export database secrets.

Enter tokens directly into GitHub, never into chat or a tracked file. Credentials appear only in the relevant deployment steps. PR runs have no deployment credentials and cannot publish. Keep main restricted to reviewed changes. If setup is missing, the deploy job fails before changing any service. Once secrets are added, rerun failed jobs on the same workflow run; tested artifacts and the release number remain the same.

The deployment tools are pinned to Wrangler 4.156.0 and Vercel CLI 65.9.0. Project and account IDs in the workflow are public identifiers, not tokens. CI credentials should be rotated/revoked independently of local OAuth logins.

## Recovery policy

As explicitly selected by the owner, recovery takes login and new password only. It does not verify account ownership. Anyone knowing a login can reset that account. This tradeoff was discussed and intentionally chosen; do not mistake rate limits or same-origin checks for proof of ownership. Passwords remain hashed and never appear in responses. Reset revokes all old sessions atomically and also prevents an already in-flight old-password login from establishing a new session. Existing directory links and attendance stay intact. Production verification must never reset a real student's account.

## Diagnostics

Settings → Сообщить об ошибке previews a user-editable message. Automatic fields are limited to native/web version, commit, OS and WebView/engine version. Account fields, cookies, tokens, storage, page URL and console logs are not read or included. Copy/share occurs only on the user's button click. There is no automatic remote report submission. Older installed APK/IPA without the new native bridge report a web version and browser engine; installing the new native version adds exact package build information.
