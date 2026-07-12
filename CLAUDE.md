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

### The write-path trust boundary
v1 ingestion is an **interactive operator action**: a logged-in operator uploads a file and the
server writes the derived rows **as that operator, under RLS** (the cookie-based `@supabase/ssr`
server client — see Auth below). So for v1 the write path **is** RLS-protected — every
client-owned table has a write policy `with check (can_operate_client(client_id))` that rejects a
write to a client the operator may not operate. That is the first line of defence.

It is **not the only** line, because RLS alone can't guarantee a *derived* row (e.g. an
`interval_reading`) is stamped with the *correct* `client_id` — only that it belongs to a client
the operator can touch. Three further things keep writes honest, and they hold **even if** a
future code path uses the **service-role key** (which **bypasses RLS entirely** — see below):

1. **`client_id NOT NULL` on every client-owned table** — a row with no tenant can't be written.
2. **Composite foreign keys that chain `client_id` down the hierarchy** — a child row's
   `client_id` must match its parent's, enforced by the DB, so a derived row cannot be
   misattributed to the wrong client even by buggy server code.
3. **An ingestion assertion** that every derived row carries the right `client_id` — the
   ingestion pipeline takes each reading's `client_id` from the **matched metering point**, never
   a guess (defence in depth above the FK chain).

**The service role is NOT used in v1.** It bypasses RLS, so it's reserved for any *future*
**non-interactive** ingestion (scheduled meter-data pulls, email-in, webhooks) where there is no
operator session to run as. When that arrives, the `@/data/service-role` client is created in
`src/data/**` and **confined there** (an ESLint rule enforces it — §8), and points 1–3 above
become the whole write-side guarantee in the absence of RLS. Until then there is no such module
and the guard sits dormant by design.

### Auth (v1 operator login)
Operators sign in with **email + password** via Supabase Auth, wired with **`@supabase/ssr`**
(cookie-based sessions: a browser client for sign-in, a server client that runs every query
**as the logged-in user** so RLS applies, and middleware that refreshes the session). Why this
shape: there are only ~18 operators in a managed service, so email/password (operators created
by the founder in the Supabase dashboard, no public sign-up) is the simplest thing that is
secure and needs no extra moving parts. We use `@supabase/ssr` rather than the older
`@supabase/auth-helpers-nextjs`, which Supabase has **deprecated** in favour of `@supabase/ssr`
— adopting the deprecated package would be a regression. If SSO/SAML is ever needed for a
larger operator team, that is a Supabase Auth configuration change, not an app rewrite — stop
and confirm before adding it. The service-role key is **not** used for v1 login or CRUD (those
run as the user, under RLS) and **not** by v1 ingestion either (that also runs as the operator
under RLS — see the write-path trust boundary above); it would only arrive with a future
**non-interactive** ingestion path, at which point the `@/data/service-role` module is created in
`src/data/**` and the dormant ESLint guard (§8) becomes active.

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
| `site` | A physical premises | name, address, DNSP/network, state, `timezone` (IANA, for local ToU), `client_id` |
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
*[v1.1 update: the rates now live in DB rows — see §5b. The engine is unchanged and still
prices the same pure `Tariff` shape; "tariffs are DATA" survives the storage move.]*

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

### Time-handling note (v1 basis + the forward path)
**As built, v1 buckets time-of-use in NEM time / AEST (UTC+10, no DST).** The analytics and
tariff engines classify ToU and day-type via the fixed-AEST helpers in
`src/core/analytics/time.ts` (`aestDate`, `aestMinuteOfDay`, `aestDayType`, `aestYearMonth`).
This is **correct for v1** because v1 is **Energex / SE-QLD only**, and QLD does not observe
daylight saving — so local clock time == NEM time year-round and ToU buckets are exact. It is a
**deliberate v1 simplification**, not the end state.

