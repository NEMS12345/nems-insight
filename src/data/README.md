# `src/data` — the only layer that talks to Supabase

All database and storage access lives here. No other layer imports the Supabase client
directly. The core (`src/core`) never touches this layer at all — it receives plain data.

- `repositories/` — typed functions like `getClients()`, `saveReadings()`. The rest of the
  app calls these, not raw queries.
- `supabase/` — client setup and RLS-aware helpers.

**Multi-tenancy:** every client-owned row carries a `client_id`, and Supabase Row-Level
Security enforces isolation at the database. v1 operators get a role that sees all clients;
the read-only client view and a future self-serve tier are narrower roles on the same
policies (see CLAUDE.md §3).
