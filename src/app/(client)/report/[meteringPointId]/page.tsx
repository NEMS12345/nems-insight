import { notFound } from "next/navigation";
import {
  getMeteringPointDetail,
  getReadingsForMeteringPoint,
} from "@/data/repositories/readings";
import { getSite } from "@/data/repositories/sites";
import { getClient } from "@/data/repositories/clients";
import { listBillsForMeteringPoint } from "@/data/repositories/bills";
import { getLatestMarketPrice } from "@/data/repositories/marketPrices";
import {
  consumptionSummary,
  peakDemand,
  averageDemandKw,
  loadFactor,
  powerFactorAtPeakDemand,
  loadProfileByTimeOfDay,
  dailyConsumption,
  formatMinuteOfDay,
  analyseOperations,
  topDemandIntervals,
  recommendSolar,
  scope2,
  emissionsAvoided,
  ngaFactor,
} from "@/core/analytics";
import {
  computeCost,
  compareTariffs,
  reconcile,
  getTariff,
  marginalEnergyRatePerKwh,
  benchmarkRetailEnergyRate,
  compareRetailRate,
  powerFactorCorrectionCase,
  inWindow,
  classifyPeriod,
  ENERGEX_7200,
  ENERGEX_7400,
  type LossFactors,
} from "@/core/tariff";
import { sortSavings, totalAnnualSaving, type SavingsItem } from "@/core/report";
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
    <section className="break-inside-avoid border-t border-black/10 pt-6">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-black/10 p-3">
      <div className="text-[11px] uppercase tracking-wide text-black/50">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-black/50">{sub}</div>}
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

  const [site, client, readings, bills] = await Promise.all([
    getSite(mp.siteId),
    getClient(mp.clientId),
    getReadingsForMeteringPoint(meteringPointId),
    listBillsForMeteringPoint(meteringPointId),
  ]);

  const tariff = getTariff(mp.tariffCode ?? "") ?? ENERGEX_7200;
  const losses: LossFactors = { mlf: mp.mlf ?? undefined, dlf: mp.dlf ?? undefined };
  const region = site?.state ?? "QLD";
  const marketPrice = await getLatestMarketPrice(region);

  const summary = consumptionSummary(readings);
  const peak = peakDemand(readings);
  const lf = loadFactor(readings);
  const pfPeak = powerFactorAtPeakDemand(readings);
  const profile = loadProfileByTimeOfDay(readings);
  const daily = dailyConsumption(readings);
  const ops = analyseOperations(readings);
  const topPeaks = topDemandIntervals(readings, 5);
  const modelled = computeCost(readings, tariff, losses);

  // Annualise from the data period (handles 1-month vs 1-year data).
  const annualF = modelled.days > 0 ? 365 / modelled.days : 1;
  const annualKwh = summary.importKwh * annualF;

  // Tariff comparison.
  const ranked = compareTariffs(readings, ALL_TARIFFS, losses);
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

  // Power factor correction (only meaningful on a kVA demand tariff).
  const pfCase = powerFactorCorrectionCase({
    peakKw: pfPeak.kw,
    peakKva: pfPeak.kva,
    currentPf: pfPeak.powerFactor ?? 1,
    targetPf: TARGET_PF,
    demandRatePerKvaMonth: demandRate,
    kvaBilled,
  });

  // Solar (value a self-consumed kWh at the full avoided daytime volumetric stack).
  const avoidedRate = marginalEnergyRatePerKwh(tariff, "peak", losses);
  const solar = recommendSolar(readings, avoidedRate, {
    gridEmissionsTPerMwh: ngaFactor(site?.state),
  });

  // Retail benchmark (futures-derived; input-driven, not scraped).
  const actualRetailVariableRate = (() => {
    let dollars = 0;
    for (const ch of tariff.charges) {
      if (ch.kind !== "energy" || ch.category !== "retail") continue;
      const kwh = ch.period === "all" ? summary.importKwh : modelled.energyByPeriod[ch.period];
      const lossMult = (ch.losses ?? []).reduce(
        (m, l) => m * (l === "MLF" ? losses.mlf ?? 1 : losses.dlf ?? 1),
        1,
      );
      dollars += ch.rate * kwh * lossMult;
    }
    return summary.importKwh > 0 ? dollars / summary.importKwh : 0;
  })();
  const benchmarkRate = marketPrice
    ? benchmarkRetailEnergyRate(marketPrice.futuresPerMwh, {
        lossUplift: (losses.mlf ?? 1) * (losses.dlf ?? 1),
      })
    : null;
  const retail =
    benchmarkRate !== null
      ? compareRetailRate(actualRetailVariableRate, benchmarkRate, annualKwh)
      : null;

  // Emissions (annualised; NGA location-based, state factor).
  const factor = ngaFactor(site?.state);
  const emissions = scope2(annualKwh, factor);
  const solarCo2 = emissionsAvoided(solar.annualGenerationKwh, factor);

  // Reconciliation.
  const reconciliations = bills
    .map((b) => {
      const bt = getTariff(b.tariffCode ?? "") ?? tariff;
      const inPeriod = readings.filter((r) => {
        const d = r.intervalStart.slice(0, 10);
        return d >= b.periodStart && d <= b.periodEnd;
      });
      return { bill: b, cost: computeCost(inPeriod, bt, losses) };
    })
    .map(({ bill, cost }) => ({ bill, cost, recon: reconcile(cost.total, bill.billedTotal) }));

  const periodStart = daily[0]?.date ?? "—";
  const periodEnd = daily[daily.length - 1]?.date ?? "—";

  // --- Savings register ---
  const register: SavingsItem[] = [];
  if (retail?.aboveBenchmark && benchmarkRate !== null) {
    register.push({
      measure: "Re-tender retail energy contract",
      annualSavingAud: retail.annualOpportunity,
      indicativeCapexAud: 0,
      paybackYears: 0,
      confidence: "low",
      note: `Actual ${(actualRetailVariableRate * 100).toFixed(2)}¢ vs benchmark ${(benchmarkRate * 100).toFixed(2)}¢ /kWh (indicative).`,
    });
  }
  if (switchWorthwhile) {
    register.push({
      measure: `Review network tariff (→ ${cheapest.tariff.name})`,
      annualSavingAud: tariffSavingAnnual,
      indicativeCapexAud: 0,
      paybackYears: 0,
      confidence: "low",
      note: "Subject to connection/voltage eligibility and DNSP approval.",
    });
  }
  if (pfCase.applicable) {
    const capex = pfCase.capacitorKvar * CAPACITOR_COST_PER_KVAR;
    register.push({
      measure: "Correct power factor",
      annualSavingAud: pfCase.annualSavingAud,
      indicativeCapexAud: capex,
      paybackYears: pfCase.annualSavingAud > 0 ? capex / pfCase.annualSavingAud : null,
      confidence: "medium",
      note: `${pfCase.capacitorKvar.toFixed(0)} kVAr to reach PF ${TARGET_PF}; final sizing needs an electrical assessment.`,
    });
  }
  if (solar.recommendedKwp > 0 && solar.annualSavingAud > 0) {
    register.push({
      measure: `Install ~${solar.recommendedKwp} kWp solar`,
      annualSavingAud: solar.annualSavingAud,
      indicativeCapexAud: solar.recommendedKwp * solar.assumptions.installCostPerWatt * 1000,
      paybackYears: solar.simplePaybackYears,
      confidence: "medium",
      note: `${pct(solar.selfConsumptionPct)} self-consumed; indicative, roof/space assumed.`,
    });
  }
  if (ops.outOfHoursFraction > 0.4 || ops.weekendFractionOfWeekday > 0.6) {
    register.push({
      measure: "Reduce out-of-hours / standing load",
      annualSavingAud: ops.baseLoadKw * 8760 * 0.1 * avoidedRate, // 10% of standing load, indicative
      indicativeCapexAud: 0,
      paybackYears: 0,
      confidence: "low",
      note: "Operational (controls/scheduling); indicative — requires a site review.",
    });
  }
  const rankedRegister = sortSavings(register);
  const totalSaving = totalAnnualSaving(register);

  return (
    <main className="mx-auto max-w-3xl p-8 text-black">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-black/50">Energy review — NEMS Insight</div>
          <h1 className="text-2xl font-bold">{client?.name ?? "Client"}</h1>
          <div className="text-sm text-black/60">
            {site?.name} · NMI <span className="font-mono">{mp.nmi}</span> · {periodStart} to {periodEnd}
          </div>
        </div>
        <PrintButton />
      </div>

      {!marketPrice && (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 print:hidden">
          ⚠ Retail benchmark is on hold — enter today&apos;s ASX {region} futures price in the
          operator console to complete it.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-6">
        <Section title="Summary">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Annual cost (modelled)" value={moneyLabel(modelled.total * annualF)} />
            <Metric label="Annual consumption" value={energyLabel(annualKwh)} />
            <Metric label="Peak demand" value={kw(peak.kw)} />
            <Metric label="Identified savings" value={`${moneyLabel(totalSaving)}/yr`} />
          </div>
          {rankedRegister.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-[11px] uppercase text-black/40">
                <tr><th className="py-1">Measure</th><th className="py-1 text-right">Saving/yr</th><th className="py-1 text-right">Capex</th><th className="py-1 text-right">Payback</th><th className="py-1 text-right">Confidence</th></tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {rankedRegister.map((s) => (
                  <tr key={s.measure}>
                    <td className="py-1.5">{s.measure}{s.note && <div className="text-[11px] text-black/50">{s.note}</div>}</td>
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
            <Metric label="Power factor (at peak)" value={pfPeak.powerFactor === null ? "—" : pfPeak.powerFactor.toFixed(2)} />
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
          <div className="mt-4 text-xs text-black/50">Average daily load profile (kW by time of day)</div>
          <BarChart unit="kW" data={profile.map((p) => ({ label: formatMinuteOfDay(p.minuteOfDay), value: p.avgKw }))} />
        </Section>

        <Section title="Operational findings">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Overnight base load" value={kw(ops.baseLoadKw)} sub={`${pct(ops.baseLoadFractionOfPeak)} of peak`} />
            <Metric label="Out-of-hours energy" value={pct(ops.outOfHoursFraction)} />
            <Metric label="Weekend vs weekday" value={pct(ops.weekendFractionOfWeekday)} sub="daily use" />
            <Metric label="Base-load trend" value={ops.baseLoadCreep === null ? "—" : pct(ops.baseLoadCreep)} sub="first→last month" />
          </div>
          <p className="mt-2 text-xs text-black/60">
            Standing/overnight load and weekend running are usually the cheapest savings (controls and scheduling, no capital).
          </p>
        </Section>

        <Section title="Where the money goes">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-black/5">
              {modelled.lines.map((l) => (
                <tr key={l.label}>
                  <td className="py-1.5">{l.label} <span className="text-[10px] uppercase text-black/40">{l.category}</span></td>
                  <td className="py-1.5 text-right tabular-nums">{moneyLabel(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-black/20 font-medium">
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
          <p className="text-sm text-black/80">
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
                  <td className="py-1.5 text-right tabular-nums">{moneyLabel(o.cost.total * annualF)}/yr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Retail contract benchmark">
          {marketPrice && retail && benchmarkRate !== null ? (
            <>
              <p className="text-sm text-black/80">
                Your variable retail rate is about <strong>{(actualRetailVariableRate * 100).toFixed(2)}¢/kWh</strong> vs an indicative
                market benchmark of <strong>{(benchmarkRate * 100).toFixed(2)}¢/kWh</strong>
                {retail.aboveBenchmark
                  ? <> — re-tendering could be worth ~<strong>{moneyLabel(retail.annualOpportunity)}/yr</strong>.</>
                  : <> — broadly competitive.</>}
              </p>
              <p className="mt-1 text-[11px] text-black/50">
                Benchmark built from the ASX {region} futures price of ${marketPrice.futuresPerMwh.toFixed(2)}/MWh
                (captured {marketPrice.capturedOn}) plus margin, environmental, market fees and losses. Indicative only.
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
          <p className="text-sm text-black/80">
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
        </Section>

        <Section title="Power factor">
          {pfCase.applicable ? (
            <p className="text-sm text-black/80">
              Power factor at the demand peak is <strong>{pfPeak.powerFactor?.toFixed(2)}</strong>. Correcting to {TARGET_PF}
              would cut chargeable demand from {pfCase.peakKva.toFixed(0)} to {pfCase.correctedKva.toFixed(0)} kVA — about{" "}
              <strong>{moneyLabel(pfCase.annualSavingAud)}/yr</strong> (≈{pfCase.capacitorKvar.toFixed(0)} kVAr of correction).
            </p>
          ) : (
            <p className="text-sm text-black/80">
              {pfCase.reason ?? "Power factor is healthy; no correction warranted."}
            </p>
          )}
        </Section>

        <Section title="Solar opportunity">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Recommended size" value={`${solar.recommendedKwp} kWp`} sub="best payback, low export" />
            <Metric label="Annual generation" value={energyLabel(solar.annualGenerationKwh)} sub={`${pct(solar.selfConsumptionPct)} self-consumed`} />
            <Metric label="Est. annual saving" value={moneyLabel(solar.annualSavingAud)} sub={`${moneyLabel(solar.lifetimeSavingAud)} over ${solar.assumptions.systemLifeYears}y`} />
            <Metric label="Simple payback" value={solar.simplePaybackYears ? `${solar.simplePaybackYears.toFixed(1)} yrs` : "—"} sub={`~${solarCo2.toFixed(0)} t CO₂/yr avoided`} />
          </div>
          <p className="mt-3 text-xs text-black/50">
            Indicative only. {solar.assumptions.yieldKwhPerKwpYear} kWh/kWp/yr (SE QLD), ~${solar.assumptions.installCostPerWatt.toFixed(2)}/W,
            {(solar.assumptions.degradationPerYear * 100).toFixed(1)}%/yr degradation, self-consumed kWh valued at {moneyLabel(avoidedRate)}/kWh.
          </p>
        </Section>

        <Section title="Emissions (Scope 2)">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Metric label="Location-based" value={`${emissions.locationTonnes.toFixed(0)} t CO₂-e/yr`} />
            <Metric label="Solar offset" value={`${solarCo2.toFixed(0)} t CO₂-e/yr`} />
            <Metric label="NGA factor" value={`${factor} t/MWh`} sub={emissions.factorYear} />
          </div>
          <p className="mt-2 text-[11px] text-black/50">
            Location-based Scope 2 using the NGA state factor. Market-based would be lower with GreenPower/LGCs/PPA.
            Confirm the current NGA factor before issuing.
          </p>
        </Section>

        <Section title="Basis & assumptions">
          <ul className="list-disc pl-5 text-xs text-black/60">
            <li>Costs modelled from interval meter data on {tariff.name} (network published; retail per the client&apos;s Origin invoice), ex-GST. Annualised from {modelled.days} days where shown as /yr.</li>
            <li>Loss factors: MLF {losses.mlf ?? "—"}, DLF {losses.dlf ?? "—"}. Retail energy peak window assumed 7am–9pm weekdays.</li>
            <li>{readings.length.toLocaleString("en-AU")} interval readings; {pct(summary.estimatedFraction)} estimated/substituted. Savings are indicative, not quotes; capex and PF/solar sizing need site assessment.</li>
          </ul>
        </Section>
      </div>
    </main>
  );
}