**The forward path is `src/core/time`** — a tested, IANA-timezone-aware module
(`nem12IntervalToInstant(date, index, length, basis?)` and `instantToLocalParts(instant,
timezone)`, verified across Australia/Sydney spring-forward + fall-back and Australia/Brisbane).
It is **built and tested but NOT yet wired in** (the `site.timezone` IANA field exists for it).
**When the first DST-observing DNSP is onboarded (NSW/VIC/ACT/TAS/SA), ToU bucketing must move
onto `src/core/time` so it evaluates windows in the site's local clock time** — at which point
that module becomes the single conversion path and the fixed-AEST helpers retire. Until then,
adding DST handling would be out-of-scope work for a QLD-only v1 (be ruthless — §8). Note this
means there is currently no live "single source of truth" for zone conversion; that rule
activates with the first DST jurisdiction.

### 5b. [v1.1] The monthly managed-service loop — data model

v1 proved the one-shot analysis. **v1.1 turns it into the recurring monthly loop the managed
service actually runs**: assign tariff + contract once → ingest each month's data behind a
quality gate → reconcile → operator reviews and signs off findings → chase confirmed errors
to recovered dollars → the portfolio page is the month's work queue. Everything is **per
billing period and re-openable** — it runs again next month.

**[v1.1] Decision change — tariff/contract rates move from code into editable DB records.**
v1 said "tariffs are DATA-IN-CODE". The managed-service loop needs the operator to add and
correct rates without a deploy, so rates now live in `network_tariff` / `retail_contract`
rows (each row carries the full rate set as JSON conforming to the pure `Tariff` /
`RetailPlan` shapes, plus effective dates and a source note). **The pure core does not
change**: the data layer loads a row, validates it into the same pure types, and the same
engine prices it — "tariffs are DATA, not if/else code" still holds; only the storage moved.
The code registry (`TARIFF_VERSIONS`, invoice-derived Energex 7200/7400) remains as the
**seed source and the golden-test fixture** — pure-core tests never touch the DB. Rate rows
are **superseded, never edited in place** once used by a reconciliation (add a new dated
version instead), so historical reconciliations stay reproducible.

**[v1.1] tables** (all client-owned tables carry `client_id NOT NULL` + composite FKs per §3;
`network_tariff` is org-level reference data, org-scoped not client-scoped):

| Table | Holds | Key fields |
|---|---|---|
| `network_tariff` | One dated DNSP rate-set version (org reference data) | `org_id`, code, name, dnsp, `effective_from`, `rates` (jsonb → pure `Tariff`), source note |
| `retail_contract` | One dated retail contract rate-set for a client | `client_id`, retailer, label, `effective_from`, `rates` (jsonb → pure `RetailPlan`), source/PDF ref |
| `tariff_assignment` | Which network tariff + retail contract price an NMI, from when | `metering_point_id`, `client_id`, `network_tariff_id`, `retail_contract_id`, `effective_from` |
| `reconciliation` | One reconciliation run of one bill (re-runnable) | `bill_id`, `client_id`, `metering_point_id`, period, modelled/billed totals, judgement, coverage, `signed_off_by`, `signed_at` |
| `reconciliation_finding` | One per-component variance from a run | `reconciliation_id`, `client_id`, component, modelled/billed/variance, `reason_code`, `status` (`open → confirmed_error \| queried \| dismissed \| within_tolerance`), operator note, client-facing recommendation |
| `recovery` | The chase on a confirmed error | `finding_id`, `client_id`, `state` (`to_raise → query_lodged → responded → recovered`), `amount_identified`, `amount_recovered`, retailer ref, dates |

`bill` / `bill_line_item` already exist (v1) and are unchanged; a `reconciliation` row now
records each run against a bill instead of the run being ephemeral page state.
`import_batch` gains `quality_summary` (jsonb: %A/S/F/E/N + gap count, emitted by the
validator) and `review_state` (`pending_review | accepted | needs_redata`). **The gate:**
readings from a batch that is not `accepted` must not feed cost or reconciliation
(`interval_reading.import_batch_id` makes this enforceable); estimated intervals are never
treated as actual. Existing pre-v1.1 batches are backfilled to `accepted` (the operator
already vetted them by using them).

