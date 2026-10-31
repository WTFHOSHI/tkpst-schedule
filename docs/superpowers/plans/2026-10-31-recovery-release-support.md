# Recovery, releases and support

Implement the user's explicitly selected login + new password reset. No email, recovery code or administrator. This intentionally allows anyone knowing a login to reset it (discussed and explicitly requested). Retain same-origin POST, bounded hashing and throttling; atomically revoke every session of the reset user. Never reset a real user in deployment checks.

- [ ] Reset API/storage/client/form; test SQLite/Postgres transactions, revocation, CSRF and bounds.
- [ ] Allowlisted diagnostics: native app version, web version/commit, platform/OS/WebView version; explicit preview, copy/share; no account data, storage, path or logs.
- [ ] Single workflow: tests and native builds, deploy API then Worker then Pages, verify commit metadata, publish APK/IPA. Dedicated scoped CI credentials in GitHub secrets only; no credentials in code/artifacts.
- [ ] Verify locally, independent final review, push/deploy and collect new releases. Document any CI-credential activation step honestly.
