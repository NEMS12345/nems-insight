# Launching & testing NEMS Insight

A practical runbook to stand the app up against a real Supabase project, smoke-test it with
your data, and deploy to Vercel.

Prerequisites: Node 20+ (you have it), a Supabase account, a Vercel account, and the repo
checked out on the `claude/inspiring-cori-mXqLo` branch.

---

## 0. Security first (do this once)
A database password was committed to git history early on. **Rotate it now** if you haven't:
Supabase → Project → **Settings → Database → Reset database password**. Never put secrets in
the repo; they live in `.env.local` (git-ignored) and Vercel env vars.

---

## 1. Create the Supabase project
1. supabase.com → **New project** (choose a region close to you, e.g. Sydney).
2. Once it's up, grab three values from **Settings → API**:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only; never expose)

## 2. Apply the database schema
In Supabase → **SQL Editor**, run each migration **in order** (paste the file contents and
Run), `0001` → `0011`:

```
supabase/migrations/0001_initial_schema.sql      ← hierarchy + RLS + auth roles
supabase/migrations/0002_ingestion.sql           ← interval data + import audit + raw files
supabase/migrations/0003_rollups.sql             ← portfolio energy views
supabase/migrations/0004_bills.sql               ← bill capture
supabase/migrations/0005_meter_serial.sql        ← multiple meters per NMI
supabase/migrations/0006_metering_point_tariff.sql ← per-NMI tariff code
supabase/migrations/0007_loss_factors.sql        ← per-NMI MLF/DLF
supabase/migrations/0008_market_price.sql        ← ASX futures input
supabase/migrations/0009_site_floor_area.sql     ← optional floor area
supabase/migrations/0010_emissions_factor.sql    ← editable NGA factor
supabase/migrations/0011_retail_plan.sql         ← per-NMI retail pricing
```

(Or, if you use the Supabase CLI: `supabase link --project-ref <ref>` then
`supabase db push`.)

## 3. Create the file-storage bucket
Storage → **New bucket** → name `raw-files`, **uncheck Public**. Then in the SQL Editor add
the access policies so operators can read/write within their client's folder:

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

## 4. Create your operator login + seed
1. Authentication → **Users → Add user**: email `info@nems.au` (or edit the email in
   `supabase/seed/seed.sql` first), set a password, and **confirm** the user.
2. SQL Editor → run `supabase/seed/seed.sql`. It links that user to an organisation as an
   operator and adds a sample client/site/NMI.

---

## 5. Run it locally
```bash
cp .env.example .env.local      # then paste your three Supabase values into .env.local
npm install
npm run dev                     # http://localhost:3000
```

Sign in at `/login` with the operator email/password from step 4.

### Smoke test (≈10 minutes, using your real files)
1. **Portfolio page** — you should see the seeded "Acme Manufacturing" client. Enter today's
   **ASX QLD futures** ($/MWh) and optionally the **NGA factor**.
2. Open the client → its site → **add a metering point (NMI)**:
   - For the warehouse NEM12: NMI `6123456789`, tariff **7200**, leave MLF/DLF blank.
   - For the Origin/office data: NMI `QB04077571`, tariff **7400**, MLF `1.0106`, DLF
     `1.04388`, and add one metering point **per meter serial** (e.g. `211261816`, …).
3. On the **site page → Import interval data**, drag in the file:
   - `NEM12_INDWAREHOUSE_FY2025.csv` (matches NMI 6123456789), or
   - the `Interval_data__QB04077571.xlsx` meter-profile export.
   You should see the import land (status *parsed*), reading counts appear per NMI, and the
   import history populate.
4. Click the NMI → you get **analytics, modelled cost, and reconciliation**. Enter the
   **retail plan** for that NMI (the Origin rates are pre-filled as the default). Optionally
   add a **bill** (ex-GST total) to see match / review / investigate.
5. Click **Client report →** for the print-optimised deliverable; **Print / Save as PDF**.

If an import fails: check the bucket exists and its policies (step 3); if the report's retail
benchmark shows "on hold", set the futures price (step 5.1).

---

## 6. Deploy to Vercel
1. Push the branch (already done) and in Vercel → **New Project → import the GitHub repo**.
2. **Environment Variables** — add the same three from `.env.local`
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
3. Framework preset **Next.js**, build command `npm run build` (default). Deploy.
4. In Supabase → Authentication → **URL Configuration**, add your Vercel domain to the
   allowed redirect/site URLs.

Choose the branch to deploy from (a `main` that mirrors this branch is cleanest — see below).

---

## Notes
- **Which branch ships:** all the work is on `claude/inspiring-cori-mXqLo`; `main` is still the
  bare scaffold. Before launch, make this branch `main` (merge/PR, or fast-forward) so Vercel's
  production deploys track it.
- **Pre-flight checks** (run locally before deploying): `npm run typecheck`, `npm run lint`,
  `npm run test`, `npm run build` — all should pass.
- **Data realities to confirm before client-facing use:** the current NGA factor, real retail
  contract rates per NMI, and Origin's actual peak/off-peak window (assumed 7am–9pm weekdays).
