# Registered accounts and unified admin login

Admin: https://wtfhoshi.github.io/tkpst-admin/#users

The source checkout is ../tkpst-admin. Its encrypted private GitHub config is the authoritative people directory. It contains people, courses and attendance, not subject grades. This integration copies minimal directory fields only; grades remain explicitly disconnected.

## Common session

All three admin sections now use the same vault-based role login and form. Administrator/starosta/curator passwords remain unchanged. Administrator login also verifies the admin vault entry on Vercel in that same submission and stores the resulting bearer inside the existing admin_session, with the same remember choice and maximum one-day expiry. No password or derived password key is persisted. One common logout clears all role/session credentials before awaiting server revocation. Other roles can use schedule/attendance, and see an explicit Users permission state.

Old remembered administrator sessions without a server bearer require one common re-login after deployment. Normal student LK username/password accounts remain separate.

## Directory synchronization

Password authentication now depends only on the vault, so a newly initialized directory can be created from Attendance after login. Users initially require a successful directory sync. The existing browser backend decrypts the private config using its existing GitHub/data credentials. Before reading that source, the client obtains a one-use sync ticket bound to its server-verified admin session. A durable SQL clock assigns strictly increasing markers, including requests in the same millisecond. Tickets expire after60seconds, cannot be replayed or used by another session, and order snapshot replacement even when source responses return out of order. Stale snapshots return409. Invalid snapshots do not mutate the roster. Source failure cannot be bypassed by retry/search/filter/refresh to use an old snapshot.

The protected sync endpoint receives only config for validation and minimal storage. GitHub tokens, encryption keys, password and attendance marks are never sent in a sync or persisted by the cloud service. Every authorized API call rechecks the public vault fingerprint. The origin is pinned, student cookies cannot authorize administrative operations, and authentication uses durable IP/global limits.

## Users workflow

Search matches login, registration name and verified directory name. Filters apply across every page, not only visible rows. Each account expands to show its student link, selection control and explicit inline confirmation. Administrator checks identity and confirms; an entered registration name never verifies anyone automatically. One course/student is linked to at most one account. The linked student's own LK shows verified name/group/course. Unlinking, removal or withdrawal removes verification after current directory synchronization.

## Verification

Application suite51/51 and admin suite24/24 pass. Tests cover cryptography, rights isolation, vault rotation/expiry, common-session restore, logout/role races, missing directory on first login, one-day lifetime, ticket ownership/replay/order, stale snapshots, validated atomic sync, Unicode/literal search, global filters and pagination, linking conflicts and withdrawal.

Isolated browser fixture test/preview.mjs serves real admin frontend modules against synthetic local vault/GitHub/API services. Browser checks covered login+remember, filters, Users→Attendance→Users without password, reset of filter state, page reload preserving login, explicit inline linking, global logout and curator access restriction. Desktop/mobile layouts were visually checked. Real production roster/account links were not changed by testing.

Neon project fancy-butterfly-66288752; migration test branch br-polished-cake-b9f6u0pp, min/max0.25CU on the existing free plan. Additive sync clock/ticket schema tested there before production. No paid resources enabled.
