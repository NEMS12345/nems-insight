# NEMS Insight

Energy monitoring and analysis for Australian commercial & industrial (C&I) businesses.

NEMS Insight ingests a client's meter data (NEM12) and retailer bills, then surfaces
consumption, demand/peak, power factor, tariff and network-charge analysis, and cost
breakdowns across a portfolio — with drill-down to site and metering-point level. Its
headline capability is **reconciliation**: comparing the cost modelled from interval data
against what was actually billed, to catch billing errors and assess whether a client's
energy arrangement is good or bad.

It is **operator-first**: the primary users are the managed-service team; clients get a
clean, read-only reporting view. It is not a self-serve public SaaS — but it's architected
so a self-serve tier can be added later without a rebuild.

> **For the full brief, architecture rules, data model, scope, and conventions, read
> [`CLAUDE.md`](./CLAUDE.md).** That file is the source of truth.

## Tech stack

- Next.js + TypeScript + Tailwind
- Supabase (Postgres, auth, storage)
- Deployed on Vercel

## Architecture (three layers)

```
(1) Ingestion  ->  (2) Analytics / calculation core  ->  (3) Presentation / reporting
```

The calculation core (`src/core`) is **pure TypeScript** — no Supabase, Next.js, or React
imports. This keeps the money logic portable and testable, and is what lets a self-serve
tier bolt on later. The rule is enforced by ESLint. See `CLAUDE.md` §3–4.

```
src/
  core/        pure analytics + tariff/cost engine
  ingestion/   parsers + validators (NEM12 first)
  data/        the only layer that talks to Supabase
  app/         Next.js routes — (operator) console + (client) read-only view
  components/  shared UI
supabase/      migrations + seed
tests/
```

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (never commit real secrets)
cp .env.example .env.local
# then fill in your Supabase values in .env.local

# 3. Run the dev server
npm run dev
```

Open http://localhost:3000.

### Database setup (Phase 1)

The schema lives in `supabase/migrations/` and is the source of truth.

1. In your Supabase project, run the SQL in `supabase/migrations/0001_initial_schema.sql`
   (SQL editor, or `supabase db push` if you use the Supabase CLI).
2. Create your operator login: **Authentication → Users → Add user** (email + password).
   Use the same email referenced in `supabase/seed/seed.sql` (default `info@nems.au`).
3. Run `supabase/seed/seed.sql` to link that user to an organisation as an operator and
   create a sample client/site/NMI.
4. `npm run dev`, sign in at `/login`, and you can create **client → site → NMI**.

### Ingestion setup (Phase 2)

1. Apply `supabase/migrations/0002_ingestion.sql` (interval data + import audit + raw files).
2. Create a **private** Storage bucket named `raw-files` (Storage → New bucket, uncheck
   public), then add policies so operators can read/write within their client's folder:

   ```sql
   insert into storage.buckets (id, name, public)
     values ('raw-files', 'raw-files', false) on conflict (id) do nothing;

   create policy "operators read raw files" on storage.objects
     for select to authenticated
     using (bucket_id = 'raw-files'
            and can_operate_client((storage.foldername(name))[1]::uuid));

   create policy "operators write raw files" on storage.objects
     for insert to authenticated
     with check (bucket_id = 'raw-files'
                 and can_operate_client((storage.foldername(name))[1]::uuid));
   ```

3. On a site page you can now **upload a NEM12 file**: it's parsed (all channels, with
   quality flags), the original is kept in Storage, readings land against the matching
   NMIs, and every upload is recorded in the import history.

### Portfolio rollups (Phase 5)

Apply `supabase/migrations/0003_rollups.sql`. It adds RLS-respecting views
(`metering_point_energy`, `site_energy`, `client_energy`) that aggregate consumption up
the hierarchy, so the portfolio / client / site pages show energy totals and let you drill
down portfolio → client → site → NMI → analytics.

### Useful scripts

```bash
npm run dev        # start the dev server
npm run build      # production build
npm run lint       # eslint (incl. the core-purity boundary rule)
npm run typecheck  # tsc --noEmit
```

## Conventions

- Australian spelling, AUD, AU regulatory context.
- Small, reviewable commits with clear messages.
- Secrets live in `.env.local` (git-ignored) and Vercel env vars — never in the repo.
