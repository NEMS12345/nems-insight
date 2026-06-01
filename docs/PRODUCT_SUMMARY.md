# NEMS Insight — Product Summary

A self-contained overview of the product, what's built, the domain decisions made, and the
open questions. Written to be readable without any other context.

---

## What it is
An energy monitoring and analysis tool for **commercial & industrial (C&I) businesses** in
Australia (AU spelling, AUD, AU regulatory context). It's **operator-first**: the primary
users are a founder + small team running it as a **managed service** across ~18 clients at
maturity (not a public SaaS). The secondary user is a clean, **read-only report** handed to
each client. Architected so a self-serve tier could bolt on later without a rebuild.

## The core job
For each client: **ingest their interval meter data and their retailer bills**, then show
consumption / demand / power factor / cost / performance across their portfolio (drill down:
client → site → metering point/NMI), **reconcile the cost modelled from the meter data
against what was actually billed** (to catch billing errors and judge whether the deal is
good or bad), and **export a clean report** to hand to the client. Reconciliation is the
headline feature.

## Tech & architecture
Next.js + TypeScript + Tailwind, Supabase (Postgres/auth/storage), Vercel. Three layers with
a hard rule: the **calculation core is pure TypeScript** (no DB/framework imports) — data in,
numbers out — which keeps the "money logic" portable and testable. Multi-tenant from day one:
every client-owned row carries `client_id`, enforced by Postgres Row-Level Security; tenancy
integrity is guaranteed by composite foreign keys.

## What's built (MVP complete — verified by unit tests + against real client documents)

**1. Ingestion** — two real formats, one adapter each:
- **NEM12** (AEMO standard, .csv/.dat): all channels (consumption E, export B, reactive Q),
  5/15/30-min, quality flags (actual/estimated/substituted), gap detection.
- **Tabular 30-minute meter-profile export** (.xlsx): one row per meter per interval; each
  meter serial treated as its own metering point.
- Original files retained; full import audit trail.

**2. Analytics core (pure)** — consumption (import/export/net), demand (peak + average, kVA
and kW), power factor, load profile by time-of-day, load factor. All in NEM time (AEST, no
daylight saving — valid for QLD).

**3. Tariff + cost engine (data-driven — tariffs are *data*, not code)** — models the full bill:
- **Network**: Energex **7200** (SAC Large TOU, kW demand) and **7400** (11kV TOU Demand,
  kVA demand), from the published Energex price list/guide. Time-of-use windows, monthly
  maximum-demand charges measured in a defined window, fixed/connection charges.
- **Retail**: real **Origin** rates (energy ToU, environmental certificate charges,
  AEMO/market, metering) taken from an actual Origin tax invoice, layered on top of network.
- **Loss factors (MLF/DLF)** stored per NMI and applied per charge exactly as the bill does
  (energy ×MLF×DLF, environmental/regulated ×DLF, network volume ×none).
- Validated: the model reproduces a real Origin bill — shape-independent charges (demand,
  access, connection, environmental, metering) match **to the cent**; energy is true ToU so
  it tracks the actual load shape.

**4. Reconciliation** — modelled cost vs entered bill total, flagged **match / review /
investigate**.

**5. Portfolio rollup** — energy aggregated up NMI → site → client → portfolio via
RLS-respecting DB views.

**6. Client report** (print-optimised web page → Save-as-PDF) containing:
- Executive summary + prioritised **recommendations** (with $/yr)
- Usage profile (consumption, peak demand, load factor, power factor, data quality,
  load-profile chart)
- Cost breakdown (network vs retail, by ToU)
- Bill reconciliation
- **Network tariff check** — re-costs the load on each tariff, recommends cheapest, shows
  switch saving (flagged "subject to connection/voltage eligibility")
- **Solar recommendation** — system sized to *minimise export* (low percentile of daytime
  load), modelled generation vs actual load for self-consumption %, with $/yr saving, simple
  payback, CO₂ offset
- Explicit assumptions footer

## Key domain decisions & assumptions made
- **Manual structured bill entry**, not automated PDF parsing (PDF extraction across
  retailers deemed too unreliable for v1; one retailer = Origin so far).
- **Tariff assignment is per-NMI** (7200 vs 7400 depends on connection voltage — a physical
  constraint).
- **Demand** = monthly maximum 30-minute average within the tariff's demand window (kVA
  where reactive data exists, else kW).
- **Solar**: sized to minimise export; SE QLD yield ~1,550 kWh/kWp/yr; install ~$1.00/W;
  self-consumed kWh valued at the marginal daytime energy rate; QLD grid factor ~0.73 t/MWh.
- **Origin's exact peak/off-peak time windows are unknown** — currently assumed peak =
  7am–9pm weekdays.
- Everything is ex-GST.

## Deliberately NOT in v1 (roadmap)
Automated PDF bill parsing; networks other than Energex; sub-metering/allocation;
battery/storage modelling; bankable solar feasibility; a full DNSP tariff-eligibility engine;
demand-response; multi-year price forecasting; detailed carbon accounting; public self-serve.

## Open questions — market standards (where an outside view would help)
1. **What does a best-practice C&I energy/tariff-review report include** that's missing here?
   (Have: exec summary + recommendations, usage profile, cost breakdown, bill reconciliation,
   tariff comparison, power factor, demand management, solar, emissions headline.)
2. **Solar sizing methodology** for C&I — is "size to a low percentile of daytime load to
   minimise export" the right default, or do consultants size differently (target
   self-consumption %, include battery)? What self-consumption and yield assumptions are
   standard?
3. **Demand management** — how is peak-demand-reduction opportunity typically quantified and
   presented?
4. **Tariff optimisation** — how do brokers present "you should switch tariff" given
   eligibility constraints, and what other levers (retail contract benchmarking, network
   tariff reassignment requests) belong in the report?
5. **Power factor / kVA** — standard way to quantify and present a PF-correction business case.
6. **Emissions / Scope 2 / renewables** — what do C&I clients now expect?
