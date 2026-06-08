# CLAUDE.md — NEMS Insight

This file is the single source of truth for what NEMS Insight is, the decisions we've
made, and the rules anyone (human or AI) must follow when working in this repo. Read it
before writing code. Keep it up to date as decisions change.

---

## 1. What NEMS Insight is

An energy monitoring and analysis tool for **commercial & industrial (C&I)** businesses,
single or multi-site (Australian context — AU spelling, AUD, AU regulatory rules). It
helps businesses understand and act on their energy use: consumption, demand/peak, power
factor, tariff and network-charge analysis, cost breakdown, and performance across sites.

**Delivery model — operator-first.** The primary user is the founder and their team,
operating it across client sites as the backbone of a **managed service** (~18 clients at
maturity, not thousands). The secondary user is a clean, **read-only reporting view** that
can be given to clients. It is **NOT** a self-serve public SaaS in v1.

**The core job (v1):** ingest a client's meter data **and** their retailer bills, see
consumption / demand / cost / performance across their portfolio with drill-down to site
and metering-point level, **reconcile the modelled cost against what was actually billed**
to surface billing errors and judge whether the arrangement is good or bad, and export a
clean report to hand to the client.

**The headline feature is reconciliation** (modelled cost vs. billed cost). That's the
answer clients pay for; treat it as core, not a nice-to-have.

---

## 2. Tech stack (decided — do not re-litigate)

- **Next.js + TypeScript**, **Tailwind** for styling.
- **Supabase** for Postgres, auth, and file storage.
- Deployed on **Vercel**.
- Single Next.js app (NOT a monorepo). Layer boundaries enforced by folders + lint rules.

---

## 3. Architecture — three layers, one rule that matters most

```
(1) Ingestion  ->  (2) Analytics / calculation core  ->  (3) Presentation / reporting
```

**THE RULE:** The **core (Layer 2) must be pure TypeScript** — no imports of Supabase,
Next.js, React, or any knowledge of who is logged in. It takes data in, returns numbers
out. This is enforced by an ESLint `no-restricted-imports` rule on `src/core/**`.

Why it matters: if the calculation/tariff engine reaches into the database or assumes "an
operator is driving," the layers are welded together and adding a self-serve tier later
means surgery. If the core is pure, self-serve is just a different front door pointing at
the same core.

### The other no-rebuild decision: multi-tenancy from day one
Even though only operators log in for v1, we build proper tenant isolation **now**:
- Every client-owned row carries a `client_id`.
- Supabase **Row-Level Security (RLS)** enforces "see only your client's data" at the DB.
- v1 operators get a role that sees **all** clients. The read-only client view and a future
  self-serve tier are just **narrower roles** hitting the **same** policies.

Retrofitting tenancy into a single-tenant DB is the classic expensive rebuild. We avoid it
by doing it up front while greenfield.