**[v1.1] Modelling precondition:** a metering point **cannot be modelled until it has a
`tariff_assignment` with both a network tariff and a retail contract** — surfaced as a
blocking state in the UI, never a silent fallback. (Transition: existing NMIs get an
assignment auto-created from their `tariff_code` + `retail_plan` rows by the migration, so
nothing built in v1 breaks.) `retail_plan` is superseded by `retail_contract` +
`tariff_assignment`; its rows are migrated across and the table dropped.

**[v1.1] Workflow lives outside the core.** Review states, sign-off, recovery pipeline are
DB + `app/` concerns. The pure core only computes: `(modelled, billed) → findings with
reason codes` in `src/core/reconciliation` (extended, not duplicated). The client report
renders **only signed-off content** — export is gated on `signed_at`.

**[v1.1] Seed:** one worked example — Acme Foods → Rocklea DC → NMI on **Energex 7400**
(the invoice-validated tariff; the build prompt's "8100" is not modelled and no rates are
invented — adding 8100 later is a data row, not code), a retail contract, a June bill, and
a reconciliation with one confirmed demand-charge discrepancy.

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
   eligibility-flagged), a **solar recommendation** (sized to minimise export; saving,
   payback, CO₂), **operational findings** (overnight base load, out-of-hours energy,
   avoidable standing-load saving), a **retail-contract benchmark** (the contestable retail
   rate vs an indicative band built from an operator-entered ASX QLD futures price — NOT a
   scraped feed, NOT cross-client benchmarking), and an **electricity-emissions** summary
   (Scope 2 location + market, Scope 3 T&D/upstream, via NGA factors; method-stated estimates,
   not a carbon-neutral claim). Solar/tariff/benchmark assumptions are explicit. Save-as-PDF
   from the browser.
8. **Two front doors, one core** — operator console + read-only client view via RLS roles.

### [v1.1] IN — the monthly loop (extends v1; see §5b for the data model)
1. **Setup wizard** (`app/(operator)/setup/`) — client → site → NMI → assign network tariff +
   retail contract via `tariff_assignment` with effective dates. No assignment → NMI is in a
   blocking "cannot model" state, shown, not silent.
2. **Ingestion quality gate** — validator emits `quality_summary` onto `import_batch`;
   operator **accepts** or marks **needs re-data**; non-accepted batches feed nothing.
3. **Findings engine (pure)** — `(modelled, billed) → Finding[]` with per-line variance +
   reason code, in `src/core/reconciliation`. Unit-tested hard: matching lines, tolerance,
   demand-charge overcharge, missing/extra lines.
4. **Review & sign-off** (`app/(operator)/review/`) — triage each finding
   (`confirmed_error | queried | dismissed | within_tolerance`), operator note + client-facing
   recommendation, then sign off. **Client report renders only signed-off content.**
5. **Portfolio work queue** — the landing page becomes the month's close calendar: per client,
   new data to process, unreconciled bills, open recovery queries, stale data. Drill-down stays.
6. **Recover & track** (`app/(operator)/recovery/`) — per confirmed error:
   `to_raise → query_lodged → responded → recovered`, amounts, dates, retailer ref; portfolio
   "$ recovered" metric. This closes the value loop.

### NOT in v1 (deferred / roadmap)
- Automated PDF bill parsing (manual structured entry instead).
- Arbitrary CSV auto-detection (NEM12 only; optionally one fixed NEMS-Insight CSV template).
- Any network except Energex (others become data entries later, not a rewrite).
- Sub-metering / allocation logic (explicitly out of scope).
- Other meter types (abstraction kept general, nothing built).
- Cross-client benchmarking, alerting, demand-response. (NB: *electricity* Scope 2/3
  emissions DID ship in the report as method-stated estimates — see item 7; what stays out is
  full carbon accounting / other scopes / offset purchasing / any "carbon-neutral" claim.)
