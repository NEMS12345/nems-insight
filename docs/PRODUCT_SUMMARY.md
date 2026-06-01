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
good or bad), and **produce a clean report** with prioritised, costed recommendations.
Reconciliation is the headline feature.

## Tech & architecture
Next.js + TypeScript + Tailwind, Supabase (Postgres/auth/storage), Vercel. Three layers with
a hard rule: the **calculation core is pure TypeScript** (no DB/framework imports) — data in,
numbers out — enforced by lint. This keeps the "money logic" portable and unit-tested (~56
tests). Multi-tenant from day one: every client-owned row carries `client_id`, enforced by
Postgres Row-Level Security; tenancy integrity is guaranteed by composite foreign keys.
All DB schema is versioned SQL migrations (11 so far), verified to apply against Postgres.

## What's built (MVP complete, plus a report v2)

**1. Ingestion** — two real formats, one adapter each (proves the "one adapter per format"
design — the rest of the system is unchanged when a new format is added):
- **NEM12** (AEMO standard, .csv/.dat): all channels (consumption E, export B, reactive Q),
  5/15/30-min, quality flags (actual/estimated/substituted), gap detection.
- **Tabular 30-minute meter-profile export** (.xlsx): one row per meter per interval; each
  meter serial becomes its own metering point.
- Original files retained in storage; full import audit trail.

**2. Analytics core (pure)** — consumption (import/export/net), demand (peak + average, kVA
and kW), power factor (period and at the demand-setting interval), load profile by
time-of-day, load factor, and operational findings (overnight base load, weekend vs weekday,
out-of-hours %, base-load creep). NEM time (AEST, no daylight saving — valid for QLD).

**3. Tariff + cost engine (data-driven — tariffs are *data*, not code)**:
- **Network tariffs** (shared code-data): Energex **7200** (SAC Large TOU, kW demand) and
  **7400** (11kV TOU Demand, kVA demand), from the published Energex price list/guide.
  Time-of-use windows; monthly maximum-demand charge in a defined window (confirmed no
  ratchet for these — the 12-month capacity ratchet only applies to ICC customers).
- **Retail pricing is per-NMI** (stored, editable): each metering point has its own retail
  plan (energy peak/off-peak rates + the retailer's peak window, environmental certificates,
  AEMO/market, supply, metering). Default seeded from a real Origin invoice.
- **Loss factors (MLF/DLF)** stored per NMI, applied per charge exactly as the bill does
  (energy ×MLF×DLF, environmental/regulated ×DLF, network volume ×none).
- The engine combines network + retail; validated to reproduce a real Origin bill — the
  shape-independent charges match to the cent; energy is true ToU so it tracks the load shape.

**4. Reconciliation** — modelled cost vs entered bill total, flagged match / review /
investigate. (Headline feature.)

**5. Portfolio rollup** — energy aggregated up NMI → site → client → portfolio via
RLS-respecting DB views.

**6. Client report** (print-optimised web page → Save-as-PDF; the read-only client view).
Led by a **consolidated savings register** (measure · $/yr · indicative capex · payback ·
confidence), then:
- Usage profile (consumption, peak demand, load factor, power factor at peak, data quality,
  load-profile chart, energy intensity kWh/m² when floor area is set)
- Operational findings (the zero-capex "free wins")
- Cost breakdown (network vs retail, by component)
- Bill reconciliation
- **Network tariff check** — re-costs the load on each tariff, recommends cheapest with the
  switch saving (network-only; eligibility-flagged)
- **Retail contract benchmark** — futures-derived; flags above-market rates + re-tender $
- **Demand management** — top-N peak intervals + whether the peak is inside the charged window
- **Power factor** — correction business case, gated to kVA tariffs (states "no benefit" on kW)
- **Solar** — sized by sweeping candidate sizes and picking best payback (self-consumption is
  an output), with degradation, lifetime saving, $/yr saving, payback, CO₂
- **Emissions** — location- and market-based Scope 2 on the NGA factor; solar offset in the
  same units

## Operator inputs (kept current per review)
- **ASX QLD futures price** ($/MWh) — entered on the Portfolio page; the retail benchmark is a
  **hold point** until it's set. Input-driven by design (licensed feed can replace it later;
  not scraped, for ToS/load-shaping reasons).
- **NGA emissions factor** (+ year/source) — editable override; falls back to a cited default.
- **Floor area** (optional, per site) — enables energy-intensity reporting.
- **Retail plan** (per NMI) — the client's contract rates.

## Branding
A brand palette is applied via Tailwind theme tokens: accent blue, dark nav rail, slate
surfaces/borders, semantic status colours (good/warn/bad), data-quality flag colours, and an
accent chart series.

## Key domain decisions & assumptions
- **Manual structured bill entry**, not automated PDF parsing (extraction across retailers is
  unreliable; one retailer = Origin so far).
- **Tariff assignment is per-NMI** (7200 vs 7400 depends on connection voltage — a physical
  constraint; switches are flagged "subject to eligibility/DNSP approval", never booked).
- **Demand** = monthly maximum 30-minute average within the tariff's demand window (kVA where
  reactive data exists, else kW).
- **Solar**: sized to best payback while keeping export low; SE QLD yield ~1,550 kWh/kWp/yr;
  install ~$1.00/W; 0.5%/yr degradation; self-consumed kWh valued at the avoided network
  volume + retail stack; QLD grid factor ~0.71 t/MWh.
- **Retail benchmark**: futures + margin + environmental + market + losses, load-shaped.
- **Origin's exact peak/off-peak windows aren't on the bill** — peak assumed 7am–9pm weekdays.
- Everything ex-GST.

## Deliberately NOT built (roadmap)
Automated PDF bill parsing; networks other than Energex; ICC capacity tariffs; sub-metering /
allocation; battery/storage modelling; bankable solar feasibility; a full DNSP
tariff-eligibility engine; demand-response; multi-year price forecasting/NPV; detailed carbon
accounting beyond Scope 2; public self-serve. Note: the app's calc logic is verified by tests,
but the live DB/UI path needs a configured Supabase to run end-to-end.

## Open questions — where an outside view would help
1. **Savings register & report** — is anything still missing for a best-practice C&I
   deliverable? (Have: register, usage, operational, cost breakdown, reconciliation, tariff
   check, retail benchmark, demand, power factor, solar, Scope 2 emissions.)
2. **Retail benchmark methodology** — are futures + adders + load-shaping the right basis, and
   what margin/environmental/loss assumptions are standard for C&I? How is load-shape uplift
   typically derived?
3. **Solar** — is "sweep sizes, pick best payback, keep export low" the right default, or do
   consultants optimise on NPV / a payback hurdle / include batteries? Standard
   self-consumption and yield assumptions?
4. **Demand management** — beyond top-N peaks and the in/out-of-window finding, how is the
   reduction opportunity and intervention set (load-shift / peak-shave / operational)
   typically quantified and presented?
5. **Power factor** — is "correct to a target PF, value the kVA reduction at the demand rate,
   size capacitors in kVAr" the standard business case? Typical target PF?
6. **Emissions / disclosure** — given AASB S2 / mandatory climate reporting is phasing in, what
   do C&I clients (mostly under-threshold but in larger supply chains) actually need — a
   defensible location- and market-based Scope 2, Scope 3 T&D losses, residual-emissions
   options (solar → PPA → GreenPower)?
7. **Operational anomalies** — which findings carry the most weight with C&I clients, and how
   should indicative $ be estimated defensibly (vs flagging qualitatively)?