### The write-path trust boundary (closing the RLS hole)
RLS protects the **read** path. It does **not** protect the write path when the server uses
the **service-role key**, which **bypasses RLS entirely**. Ingestion runs server-side with the
service role (it must, to write on the operator's behalf), so RLS alone cannot guarantee that a
derived row (e.g. an `interval_reading`) is stamped with the *correct* `client_id`. State this
plainly: **the write-side guarantee is NOT RLS.** It is three things working together:

1. **`client_id NOT NULL` on every client-owned table** — a row with no tenant can't be written.
2. **Composite foreign keys that chain `client_id` down the hierarchy** — a child row's
   `client_id` must match its parent's, enforced by the DB, so a derived row cannot be
   misattributed to the wrong client even by buggy server code.
3. **An ingestion assertion** that every derived row carries the operator-selected `client_id`
   (defence in depth above the FK chain).

Because the service role bypasses RLS, the service-role client is confined to `src/data/**`
(see §8; an ESLint rule enforces it). Everything else goes through repositories.

**Canonical migration SQL pattern (the Phase 1 spec — build to this):** every client-owned
table denormalises `client_id` and the FK to its parent is composite, including `client_id`:

```sql
-- Parent of the chain. client_id is the tenant key; UNIQUE(id, client_id) lets children
-- reference it compositely.
create table client (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisation(id),
  name        text not null,
  -- ...
  unique (id)                     -- id is already unique (PK); see composite targets below
);

create table site (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references client(id),
  name        text not null,
  -- ...
  unique (id, client_id)          -- composite target for children
);

create table metering_point (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null,                       -- denormalised down the hierarchy
  site_id     uuid not null,
  nmi         text not null,
  -- ...
  foreign key (site_id, client_id)                 -- COMPOSITE FK: child client_id must
    references site (id, client_id),               -- equal the parent's client_id
  unique (id, client_id)
);

create table interval_reading (
  id                 bigint generated always as identity primary key,
  client_id          uuid not null,                -- denormalised to the leaf
  metering_point_id  uuid not null,
  channel            text not null,
  interval_start     timestamptz not null,
  -- ...
  foreign key (metering_point_id, client_id)       -- COMPOSITE FK chains client_id to the leaf
    references metering_point (id, client_id)
);
```

The chain is `client(id) ← site(id, client_id) ← metering_point(id, client_id) ←
interval_reading(metering_point_id, client_id)`. Bills follow the same pattern
(`bill`/`bill_line_item` carry `client_id`, composite-FK'd to their parent). RLS policies on
top of this restrict reads by `client_id`; the composite FKs + NOT NULL keep writes honest.

---

## 4. Repo structure

```
src/
  core/          LAYER 2 — pure analytics + tariff/cost engine. NO framework/DB/other-layer imports.
    analytics/     consumption, demand/peak, power factor, load profiles
    tariff/        tariff + cost engine (data-driven; tariffs are DATA, not if/else code)
                     schema/  general DNSP tariff schema + validator + per-DNSP schedules
    reconciliation/ component-wise modelled-vs-billed comparison (the headline feature)
    time/          the ONLY place timezone conversion happens (NEM time <-> absolute <-> site-local)
    types/         shared domain types (Client, Site, MeteringPoint, IntervalReading...)
  ingestion/     LAYER 1 — messy data -> clean, validated readings
    parsers/       one adapter per format (NEM12 first)
    validators/    quality checks, gap detection
  data/          The ONLY place that talks to Supabase (repositories + client setup)
  app/           LAYER 3 — Next.js routes
    (operator)/    full operator console (v1 primary user)
    (client)/      read-only client reporting view (v1 secondary user)
  components/    LAYER 3 — shared React/Tailwind UI
supabase/
  migrations/    DB schema as versioned SQL (source of truth for the schema)
  seed/          sample data for local dev
tests/           core gets the most tests — it's where the money logic lives
```

The entire self-serve story lives in two places only: `app/(client)/` becomes a portal,
and RLS roles widen. `core/`, `ingestion/`, and `data/` should not need to change. That is
the test of whether the separation is right.

---

## 5. Data model

Hierarchy: **organisation -> client (portfolio) -> site -> metering point (NMI) -> interval data.**

| Table | Holds | Key fields |
|---|---|---|
| `client` | A customer business (the portfolio) | name, ABN, status, `org_id` |
| `site` | A physical premises | name, address, DNSP/network, state, `client_id` |
| `metering_point` | The NMI / parent meter | NMI, `meter_type`, `site_id` |
| `interval_reading` | The time-series | `metering_point_id`, `channel`, `interval_start` (timestamptz), `interval_length`, `value`, `unit`, `quality_flag` |
| `import_batch` | One row per uploaded file | uploader, time, detected format, status, row counts, errors |
| `raw_file` | Original uploaded file, kept verbatim in Supabase Storage | so we can re-parse from source |

**Every client-owned table carries `client_id NOT NULL`, denormalised down the hierarchy, with
composite foreign keys chaining `client_id` from `client` to the leaf** (`site`,
`metering_point`, `interval_reading`, `bill`, `bill_line_item`). This is the write-side tenant
guarantee — see §3 for why (the service role bypasses RLS) and the canonical migration SQL.

**Tariffs are DATA-IN-CODE, not DB tables** (`src/core/tariff/energex.ts`): a `Tariff` is a
declarative list of charges (fixed/energy-ToU/monthly-demand) + time-of-use window
definitions, which the pure engine (`src/core/tariff/engine.ts`) applies to interval data.
Adding a network/retailer = adding a `Tariff` value, not changing the engine.

Bills ARE tables (operator-entered facts):

| Table | Holds | Key fields |
|---|---|---|
| `bill` | One entered retailer bill | `client_id`, `metering_point_id`, retailer, `tariff_code`, period, `billed_total` (ex-GST) |
| `bill_line_item` | Optional bill breakdown | `bill_id`, `client_id`, label, category, amount |

Reconciliation compares the modelled cost (engine over interval data for the bill's period +
tariff) against the billed cost. A total-level check lives in
`src/core/tariff/reconciliation.ts`; the forward-looking **component-wise** check is
`src/core/reconciliation/` — a canonical bill-component taxonomy, each component tagged
modelled vs declared pass-through, returning per-component variance ($ and %), a modelled-only
bottom line (pass-through excluded), and a confidence downgrade on heavily-estimated months,
flagging match / review / investigate. Two Energex tariffs are modelled: **7200** (SAC Large TOU,
kW demand) and **7400** (11kV TOU Demand, kVA demand) — each metering point records its
`tariff_code`. The 7400 network rates + the **Origin retail rates** layered on top are
derived from a real Origin invoice. Retail energy is true TOU (peak assumed 7am–9pm
weekdays pending Origin's contract windows); loss factors (MLF/DLF) are stored per NMI and
applied explicitly per charge (energy = MLF×DLF, environmental/regulated = DLF, network
volume = none). Shape-independent charges reproduce the invoice to the cent; retail energy
tracks the actual load shape.

### Domain realities baked into the model (do not "simplify" these away)
1. **A metering point has multiple channels per interval**, not one number. NEM12 carries
   E1 (consumption), B1 (export/solar), Q1 (reactive). Reactive is required for **power
   factor**; export is required for solar sites. So readings are keyed by
   **(metering_point, channel, timestamp)**.
2. **Quality flags are first-class.** Real C&I data has estimated/substituted/missing
   intervals (NEM12 quality codes A/S/F/E/N). Never treat estimated data as actual —
   reports must be able to flag "this period is X% estimated."
3. **`meter_type` is a field, not a hardcoded assumption.** v1 = NMI/parent meter only,
   but the abstraction stays general so other meter types can be added later.
4. **Demand definition comes from the tariff, not hardcoded.** The engine reads the demand
   rule (window, kVA vs kW) from the network tariff config.
5. **Time is stored as absolute instants; time-of-use is judged in local clock time.**
   Interval timestamps are stored as absolute instants (Postgres `timestamptz`). Incoming
   NEM12 timestamps are interpreted in ONE documented **source basis**, defaulting to
   **NEM time = AEST (UTC+10, no daylight saving)** — the market basis NEM12 is recorded
   in. Time-of-use windows are then evaluated in the **site's LOCAL clock time** via an
   IANA `timezone` on the site (e.g. `Australia/Brisbane`), so ToU bucketing stays correct
   across daylight-saving transitions in DST states (NSW/VIC/ACT/TAS/SA). QLD (and WA/NT)
   do not observe DST, so for Energex/SE-QLD sites local time == NEM time year-round.

### Time-handling note (single source of truth)
All timezone conversion lives in **`src/core/time`** — nowhere else converts between
zones. It exposes the NEM-time constant/basis, `nem12IntervalToInstant(date, index,
length, basis?)` (NEM12 calendar day + interval index → absolute instant; the source
basis is an explicit parameter defaulting to NEM time), and `instantToLocalParts(instant,
timezone)` (absolute instant → site-local wall-clock parts for ToU bucketing). The basis
is configurable for the rare local-time-recorded source. Tested across Australia/Sydney
spring-forward + fall-back days and Australia/Brisbane (no DST). The legacy fixed-+10
helpers in `src/core/analytics/time.ts` are being superseded by this module.

---

## 6. v1 scope (be ruthless — cut, don't add)

### IN v1
1. Multi-tenant foundation (hierarchy + RLS + operator role).
2. **Interval ingestion** — drag-and-drop upload, one adapter per format: **NEM12**
   (.csv/.dat) and the tabular **30-minute meter-profile export** (.xlsx). All channels
   (E/B/Q), gap detection, quality flags, original file retained, import audit trail.
   Sources may identify several meters under one NMI; each meter serial is its own metering
   point (`metering_point.meter_serial`) — a general extension, NOT sub-metering/allocation.
3. **Structured bill capture** — operator enters bill facts (retailer, tariff name, period,
   line items, total) via a form; original PDF stored for reference. **NOT automated PDF
   parsing.**
4. **Tariff + cost engine — Energex (SE QLD) only** — energy by time-of-use, demand per the
   tariff rule, fixed charges; cost computed from interval data. Tariffs are DATA. The
   tariff **schema** is general enough for any NEM DNSP (`src/core/tariff/schema/`):
   effective-dated, with standing/fixed charges, flat or seasonal time-of-use energy by
   day-type (weekday/weekend/public-holiday), kW/kVA demand with chargeable window, reset
   (monthly/annual) and ratchet, stepped/block rates, controlled-load (separate) tariffs and
   import/export direction. Only **Energex is populated** for v1; Ausgrid (NSW) and SA Power
   Networks are **structure-only fixtures** with clearly-marked placeholder figures (never
   fabricated pricing) — adding a real DNSP is a data edit, not an engine change. A
   `validateTariff` checker and a per-state public-holiday calendar (QLD populated) back the
   schema. The cost engine that consumes this schema is built in this phase (Phase 4).
5. **Reconciliation** — modelled cost vs. billed cost, **component by component**
   (`src/core/reconciliation/`): a canonical bill-component taxonomy (energy by ToU, demand,
   supply/fixed, other network, environmental certs, metering, market/AEMO fees, retailer
   fixed, GST, other), each tagged modelled vs declared pass-through. Pass-through lines are
   reported but excluded from the billing-error judgement; estimated-data % lowers confidence
   rather than manufacturing errors; dual ($ + %) tolerances. Discrepancies flagged. *Headline.*
6. **Analytics** — consumption, demand/peak, power factor, cost breakdown; portfolio
   rollup with drill-down to site and metering point.
7. **Client report / export** — one clean, print-optimised read-only deliverable
   (`app/(client)/report/[meteringPointId]`): summary + prioritised recommendations, usage
   profile (load factor, profile, data quality), cost breakdown, bill reconciliation,
   **network tariff check** (re-costs the load on each tariff and shows the switch saving,
   eligibility-flagged), and a **solar recommendation** (sized to minimise export; saving,
   payback, CO₂). Solar/tariff assumptions are explicit. Save-as-PDF from the browser.
8. **Two front doors, one core** — operator console + read-only client view via RLS roles.

### NOT in v1 (deferred / roadmap)
- Automated PDF bill parsing (manual structured entry instead).
- Arbitrary CSV auto-detection (NEM12 only; optionally one fixed NEMS-Insight CSV template).
- Any network except Energex (others become data entries later, not a rewrite).
- Sub-metering / allocation logic (explicitly out of scope).
- Other meter types (abstraction kept general, nothing built).
- Emissions/carbon, cross-client benchmarking, alerting, demand-response.
- Environmental certificate (LGC/STC) cost forensics (entered as flat bill line items).

### Deferred SELF-SERVE items (called out explicitly)
- Public signup / onboarding wizard, subscription billing, self-serve client admin,
  usage limits. None built — but RLS + the pure core mean they bolt on without a rebuild.

---

## 7. Phased build plan (each phase ends at something clickable)

| Phase | Build | "Done" |
|---|---|---|
| 0. Scaffold | Repo, layers, CLAUDE.md, README, env, Supabase wiring | Clean repo to review |
| 1. Data foundation | Schema + migrations, RLS, auth, operator login, seed | Log in, create client → site → NMI |
| 2. NEM12 ingestion | Parser (all channels), upload, validation, gap/quality flag, raw storage, audit | Drag in a NEM12 file, see data land |
| 3. Analytics core | Pure, unit-tested: consumption, demand, power factor, load profile | See charts for a NMI/site |
| 4. Tariff + cost + reconciliation | General tariff schema + validator (DONE; Energex populated, others structure-only), bill entry, cost-from-intervals engine, component-wise computed-vs-billed | See where the bill disagrees |
| 5. Portfolio rollup | Client → site → metering-point nav and aggregation | See whole portfolio, drill down |
| 6. Client report | The clean read-only export | Hand a client a report — **MVP done** |

Ingestion (Phase 2) and the engine (Phase 4) get the most care and tests.

---

## 8. Working norms

- **Australian spelling, AUD, AU regulatory context.** (e.g. "optimise", "centre", "metre".)
- **Small, reviewable commits** with clear messages explaining what each does.
- **Pause and ask on real trade-offs** rather than guessing. The founder is a domain expert
  in metering/energy but NOT a software engineer — explain technical decisions in plain
  English.
- **Be opinionated.** Recommend specific patterns; push back if a choice looks wrong.
- **Be ruthless about scope.** Feature creep is the main risk. Always separate v1 from
  roadmap; help cut, not add.
- **Secrets never go in the repo.** Use `.env.local` (git-ignored) and Vercel env vars.
  See `.env.example` for required variables.
- **The service-role Supabase client lives ONLY in `src/data/**`.** It bypasses Row-Level
  Security, so it must never be imported by another layer — everything else goes through
  repositories. An ESLint rule enforces this (it may sit dormant until the
  `@/data/service-role` module exists). See §3 for the trust-boundary rationale.

---

## 9. Testing & tooling

- **Test runner: Vitest.** Run the suite with `npm test` (`vitest run`); `npm run test:watch`
  for watch mode. Tests live in `tests/**` mirroring the source layout, plus golden-file
  fixtures alongside the code they exercise.
- The pure core (`src/core/**`) and ingestion (`src/ingestion/**`) get the most tests — that
  is where the money logic lives. Aim for unit tests on every core module added.
- Other scripts: `npm run typecheck` (`tsc --noEmit`), `npm run lint` (`next lint`),
  `npm run build`. Keep all four green before committing.
- **Lint enforces two architecture boundaries** via `no-restricted-imports` (see
  `eslint.config.mjs`): (1) `src/core/**` stays pure — no framework/DB/other-layer imports;
  (2) the service-role Supabase client (`@/data/service-role`) may only be imported inside
  `src/data` (it bypasses RLS — see §3/§8).