- Environmental certificate (LGC/STC) cost forensics (entered as flat bill line items).
- Multi-month trend reports (v1.1 is per billing period; trends are roadmap).

### Deferred SELF-SERVE items (called out explicitly)
- Public signup / onboarding wizard, subscription billing, self-serve client admin,
  usage limits. None built — but RLS + the pure core mean they bolt on without a rebuild.

---

## 7. Phased build plan (each phase ends at something clickable)

| Phase | Build | "Done" |
|---|---|---|
| 0. Scaffold | Repo, layers, CLAUDE.md, README, env, Supabase wiring | Clean repo to review |
| 1. Data foundation | Schema + migrations, RLS, auth, operator login, seed | Log in, create client → site → NMI — **✓ DONE** |
| 2. NEM12 ingestion | Parser (all channels), upload, validation, gap/quality flag, raw storage, audit | Drag in a NEM12 file, see data land — **✓ DONE** |
| 3. Analytics core | Pure, unit-tested: consumption, demand, power factor, load profile | See charts for a NMI/site — **✓ DONE** |
| 4. Tariff + cost + reconciliation | General tariff schema + validator (DONE; Energex populated, others structure-only), bill entry, cost-from-intervals engine, component-wise computed-vs-billed | See where the bill disagrees — **✓ DONE** |
| 5. Portfolio rollup | Client → site → metering-point nav and aggregation | See whole portfolio, drill down — **✓ DONE** |
| 6. Client report | The clean read-only export | Hand a client a report — **✓ DONE (v1 MVP)** |

Ingestion (Phase 2) and the engine (Phase 4) get the most care and tests.

**[v1.1] build order** (each step ends at something clickable; findings engine gets the tests):

| Step | Build | "Done" |
|---|---|---|
| 1. Schema | §5b tables + RLS, types, repositories, worked-example seed | Migrations apply; seed queryable |
| 2. Setup wizard | Assign tariff + contract per NMI; blocking unmodelled state | Assign an NMI end to end |
| 3. Quality gate | `quality_summary` + accept / needs re-data on batches | A non-accepted batch feeds nothing |
| 4. Findings engine | Pure `(modelled, billed) → Finding[]` + reason codes, unit-tested | Suite green on the money logic |
| 5. Review & sign-off | Triage findings, note + recommendation, sign off; report gated | Sign off a month; export unlocks |
| 6. Work queue | Portfolio page = monthly close calendar | See the month's outstanding work |
| 7. Recover & track | Recovery pipeline + "$ recovered" metric | Chase a confirmed error to recovered |

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

### Current state (what's actually built)
- **Foundational corrections done & green:** Vitest wired; `src/core/time` (the IANA-aware
  forward time module — **built & tested but not yet wired**; v1 buckets in fixed AEST, see §5);
  the general DNSP tariff schema + validator with Energex populated and Ausgrid/SAPN as
  structure-only fixtures; `src/core/reconciliation` (component-wise); the composite-FK/RLS
  write-path pattern + trust boundary recorded. 128 tests pass; typecheck, lint and build are
  clean.
- **Phase 1 (data foundation) done:** migrations `0001`–`0013` create the full hierarchy
  (organisation → client → site → metering_point → interval_reading, plus import_batch /
  raw_file / bills / tariff-support tables from later phases), with `client_id NOT NULL`,
  the composite-FK tenant chain, and RLS for both the operator and read-only client roles.
  Email/password operator auth via `@supabase/ssr` (see §3 Auth); repositories for client /
  site / metering_point in `src/data`; seed data; and an operator console that creates a
  client → site → NMI end to end. Build verified here; full click-through live-tested earlier.
