# Changelog

## 2026-01-02

### Changed
- **Workout tab (Start Workout)**: routine-day cards are now ordered strictly by day label in ascending order (Day 1, Day 2, Day 3, ...). This avoids the previous primary ordering by `created_at`, which could produce incorrect ordering (e.g., Day 10 before Day 2).
- Sorting is independent of the routine name, so renaming a routine does not affect the routine-day's assigned day/week slot.

### Notes
- No schema changes or data migrations were required.
- No UI redesign or unrelated refactors were introduced.
