# `src/core` — Layer 2: analytics + tariff/cost engine

**This is the most protected layer in the codebase.** It is **pure TypeScript**: data in,
numbers out. It must NOT import Supabase, Next.js, React, or anything from `data/`,
`ingestion/`, `app/`, or `components/`. An ESLint rule enforces this (see CLAUDE.md §3).

Why: keeping the money logic pure makes it portable and easy to unit-test, and it's what
lets a self-serve tier be added later without a rebuild.

- `analytics/` — consumption, demand/peak, power factor, load profiles.
- `tariff/` — the tariff + cost engine. **Tariffs are DATA, not `if/else` code** — the
  engine applies a tariff definition to interval data. Adding a new network later means
  adding a tariff definition, not editing the engine. (Energex only in v1.)
- `types/` — shared domain types (the vocabulary every layer uses).
