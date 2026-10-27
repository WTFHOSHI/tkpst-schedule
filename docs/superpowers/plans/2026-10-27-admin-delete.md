# Delete account and student

User explicitly requested both account deletion in Users and student deletion in Attendance.

- Users: administrator-only protected POST delete-user with id and typed confirmation matching current username. SQL delete atomically cascades sessions and student link; source student/attendance remain. Cancel/no authorization/wrong confirmation/stale id never delete. No real accounts deleted during testing.
- Attendance: retain reversible Remove and add administrator-only Delete permanently. Require typed exact current full name. Replace source student with an anonymous tombstone preserving id and historical from/to bounds, so old marks remain meaningful in historical reports without the original full name. Tombstones cannot be restored/renamed and are hidden from student management lists. They are excluded from LK directory sync; removed source links are cleared atomically in Neon. The LK account itself remains unless independently deleted.
- Source delete saves encrypted config first, then refreshes LK directory. Partial sync failure is clearly reported with retry, never reported as fully synchronized.

## Work

- [ ] Failing tests for protected account deletion/cascade/confirmation and source tombstone/history/role guard.
- [ ] Implement both store/service/source paths and inline confirmation UI, matching existing style.
- [ ] Run suites, review, synthetic desktop/mobile browser QA; publish both repos and verify live unauthorized API + published assets.
