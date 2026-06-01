import { notFound } from "next/navigation";
import {
  getMeteringPointDetail,
  getReadingsForMeteringPoint,
} from "@/data/repositories/readings";
import { getSite } from "@/data/repositories/sites";
import { getClient } from "@/data/repositories/clients";
import { listBillsForMeteringPoint } from "@/data/repositories/bills";
import { getLatestMarketPrice } from "@/data/repositories/marketPrices";
import { getLatestEmissionsFactor } from "@/data/repositories/emissionsFactors";
import { getRetailPlan } from "@/data/repositories/retailPlans";
import {
  consumptionSummary,
  peakDemand,
  averageDemandKw,
  loadFactor,
  powerFactorAtPeakDemand,
  hasReactiveData,
  loadProfileByTimeOfDay,
  dailyConsumption,
  formatMinuteOfDay,
  analyseOperations,
  analyseDataWindow,
  topDemandIntervals,
  recommendSolar,
  scope2,
  scope3Electricity,
  emissionsAvoided,
  ngaFactor,
  ngaScope3Factor,
  NGA_FACTOR_YEAR,
} from "@/core/analytics";
import {
  computeFullCost,
  computeRetailCost,
  retailMarginalPeakRate,
  DEFAULT_RETAIL_PLAN,
  compareTariffs,
  eligibleTariffs,
  reconcile,
  getTariff,
  marginalEnergyRatePerKwh,
  benchmarkRetailEnergyBand,
  assessRetail,
  powerFactorCorrectionCase,
  demandShaveSaving,
  inWindow,
  classifyPeriod,
  ENERGEX_7200,
  ENERGEX_7400,
  type LossFactors,
} from "@/core/tariff";
import { sortSavings, totalAnnualSaving, adjustConfidence, type SavingsItem } from "@/core/report";
import { BarChart } from "@/components/BarChart";
import { PrintButton } from "@/components/PrintButton";
import { moneyLabel, energyLabel } from "@/lib/format";

const ALL_TARIFFS = [ENERGEX_7200, ENERGEX_7400];
const TARGET_PF = 0.95;
const CAPACITOR_COST_PER_KVAR = 60;

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
function kw(n: number): string {
  return `${n.toLocaleString("en-AU", { maximumFractionDigits: 1 })} kW`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid border-t border-border pt-6">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-border p-3">
      <div className="text-[11px] uppercase tracking-wide text-foreground/50">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-foreground/50">{sub}</div>}
    </div>
  );
}