- **Phase 2 (NEM12 ingestion) done:** pure parsers in `src/ingestion/parsers` — NEM12 (all
  channels E/B/Q, quality codes incl. variable-day 400 ranges, 5-/30-min intervals, DST
  spring-forward/fall-back handling in both market and local bases) and the tabular xlsx
  meter-profile export (each meter serial its own metering point); validators for gap detection
  and quality summary; the `import_batch` / `raw_file` / `interval_reading` schema + RLS
  (`0002_ingestion.sql`); repositories in `src/data` that store the original file, record an
  import-batch audit row, match readings to metering points and upsert them; and an operator
  upload form + import history on the site page. **Ingestion writes as the logged-in operator
  under RLS** (the user-context server client), with `client_id` stamped from the matched
  metering point — so the service-role module is not used (see the write-path trust boundary).
  Scope notes honoured: NEM12 matches one NMI to one metering point (no meter-serial split —
  that's the meter-profile format's job); the meter-profile source carries no quality codes so
  its rows are `actual`; the readings repository pages and caps at 200k rows per metering point.
- **Phase 3 (analytics core) done:** pure, unit-tested modules in `src/core/analytics` —
  consumption (`consumptionSummary`, `dailyConsumption`), demand (`demandByInterval`,
  `peakDemand`, `averageDemandKw`, `loadFactor`, `topDemandIntervals`), power factor
  (`periodPowerFactor`, `powerFactorAtPeakDemand` — returns `null`, never fabricated unity, when
  no reactive channel is present), and `loadProfileByTimeOfDay`. Wired into a charts UI on the
  operator metering-point page (`BarChart`). Buckets in fixed AEST (§5).
- **Phase 4 (tariff + cost + reconciliation) done:** the general DNSP tariff schema +
  `validateTariff` (Energex 7200/7400 populated; Ausgrid/SAPN structure-only) and a pure
  cost engine (`src/core/tariff`): `computeCost`/`computeFullCost`/`computeRetailCost`,
  `marginalEnergyRatePerKwh`, monthly-reset in-window demand (kW/kVA, honest kVA fallback via
  reactive→assumed-PF→kW), explicit loss factors, plus `eligibility`, `compare`, `benchmark`,
  `demand` (shave saving) and `retail`. **One ToU classifier** (`classifyPeriod` in
  `periods.ts`) is shared by engine/demand/retail — honouring the Phase 3→4 "one bucketing path"
  intent. Reconciliation: component-wise (`src/core/reconciliation`: taxonomy + `reconcile`,
  dual $/% tolerance, pass-through excluded from the error judgement, estimated-data → low-
  confidence) plus a total-level check (`src/core/tariff/reconciliation.ts`).
- **Headline feature wired end-to-end (component-wise reconciliation).** Earlier the
  component-wise engine existed and was tested but **nothing rendered it** — both UIs showed only
  the total-level `reconcile`, and bill entry captured only a single total, so there was no billed
  side to compare against. Now closed: the operator enters a bill as **canonical component
  buckets** (energy peak/shoulder/off-peak, demand, supply, metering, environmental, market,
  other) which persist as `bill_line_item` rows keyed by the taxonomy (`0014_bill_line_item_
  component.sql` adds `bill_line_item.component`). Each `CostLine` now carries its taxonomy
  `component`/`subKey`; `modelledComponents(CostResult)` maps the modelled cost to the same
  buckets (distributing a flat "all" energy charge across ToU by energy share), `billedComponents`
  maps the entered buckets, and `reconcile` compares them. A shared `<ReconciliationTable>` renders
  the per-component modelled-vs-billed variance ($/%, status, judgement banner) in **both** the
  operator metering-point page and the client report. Bills entered before this (total only) fall
  back to the total-level check.
- **Phase 5 (portfolio rollup) done:** `rollups` repo (`clientEnergies`, `clientEnergy`,
  `siteEnergiesForClient`, `meteringPointEnergiesForSite`) wired operator-home → client page →
  site page → metering-point page for portfolio-wide energy with drill-down.
