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

---

## 4. Repo structure

```
src/
  core/          LAYER 2 — pure analytics + tariff/cost engine. NO framework/DB/other-layer imports.
    analytics/     consumption, demand/peak, power factor, load profiles
    tariff/        tariff + cost engine (data-driven; tariffs are DATA, not if/else code)
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

**Tariffs are DATA-IN-CODE, not DB tables** (`src/core/tariff/energex.ts`): a `Tariff` is a
declarative list of charges (fixed/energy-ToU/monthly-demand) + time-of-use window
definitions, which the pure engine (`src/core/tariff/engine.ts`) applies to interval data.
Adding a network/retailer = adding a `Tariff` value, not changing the engine.

Bills ARE tables (operator-entered facts):

| Table | Holds | Key fields |
|---|---|---|
| `bill` | One entered retailer bill | `client_id`, `metering_point_id`, retailer, `tariff_code`, period, `billed_total` (ex-GST) |
| `bill_line_item` | Optional bill breakdown | `bill_id`, `client_id`, label, category, amount |

Reconciliation (`src/core/tariff/reconciliation.ts`) compares the modelled cost (engine over
interval data for the bill's period + tariff) against `billed_total`, flagging
match / review / investigate. Energex 7200 (Large TOU Demand & Energy) is modelled in v1;
retail charges are clearly-labelled estimates until the client's contract rates are entered.

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

---

## 6. v1 scope (be ruthless — cut, don't add)

### IN v1
1. Multi-tenant foundation (hierarchy + RLS + operator role).
2. **NEM12 ingestion** — drag-and-drop upload, all channels (E/B/Q), gap detection,
   quality flags, original file retained, import audit trail.
3. **Structured bill capture** — operator enters bill facts (retailer, tariff name, period,
   line items, total) via a form; original PDF stored for reference. **NOT automated PDF
   parsing.**
4. **Tariff + cost engine — Energex (SE QLD) only** — energy by time-of-use, demand per the
   tariff rule, fixed charges; cost computed from interval data. Tariffs are DATA.
5. **Reconciliation** — modelled cost vs. billed cost, discrepancies flagged. *Headline.*
6. **Analytics** — consumption, demand/peak, power factor, cost breakdown; portfolio
   rollup with drill-down to site and metering point.
7. **Client report / export** — one clean read-only deliverable.
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
| 4. Tariff + cost + reconciliation | Energex tariff model, bill entry, cost-from-intervals, computed-vs-billed | See where the bill disagrees |
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
