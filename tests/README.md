# `tests`

The calculation core (`src/core`) gets the most test coverage — it's where the money logic
lives (demand, power factor, tariff cost, reconciliation). Because the core is pure
TypeScript with no framework or DB dependencies, it's straightforward to unit-test.

A test runner (Vitest) will be wired up in Phase 1. See CLAUDE.md §7.