- **Phase 6 (client report) done — v1 MVP complete:** the read-only client report
  (`app/(client)/report/[meteringPointId]`) composes the core into one print-optimised
  deliverable — summary + prioritised savings (`src/core/report.ts`), usage profile + data
  quality, cost breakdown, bill reconciliation, eligibility-flagged network tariff comparison,
  and a solar recommendation. Report logic iterated across three test generations
  (`report`/`reportv2`/`reportv3`).
- **Operator data is correctable (post-MVP hardening).** Two gaps that made the tool brittle
  in real operation are closed: (a) **NMI settings are now editable** — an "NMI settings"
  panel on the operator metering-point page edits tariff code, MLF/DLF, connection voltage,
  assumed PF and the default connection-unit count after creation
  (`updateMeteringPointSettingsAction` → `updateMeteringPointSettings`), so the report's
  "loss factors/connection-units required" pre-issue block is now a fixable prompt, not a
  dead-end; (b) **bills are deletable** — a mis-entered bill can be removed and re-entered
  (`deleteBillAction` → `deleteBill`, children removed then the bill; runs as the operator
  under RLS). Both run as the logged-in operator under RLS.
- **Reconciliation now withholds verdicts on incomplete periods (trust hardening).** The
  component-wise `reconcile` takes a `coverageFraction` (0–1 = share of the bill period's days
  that actually have interval data, from the pure `periodCoverage`/`daysInPeriodInclusive` in
  `src/core/reconciliation/coverage.ts`) and a `minCoverageFraction` (default 0.90). Below the
  floor the judgement is **`insufficient-data`** (precedence: insufficient-data → low-confidence
  → component verdict), so a partly-ingested month (e.g. 20 of 31 days) no longer prices a
  partial period against the full bill and falsely shouts "investigate". Wired in both the
  operator page and the client report; `ReconciliationTable` shows a coverage note. Day-level
  granularity for v1 (any reading = day covered); interval-weighting is a future refinement.
- **Network tariffs are effective-dated (rate-change hardening).** Energex network rates change
  each 1 July, so the concrete-engine registry is now versioned: `TARIFF_VERSIONS[code]` holds a
  tariff's rate-set versions over time and `getTariff(code, asOf?)` returns the version effective
  on `asOf` (the newest whose `effectiveFrom` ≤ `asOf`; without `asOf`, the latest; before any
  version, falls back to the oldest held). Reconciliation passes each bill's `periodStart` as
  `asOf`, so older bills stay correct after a rate update and new bills get the new rates — no
  fork. Adding the next 1-July rates is a DATA edit (prepend a dated `Tariff` to the array), never
  an engine change. `ENERGEX_7200` carries `effectiveFrom: 2026-07-01`, `ENERGEX_7400`
  `2025-07-01` (its rates derive from the Mar-2026 invoice = 2025-26 FY); each currently has a
  single version, so behaviour is unchanged until a second is added. **Retail rates are now
  effective-dated too** (follow-up closed): a `RetailPlan` carries an optional `effectiveFrom`, an
  NMI holds dated VERSIONS in `retail_plan` (`0017_retail_plan_effective_dated.sql` adds
  `effective_from` and swaps the per-NMI unique for `(metering_point_id, effective_from)`), and the
  pure `pickRetailPlan(plans, asOf?)` mirrors `getTariff` semantics (newest version ≤ asOf; latest
  when no asOf; falls back to the oldest before any version; baseline = no `effectiveFrom`).
  Reconciliation passes each bill's `periodStart` as `asOf` (both the operator page and the client
  report), so older bills keep their old retail rates and new bills get the new ones — no fork.
  Existing single plans get a far-past baseline date so behaviour is unchanged until a second
  version is saved (the operator form takes an optional "effective from" date). Adding the next
  retail rate-set is a DATA edit. No real prior-year rates were invented.