export default async function ClientReport({
  params,
}: {
  params: Promise<{ meteringPointId: string }>;
}) {
  const { meteringPointId } = await params;
  const mp = await getMeteringPointDetail(meteringPointId);
  if (!mp) notFound();

  const [site, client, readings, bills, retailPlanRow] = await Promise.all([
    getSite(mp.siteId),
    getClient(mp.clientId),
    getReadingsForMeteringPoint(meteringPointId),
    listBillsForMeteringPoint(meteringPointId),
    getRetailPlan(meteringPointId),
  ]);
  const retailPlan = retailPlanRow ?? DEFAULT_RETAIL_PLAN;

  const tariff = getTariff(mp.tariffCode ?? "") ?? ENERGEX_7200;
  const reactiveAvailable = hasReactiveData(readings);
  const lossesEntered = mp.mlf != null && mp.dlf != null; // Blocker 2
  const losses: LossFactors = {
    mlf: mp.mlf ?? undefined,
    dlf: mp.dlf ?? undefined,
    assumedPf: mp.assumedPf ?? undefined,
  };
  const region = site?.state ?? "QLD";
  const marketPrice = await getLatestMarketPrice(region);
  const factorOverride = await getLatestEmissionsFactor(region);
  const factor = factorOverride?.factorTPerMwh ?? ngaFactor(region);
  const factorYear = factorOverride?.ngaYear ?? NGA_FACTOR_YEAR;

  const summary = consumptionSummary(readings);
  const peak = peakDemand(readings);
  const lf = loadFactor(readings);
  const pfPeak = powerFactorAtPeakDemand(readings);
  const profile = loadProfileByTimeOfDay(readings);
  const daily = dailyConsumption(readings);
  const ops = analyseOperations(readings);
  const topPeaks = topDemandIntervals(readings, 5);
  const modelled = computeFullCost(readings, tariff, retailPlan, losses);

  // Data window & seasonality — annualised figures are caveated when the window is partial.
  const win = analyseDataWindow(readings);
  const annualF = win.annualisationFactor;
  const annualKwh = summary.importKwh * annualF;
  const conf = (base: "high" | "medium" | "low") =>
    adjustConfidence(base, {
      seasonalCaveat: win.seasonalCaveat,
      estimatedFraction: summary.estimatedFraction,
    });
  const mlf = losses.mlf ?? 1;
  const dlf = losses.dlf ?? 1;

  // Tariff comparison — restricted to tariffs the NMI is actually eligible for (Blocker 1).
  const elig = eligibleTariffs(ALL_TARIFFS, {
    connectionVoltage: mp.connectionVoltage,
    currentCode: tariff.code,
    annualMwh: annualKwh / 1000,
  });
  const ranked = compareTariffs(readings, elig.tariffs, losses);
  const current = ranked.find((o) => o.tariff.code === tariff.code) ?? ranked[0];
  const cheapest = ranked[0];
  const tariffSavingAnnual = (current.cost.total - cheapest.cost.total) * annualF;
  const switchWorthwhile = cheapest.tariff.code !== tariff.code && tariffSavingAnnual > 0;

  // Demand: is the peak inside the charged window?
  const demandCharge = tariff.charges.find((c) => c.kind === "demand_monthly");
  const kvaBilled = demandCharge?.kind === "demand_monthly" && demandCharge.unit === "kVA";
  const demandRate = demandCharge?.kind === "demand_monthly" ? demandCharge.rate : 0;
  const peakInWindow =
    !!peak.at &&
    !!demandCharge &&
    demandCharge.kind === "demand_monthly" &&
    (demandCharge.window
      ? inWindow(peak.at, demandCharge.window)
      : classifyPeriod(peak.at, tariff.periods) === demandCharge.period);

  // Power factor (Blocker 3): a business case needs reactive data OR an explicit assumed PF.
  // On a kVA tariff with neither, kVA — and any PF case — is suppressed (never unity).
  const effectivePf = reactiveAvailable ? pfPeak.powerFactor : mp.assumedPf;
  const pfDeterminable = effectivePf != null;
  const kvaUndetermined = kvaBilled && !reactiveAvailable && mp.assumedPf == null;
  const pfCase =
    kvaBilled && pfDeterminable && pfPeak.kw > 0
      ? powerFactorCorrectionCase({
          peakKw: pfPeak.kw,
          peakKva: pfPeak.kva ?? pfPeak.kw / (effectivePf as number),
          currentPf: effectivePf as number,
          targetPf: TARGET_PF,
          demandRatePerKvaMonth: demandRate,
          kvaBilled,
        })
      : null;

  // Solar: value a self-consumed daytime kWh at the avoided network volume + retail stack.
  const avoidedRate =
    marginalEnergyRatePerKwh(tariff, "peak", losses) +
    retailMarginalPeakRate(retailPlan, losses);
  const solar = recommendSolar(readings, avoidedRate, {
    gridEmissionsTPerMwh: factor,
  });

  // Retail benchmark (futures-derived; input-driven, not scraped). Actual variable rate is
  // the per-kWh retail charges (energy + environmental + market) from this NMI's plan.
  const actualRetailVariableRate = (() => {
    const ret = computeRetailCost(readings, retailPlan, losses);
    const variable = ret.lines
      .filter((l) => l.label !== "Retail supply" && l.label !== "Metering")
      .reduce((sum, l) => sum + l.amount, 0);
    return summary.importKwh > 0 ? variable / summary.importKwh : 0;
  })();
  const benchmarkBand = marketPrice
    ? benchmarkRetailEnergyBand(marketPrice.futuresPerMwh, { lossUplift: mlf * dlf })
    : null;
  // Blocker 4: verdict derived from the numbers, with a below-forward explanation.
  const retail =
    benchmarkBand && marketPrice
      ? assessRetail(actualRetailVariableRate, benchmarkBand, annualKwh, marketPrice.futuresPerMwh / 1000)
      : null;

  // Demand: theoretical in-window shave (presented as a finding, not added to the register
  // total, to avoid double-counting kVA with power-factor correction below).
  const demandShave = demandShaveSaving(readings, tariff);

  // Avoidable standing load valued conservatively at the off-peak rate.
  const offpeakAvoidedRate =
    marginalEnergyRatePerKwh(tariff, "offpeak", losses) +
    retailPlan.offpeakRatePerKwh * mlf * dlf +
    retailPlan.environmentalPerKwh * dlf +
    retailPlan.marketPerKwh * dlf;
  const avoidableSaving =
    ops.avoidableBaseLoadKw * (ops.outOfHoursTimeFraction * 8760) * offpeakAvoidedRate;

  // Emissions (annualised; NGA location-based + Scope 3 electricity).
  const emissions = scope2(annualKwh, factor);
  const scope3 = scope3Electricity(annualKwh, ngaScope3Factor(region));
  const solarCo2 = emissionsAvoided(solar.annualGenerationKwh, factor);

  // Reconciliation.
  const reconciliations = bills
    .map((b) => {
      const bt = getTariff(b.tariffCode ?? "") ?? tariff;
      const inPeriod = readings.filter((r) => {
        const d = r.intervalStart.slice(0, 10);
        return d >= b.periodStart && d <= b.periodEnd;
      });
      return { bill: b, cost: computeFullCost(inPeriod, bt, retailPlan, losses) };
    })
    .map(({ bill, cost }) => ({ bill, cost, recon: reconcile(cost.total, bill.billedTotal) }));

  const periodStart = daily[0]?.date ?? "—";
  const periodEnd = daily[daily.length - 1]?.date ?? "—";

  // --- Issuability (operator gate): reasons this can't yet go client-facing ---
  const draftReasons: string[] = [];
  if (!lossesEntered) {
    draftReasons.push(
      "Loss factors not entered — cost model and benchmark exclude losses and understate actual cost. Enter MLF/DLF to issue.",
    );
  }
  if (kvaUndetermined) {
    draftReasons.push(
      "kVA-demand tariff but no reactive data and no assumed PF — demand cost can't be determined. Obtain reactive data or set an assumed PF.",
    );
  }
  if (elig.crossVoltageLimited) {
    draftReasons.push(
      "Connection voltage not specified — tariff comparison limited to the current voltage class (no cross-voltage alternatives shown).",
    );
  }
  const isDraft = draftReasons.length > 0;

  // --- Savings register ---
  const register: SavingsItem[] = [];
  if (avoidableSaving > 0) {
    register.push({
      measure: "Reduce avoidable out-of-hours / standing load",
      annualSavingAud: avoidableSaving,
      indicativeCapexAud: 0,
      paybackYears: 0,
      confidence: conf("medium"),
      note: `~${ops.avoidableBaseLoadKw.toFixed(0)} kW avoidable at off-peak; operational (controls/scheduling). Investigate — site confirmation needed.`,
    });
  }
  if (retail?.verdict === "above-market" && benchmarkBand) {
    register.push({
      measure: "Re-tender retail energy contract",
      annualSavingAud: retail.annualOpportunity,
      indicativeCapexAud: 0,
      paybackYears: 0,
      confidence: conf("medium"),
      note: `Actual ${(actualRetailVariableRate * 100).toFixed(2)}¢ vs benchmark top ${(benchmarkBand.high * 100).toFixed(2)}¢ /kWh; test in market.`,
    });
  }
  if (switchWorthwhile) {
    register.push({
      measure: `Review network tariff (→ ${cheapest.tariff.name})`,
      annualSavingAud: tariffSavingAnnual,
      indicativeCapexAud: 0,
      paybackYears: 0,
      confidence: conf("medium"),
      note: "Subject to connection/voltage eligibility and DNSP approval — pursue with retailer/DNSP.",
    });
  }
  if (pfCase?.applicable) {
    const capex = pfCase.capacitorKvar * CAPACITOR_COST_PER_KVAR;
    register.push({
      measure: "Correct power factor",
      annualSavingAud: pfCase.annualSavingAud,
      indicativeCapexAud: capex,
      paybackYears: pfCase.annualSavingAud > 0 ? capex / pfCase.annualSavingAud : null,
      confidence: conf("medium"),
      note: `${pfCase.capacitorKvar.toFixed(0)} kVAr to reach PF ${TARGET_PF}; subject to a power-quality study (harmonics may require detuned banks).`,
    });
  }
  if (solar.recommendedKwp > 0 && solar.annualSavingAud > 0) {
    register.push({
      measure: `Install ~${solar.recommendedKwp} kWp solar`,
      annualSavingAud: solar.annualSavingAud,
      indicativeCapexAud: solar.recommendedKwp * solar.assumptions.installCostPerWatt * 1000,
      paybackYears: solar.simplePaybackYears,
      confidence: conf("medium"),
      note: `${pct(solar.selfConsumptionPct)} self-consumed; roof/space assumed.`,
    });
  }
  const rankedRegister = sortSavings(register);
  const totalSaving = totalAnnualSaving(register);

  return (
    <main className="mx-auto max-w-3xl p-8 text-foreground">
      <div className="solar-flare-bar mb-6 h-1.5 rounded" />
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-foreground/50">
            Energy review — NEMS Insight {isDraft && "· DRAFT (operator only)"}
          </div>
          <h1 className="text-2xl font-bold">{client?.name ?? "Client"}</h1>
          <div className="text-sm text-foreground/60">
            {site?.name} · NMI <span className="font-mono">{mp.nmi}</span> · {periodStart} to {periodEnd}
          </div>
        </div>
        <PrintButton />
      </div>

      {isDraft && (
        <div className="mt-4 rounded border-2 border-bad/40 bg-bad/5 px-4 py-3 text-sm">
          <div className="font-semibold text-bad">DRAFT — not for client issue</div>
          <ul className="mt-1 list-disc pl-5 text-foreground/75">
            {draftReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {!marketPrice && (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 print:hidden">
          ⚠ Retail benchmark is on hold — enter today&apos;s ASX {region} futures price in the
          operator console to complete it.
        </p>
      )}

      {win.seasonalCaveat && (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          ⚠ Data covers {win.days} days ({win.firstDate} to {win.lastDate}), not a full seasonal
          year{win.hasSummer && !win.hasWinter ? " (summer only)" : win.hasWinter && !win.hasSummer ? " (winter only)" : ""}.
          Annualised figures are indicative and confidence is downgraded accordingly.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-6">
        <Section title="Summary">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Annual cost (modelled)" value={moneyLabel(modelled.total * annualF)} sub={win.spansFullYear ? undefined : "annualised — partial year"} />
            <Metric label="Annual consumption" value={energyLabel(annualKwh)} />
            <Metric label="Peak demand" value={kw(peak.kw)} />
            <Metric label="Identified savings" value={`${moneyLabel(totalSaving)}/yr`} />
          </div>
          <p className="mt-2 text-[11px] text-foreground/50">
            Data window: {win.firstDate} to {win.lastDate} ({win.days} days, {win.months.length} months).
            Suggested sequence: action low/no-capex operational and tariff/retail items first (0–30 days),
            then power factor and demand (30–60), then solar (60–90). Re-baseline after implementation to verify (M&V).
          </p>
          {rankedRegister.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-[11px] uppercase text-foreground/40">
                <tr><th className="py-1">Measure</th><th className="py-1 text-right">Saving/yr</th><th className="py-1 text-right">Capex</th><th className="py-1 text-right">Payback</th><th className="py-1 text-right">Confidence</th></tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {rankedRegister.map((s) => (
                  <tr key={s.measure}>
                    <td className="py-1.5">{s.measure}{s.note && <div className="text-[11px] text-foreground/50">{s.note}</div>}</td>
                    <td className="py-1.5 text-right tabular-nums">{moneyLabel(s.annualSavingAud)}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.indicativeCapexAud ? moneyLabel(s.indicativeCapexAud) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.paybackYears ? `${s.paybackYears.toFixed(1)}y` : "—"}</td>
                    <td className="py-1.5 text-right capitalize">{s.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Usage profile">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Average demand" value={kw(averageDemandKw(readings))} />
            <Metric label="Load factor" value={lf.toFixed(2)} sub={lf < 0.4 ? "peaky" : "flat"} />
            <Metric
              label="Power factor (at peak)"
              value={pfPeak.reactiveDataAvailable && pfPeak.powerFactor != null ? pfPeak.powerFactor.toFixed(2) : "n/a"}
              sub={pfPeak.reactiveDataAvailable ? undefined : "no reactive data"}
            />
            {site?.floorAreaM2 ? (
              <Metric
                label="Energy intensity"
                value={`${(annualKwh / site.floorAreaM2).toLocaleString("en-AU", { maximumFractionDigits: 0 })} kWh/m²`}
                sub={`${site.floorAreaM2.toLocaleString("en-AU")} m²/yr`}
              />
            ) : (
              <Metric label="Estimated data" value={pct(summary.estimatedFraction)} />
            )}
          </div>
          <div className="mt-4 text-xs text-foreground/50">Average daily load profile (kW by time of day)</div>
          <BarChart unit="kW" data={profile.map((p) => ({ label: formatMinuteOfDay(p.minuteOfDay), value: p.avgKw }))} />
        </Section>

        <Section title="Operational findings">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Overnight base load" value={kw(ops.baseLoadKw)} sub={`${pct(ops.baseLoadFractionOfPeak)} of peak`} />
            <Metric label="Avoidable (est.)" value={kw(ops.avoidableBaseLoadKw)} sub={`~${moneyLabel(avoidableSaving)}/yr at off-peak`} />
            <Metric label="Out-of-hours energy" value={pct(ops.outOfHoursFraction)} />
            <Metric label="Base-load trend" value={ops.baseLoadCreep === null ? "—" : pct(ops.baseLoadCreep)} sub="first→last month" />
          </div>
          <p className="mt-2 text-xs text-foreground/60">
            Only the <em>avoidable</em> portion is dollarised — observed overnight load minus an assumed
            essential floor (refrigeration/servers/security). Conservative and to be confirmed on site;
            valued at the off-peak rate. Standing load and weekend running are usually the cheapest savings
            (controls/scheduling, no capital). Weekend vs weekday daily use: {pct(ops.weekendFractionOfWeekday)}.
          </p>
        </Section>

        <Section title="Where the money goes">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-black/5">
              {modelled.lines.map((l) => (
                <tr key={l.label}>
                  <td className="py-1.5">{l.label} <span className="text-[10px] uppercase text-foreground/40">{l.category}</span></td>
                  <td className="py-1.5 text-right tabular-nums">{moneyLabel(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border font-medium">
              <tr><td className="py-2">Network {moneyLabel(modelled.networkTotal)} · Retail {moneyLabel(modelled.retailTotal)} (period)</td><td className="py-2 text-right tabular-nums">{moneyLabel(modelled.total)}</td></tr>
            </tfoot>
          </table>
        </Section>

        {reconciliations.length > 0 && (
          <Section title="Bill reconciliation">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-black/5">
                {reconciliations.map(({ bill, cost, recon }) => (
                  <tr key={bill.id}>
                    <td className="py-1.5">{bill.periodStart}–{bill.periodEnd}{bill.retailer ? ` · ${bill.retailer}` : ""}</td>
                    <td className="py-1.5 text-right tabular-nums">billed {moneyLabel(bill.billedTotal)}</td>
                    <td className="py-1.5 text-right tabular-nums">modelled {moneyLabel(cost.total)}</td>
                    <td className="py-1.5 text-right font-medium">{recon.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        <Section title="Network tariff check">
          <p className="text-sm text-foreground/80">
            Modelled on <strong>{tariff.name}</strong>.
            {switchWorthwhile
              ? <> On this load, <strong>{cheapest.tariff.name}</strong> would cost about <strong>{moneyLabel(tariffSavingAnnual)}/yr less</strong> — review subject to connection/voltage eligibility and DNSP approval.</>
              : <> It is the lowest-cost of the tariffs assessed for this load.</>}
          </p>
          <table className="mt-3 w-full text-sm">
            <tbody className="divide-y divide-black/5">
              {ranked.map((o) => (
                <tr key={o.tariff.code} className={o.tariff.code === tariff.code ? "font-medium" : ""}>
                  <td className="py-1.5">{o.tariff.name}{o.tariff.code === tariff.code ? " (current)" : ""}</td>
                  <td className="py-1.5 text-right tabular-nums">{moneyLabel(o.cost.total * annualF)}/yr network</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-foreground/50">
            Network cost only — retail is unchanged by a network tariff switch.
            {elig.crossVoltageLimited &&
              " Connection voltage not specified — comparison limited to the current voltage class; no cross-voltage alternatives are shown."}
          </p>
        </Section>

        <Section title="Retail contract benchmark">
          {marketPrice && retail && benchmarkBand ? (
            <>
              <p className="text-sm text-foreground/80">
                Your variable retail rate is about <strong>{(actualRetailVariableRate * 100).toFixed(2)}¢/kWh</strong> vs an indicative
                market benchmark band of <strong>{(benchmarkBand.low * 100).toFixed(2)}–{(benchmarkBand.high * 100).toFixed(2)}¢/kWh</strong>
                {retail.verdict === "below-market" && (
                  <> — <strong className="text-good">below market (favourable)</strong>.</>
                )}
                {retail.verdict === "in-line" && <> — <strong>in line with market</strong>.</>}
                {retail.verdict === "above-market" && (
                  <> — <strong className="text-bad">above market</strong>; indicative re-tender opportunity ~<strong>{moneyLabel(retail.annualOpportunity)}/yr</strong>.</>
                )}
              </p>
              {retail.belowForward && (
                <p className="mt-1 text-[11px] text-foreground/60">
                  Note: the rate sits below the current wholesale forward (${marketPrice.futuresPerMwh.toFixed(2)}/MWh) —
                  likely a legacy contract struck at lower forwards. Favourable, but confirm the contract end date.
                </p>
              )}
              <p className="mt-1 text-[11px] text-foreground/50">
                Contestable retail component only (network/metering sit in the tariff check). Built from the ASX {region}
                futures price ${marketPrice.futuresPerMwh.toFixed(2)}/MWh (captured {marketPrice.capturedOn}) grossed up for
                {lossesEntered ? " losses (MLF×DLF) and" : ""} load shape, plus LGC/STC environmental, AEMO market fees and
                retailer margin{lossesEntered ? "" : " (losses NOT applied — MLF/DLF not entered)"}. A band, not a quote —
                a real tender depends on credit and term.
              </p>
            </>
          ) : (
            <p className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <strong>On hold.</strong> Enter today&apos;s ASX {region} futures price in the operator console
              (Portfolio → Market reference price) to produce the retail benchmark.
            </p>
          )}
        </Section>

        <Section title="Demand management">
          <p className="text-sm text-foreground/80">
            Peak demand was <strong>{kw(peak.kw)}</strong>{peak.at ? ` at ${peak.at.replace("T", " ").slice(0, 16)}` : ""}.{" "}
            {demandCharge
              ? peakInWindow
                ? "It falls inside the charged demand window, so reducing it directly cuts the demand charge."
                : "It falls OUTSIDE the charged demand window — shifting load out of the window, or trimming the in-window peak, is what reduces the charge."
              : ""}
          </p>
          <table className="mt-2 w-full text-sm">
            <tbody className="divide-y divide-black/5">
              {topPeaks.map((p) => (
                <tr key={p.intervalStart}>
                  <td className="py-1">{p.intervalStart.replace("T", " ").slice(0, 16)}</td>
                  <td className="py-1 text-right tabular-nums">{kw(p.kw)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-foreground/60">
            Theoretical headroom from clipping each month&apos;s top in-window interval to the next-highest:
            ~<strong>{moneyLabel(demandShave.theoreticalAnnualSaving)}/yr</strong> ({demandShave.unit}). This is the
            theoretical ceiling, not the achievable saving — that needs site knowledge of what load is movable.
            Interventions, cheapest first: operational (stagger start-ups, BMS scheduling, demand limiting), then
            load-shifting (move flexible load out of the window), then peak-shaving (battery/genset).
            {kvaBilled ? " On this kVA tariff, power-factor correction (below) is itself a demand lever — not additive to it." : ""}
          </p>
        </Section>

        <Section title="Power factor">
          {!reactiveAvailable && (
            <p className="text-sm text-foreground/80">
              <strong>Not available — no reactive (kVAr) data</strong> in this dataset, so power factor and
              kVA can&apos;t be measured.
              {kvaBilled
                ? mp.assumedPf == null
                  ? " This NMI is on a kVA-demand tariff, so an assumed power factor must be set before kVA-based figures can be issued."
                  : ` Figures below assume PF = ${mp.assumedPf} (operator-set).`
                : " This NMI is on a kW-demand tariff, so power factor doesn't affect the demand charge anyway."}
            </p>
          )}
          {pfCase?.applicable ? (
            <>
              <p className="text-sm text-foreground/80">
                Power factor {reactiveAvailable ? "at the demand-setting interval" : "(assumed)"} is{" "}
                <strong>{(effectivePf as number).toFixed(2)}</strong>. Correcting to a target of {TARGET_PF}
                {" "}(up to ~0.98 with automatic correction; unity isn&apos;t worth chasing) would cut chargeable demand from{" "}
                {pfCase.peakKva.toFixed(0)} to {pfCase.correctedKva.toFixed(0)} kVA — about{" "}
                <strong>{moneyLabel(pfCase.annualSavingAud)}/yr</strong> (≈{pfCase.capacitorKvar.toFixed(0)} kVAr). Indicative,
                subject to a power-quality study; harmonics may require detuned/filtered banks.
              </p>
              {!reactiveAvailable && (
                <p className="mt-1 text-[11px] text-foreground/60">
                  Assumes PF = {mp.assumedPf}. Sensitivity — saving at PF 0.85 / 0.90 / 0.95:{" "}
                  {[0.85, 0.9, 0.95]
                    .map((tp) => {
                      const correctedKva = pfPeak.kw / TARGET_PF;
                      const nowKva = pfPeak.kw / tp;
                      return moneyLabel(Math.max(0, nowKva - correctedKva) * demandRate * 12);
                    })
                    .join(" / ")}.
                </p>
              )}
            </>
          ) : reactiveAvailable ? (
            <p className="text-sm text-foreground/80">Power factor is healthy; no correction warranted.</p>
          ) : null}
        </Section>

        <Section title="Solar opportunity">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Best payback" value={`${solar.recommendedKwp} kWp`} sub={solar.simplePaybackYears ? `${solar.simplePaybackYears.toFixed(1)}y · ${pct(solar.selfConsumptionPct)} self-used` : "low export"} />
            <Metric label="Best lifetime value" value={`${solar.maxValue.kwp} kWp`} sub={`${moneyLabel(solar.maxValue.lifetimeSavingAud)} over ${solar.assumptions.systemLifeYears}y`} />
            <Metric label="Annual saving" value={moneyLabel(solar.annualSavingAud)} sub={`max-value: ${moneyLabel(solar.maxValue.annualSavingAud)}/yr`} />
            <Metric label="CO₂ avoided" value={`~${solarCo2.toFixed(0)} t/yr`} sub={`${energyLabel(solar.annualGenerationKwh)} generated`} />
          </div>
          <p className="mt-3 text-xs text-foreground/50">
            Two sizes: the min-payback system (cash-constrained) and the max-lifetime-value system (asset owner) —
            choose on capital appetite. Indicative only. {solar.assumptions.yieldKwhPerKwpYear} kWh/kWp/yr (SE QLD),
            ~${solar.assumptions.installCostPerWatt.toFixed(2)}/W, {(solar.assumptions.degradationPerYear * 100).toFixed(1)}%/yr
            degradation, inverter replacement ~yr {solar.assumptions.inverterReplacementYear}, self-consumed kWh valued at
            {" "}{moneyLabel(avoidedRate)}/kWh. Roof/space and existing on-site generation to be confirmed.
          </p>
        </Section>

        <Section title="Electricity emissions">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Scope 2 (location)" value={`${emissions.locationTonnes.toFixed(0)} t/yr`} sub={`${factor} t/MWh · ${factorYear}`} />
            <Metric label="Scope 2 (market)" value={`${emissions.marketTonnes.toFixed(0)} t/yr`} sub="GreenPower/LGCs/PPA lower this" />
            <Metric label="Scope 3 (T&D + upstream)" value={`${scope3.toFixed(0)} t/yr`} sub={`${ngaScope3Factor(region)} t/MWh`} />
            <Metric label="Solar offset" value={`${solarCo2.toFixed(0)} t/yr`} />
          </div>
          <p className="mt-2 text-[11px] text-foreground/50">
            Basis: {energyLabel(annualKwh)}/yr, NGA factors ({factorYear}). Electricity Scope 2 (location and market-based)
            and Scope 3 only — other scopes are out of scope for an energy review. Residual-emissions ladder: efficiency →
            on-site solar → PPA/GreenPower → offsets (last resort). Figures are method-stated estimates, not a
            &ldquo;carbon-neutral&rdquo; claim; confirm the current NGA factor before issuing.
          </p>
        </Section>

        <Section title="Basis & assumptions">
          <ul className="list-disc pl-5 text-xs text-foreground/60">
            <li>Costs modelled from interval meter data on {tariff.name} (network published; retail per the client&apos;s Origin invoice), ex-GST. Annualised from {modelled.days} days where shown as /yr.</li>
            <li>
              Loss factors:{" "}
              {lossesEntered
                ? `MLF ${mp.mlf}, DLF ${mp.dlf} (applied to energy/environmental/market).`
                : "not entered — losses are NOT applied; the cost model and benchmark exclude losses and understate actual cost."}{" "}
              Retail energy peak window assumed 7am–9pm weekdays.
            </li>
            <li>{readings.length.toLocaleString("en-AU")} interval readings; {pct(summary.estimatedFraction)} estimated/substituted. Savings are indicative, not quotes; capex and PF/solar sizing need site assessment.</li>
          </ul>
        </Section>
      </div>
    </main>
  );
}