- **Full-stack click-through VERIFIED (and two real bugs found & fixed).** The whole operator
  journey was driven end-to-end in a real browser against a local stack running the repo's actual
  migrations (Postgres 16 + PostgREST + RLS, GoTrue-shaped auth): login → create client → site →
  NMI (7400, MLF/DLF, connection units) → NEM12 upload (2,976 readings land, charts render, PF
  0.96) → retail plan baseline + dated second version → component-bucket bill entry → per-component
  reconciliation → client report. Operator page and client report produce **identical modelled
  components line-for-line** (verified by scraping both). Bugs fixed: (a) **migration
  `0018_client_select_self_reference.sql`** — `client_select` used `can_access_client(id)` which
  re-queries `client` itself; a row inserted by the current statement isn't visible to that
  subquery, so the app's `.insert().select()` (INSERT … RETURNING) **always failed to create a
  client** under RLS. The policy now judges the row by its own `org_id`
  (`is_org_operator(org_id)` + direct `client_access` check) — same semantics for existing rows,
  and RETURNING works. Child tables are unaffected (their policies join pre-existing parents).
  (b) **The client report filtered bill-period readings by raw string date** (`slice(0, 10)`) —
  the DB returns UTC instants, so the boundary sat 10 h off AEST and dropped overnight readings,
  making the report's reconciliation disagree with the operator page; it now uses `aestDate` like
  the operator page. Also: **route-level loading skeletons** (`loading.tsx` + `PageSkeleton`) on
  every heavy route so navigation shows instant feedback (form submits already had spinner
  buttons); the retail-plan form gained the missing **plan-label input**; baseline plan versions
  display as "baseline" rather than the far-past sentinel date.
- **Not yet built:** the `@/data/service-role` module — it only arrives with a future
  non-interactive ingestion path (scheduled pulls / email-in), so its ESLint guard is
  intentionally still dormant. Known v1 follow-ups: wiring `src/core/time` in when the first
  DST-observing DNSP is onboarded (§5); roadmap items in §6 (automated PDF parsing, more DNSPs,
  self-serve) remain deferred by design.
- **Open follow-ups from the Phase 4–6 audit** (logged): (1) **Golden regression lock added**
  (`tests/core/invoice-golden.test.ts`) — pins the Energex 7400 + Origin cost engine output
  line-by-line to the cent against a *literal re-typed copy* of the invoice-derived rates, so a
  silent rate or engine-math change now fails the suite, and the loss discipline (network volume
  = none, retail energy = MLF×DLF, environmental/market = DLF) is locked. **Strict source
  validation DONE** against a real Origin invoice (QB04077571, Energex 7400, Mar 2026, $42,542.08
  ex-GST): the engine reproduces network, demand and peak-energy **to the cent** and the whole
  bill to **~4c on $42.5k**. Two documented few-cents residuals remain (real modelling choices,
  not errors): environmental uses one combined certificate-adjusted rate where the invoice rounds
  SREC/LREC separately (~3c); regulated/AEMO is applied to total consumption vs the invoice's
  net-of-export kWh (~1c). **Connection unit charge — FIXED:** previously modelled as a flat
  `fixed_monthly` $1719.07 that matched this invoice only by coincidence (245.582×7); the founder
  confirmed it is **rate × a count that varies per bill**, so it is now a `connection_unit`
  charge ($245.582/unit) multiplied by a `connection_units` count (migration `0015` per-NMI
  default captured at NMI creation, migration `0016` per-BILL override captured at bill entry —
  the count varies between bills, and reconciliation costs each bill's period with that bill's
  own count, falling back to the NMI default; absent count → modelled $0 and the client report
  is **blocked** by a pre-issue check). The general DNSP *schema* also now has a
  `connection_unit` charge kind (rate-only; the count stays per-NMI/per-bill data) and the
  Energex 7400 schedule uses it ($245.582/unit) — the `monthly_fixed` leftover is gone.
  (2) **§6 scope drift —
  resolved:** §6 item 7 now lists the report's operational findings, retail-contract benchmark
  and electricity Scope 2/3 emissions, and the NOT-in-v1 list scopes emissions precisely
  (electricity Scope 2/3 shipped; full carbon accounting / offsets / carbon-neutral claims stay
  out). (3) Minor: partial-reactive-data kVA
  understatement (engine treats intervals lacking a Q reading as PF=1 when *some* reactive
  exists); `demandShave` uses kW-as-kVA when reactive is absent (caveated in the UI).
- **[v1.1] ALL SEVEN STEPS BUILT (steps 2–7 landed together after step 1).** The monthly
  managed-service loop is complete end to end and was smoke-tested live against the local
  stack (worked example renders through review → recovery):
  (2) **Setup** (`/setup` + nav): every NMI with its assignment state; blocked NMIs listed
  first with an inline assign form (tariff codes from the DB registry, contract groups from
  the client's contracts); a client with no contracts is pointed at the NMI page (whose
  contract form assigns in one step). (3) **Quality gate**: `importDataAction` stores the
  validator's `quality_summary` (%actual, substituted/estimated counts, gaps) on the batch;
  the site page shows it with Accept / Needs re-data actions (`reviewImportBatchAction` →
  `setBatchReviewState`); `getReadingsForMeteringPoint(mpId, gateClientId)` EXCLUDES readings
  from non-accepted batches (pre-gate rows with no batch id pass) — both the operator MP page
  and the client report pass the gate arg, so a quarantined batch feeds nothing. (5) **Review
  & sign-off** (`/review`): "Save for review" on a bill persists a run + findings
  (`runReconciliationAction` — same maths as the MP page, quality-gated readings,
  period-effective versions); triage each finding (status + operator note + client-facing
  recommendation; **confirming an error auto-opens its recovery** with |variance| as the
  identified amount); `signOffRun` refuses while findings are open; runs are re-openable. The
  client report's reconciliation section now renders ONLY signed-off stored runs (variance
  table from stored findings + "Actions we are taking for you" from confirmed findings'
  recommendations), and `preIssueChecks` gained `unsignedBillCount` → a BLOCK until every
  component-bucket bill's latest run is signed off. (6) **Work queue** (home page): per-client
  chips — NMIs unassigned / imports to review / bills to reconcile / recoveries open / data
  stale (>40 days since last upload) — plus portfolio "identified vs recovered" dollars
  (`src/data/repositories/workQueue.ts`). (7) **Recovery board** (`/recovery`):
  to_raise → query_lodged → responded → recovered with date stamps, retailer ref, credited
  amount, notes; state machine constrains the next step; recovered runs re-openable.
  Repos: `workQueue.ts` new; `reconciliations.ts` gained `listAllLatestRuns` (labelled),
  `recoveries.ts` gained `listRecoveriesDetailed`. All pure logic stayed in the core; the
  new pages are workflow UI over repositories (§5b discipline held).

### Design note for Phase 3 ↔ Phase 4 (how the contract was honoured)
The intent: avoid two subtly-different ToU classifiers (analytics vs cost engine) drifting
apart, so modelled cost stays consistent with the analytics the operator sees. **As built,
there is a single ToU classifier** — `classifyPeriod` (`src/core/tariff/periods.ts`), used by
the cost engine, demand and retail; analytics doesn't define a competing one (its load profile
keys on minute-of-day, not ToU period). Both sides share the same primitives (`intervalPowerKw`,
the AEST time helpers), so peak/shoulder/off-peak and demand are computed one way. Note the cost
engine re-iterates the readings to sum per-interval energy rather than literally importing an
analytics ToU-bucket function — acceptable because the *classifier* is shared; if an analytics
ToU-bucket function is later added, point it and the engine at `classifyPeriod` too. When
`src/core/time` is wired in for DST states (§5), update `classifyPeriod` (and the analytics
helpers) to bucket in site-local time in that one place.

