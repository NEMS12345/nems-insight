"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOperatorContext } from "@/data/repositories/session";
import { createClient } from "@/data/repositories/clients";
import { createSite, getSite } from "@/data/repositories/sites";
import {
  createMeteringPoint,
  updateMeteringPointSettings,
} from "@/data/repositories/meteringPoints";
import {
  meteringPointRefsForSite,
  storeRawFile,
  createImportBatch,
  finishImportBatch,
  setBatchReviewState,
  upsertReadings,
  type ReadingInsert,
  type MeteringPointRef,
  type BatchReviewState,
} from "@/data/repositories/imports";
import { detectGaps } from "@/ingestion/validators/gaps";
import { summariseQuality } from "@/ingestion/validators/quality";
import { parseNem12 } from "@/ingestion/parsers/nem12";
import { parseMeterProfile } from "@/ingestion/parsers/meterProfile";
import { readMeterProfileRows } from "@/ingestion/parsers/xlsxRows";
import type { ParsedReading, ParseResult } from "@/ingestion/types";
import { createBill, deleteBill } from "@/data/repositories/bills";

import { createMarketPrice } from "@/data/repositories/marketPrices";
import { createEmissionsFactor } from "@/data/repositories/emissionsFactors";
import { upsertRetailContractVersion } from "@/data/repositories/retailContracts";
import {
  listAssignments,
  upsertAssignment,
  resolvePricingTimeline,
} from "@/data/repositories/assignments";
import { listNetworkTariffVersions } from "@/data/repositories/networkTariffs";
import {
  getMeteringPointDetail,
  getReadingsForMeteringPoint,
} from "@/data/repositories/readings";
import { listBillsForMeteringPoint } from "@/data/repositories/bills";
import {
  saveRun,
  triageFinding,
  signOffRun,
  reopenRun,
  type FindingStatus,
} from "@/data/repositories/reconciliations";
import { openRecovery, updateRecovery, type RecoveryState } from "@/data/repositories/recoveries";
import {
  billedComponents,
  billedBucketsTotal,
  componentKey,
  modelledComponents,
  periodIntervalCoverage,
  reconcile as reconcileComponents,
  deriveFindings,
  type BilledBuckets,
} from "@/core/reconciliation";
import { consumptionSummary, aestDate } from "@/core/analytics";
import {
  getTariff,
  pickEffective,
  computeVersionedFullCost,
  type RetailPlan,
} from "@/core/tariff";
import { createSupabaseServerClient } from "@/data/supabase/server";
import type { Client } from "@/core/types";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function createClientAction(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  const name = str(formData, "name");
  if (!name) return;

  const status = (str(formData, "status") || "prospect") as Client["status"];
  const client = await createClient({
    orgId: ctx.orgId,
    name,
    abn: str(formData, "abn") || undefined,
    status,
  });

  revalidatePath("/");
  redirect(`/clients/${client.id}`);
}

export async function createSiteAction(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  const clientId = str(formData, "clientId");
  const name = str(formData, "name");
  if (!clientId || !name) return;

  const floorArea = Number(str(formData, "floorAreaM2"));
  await createSite({
    clientId,
    name,
    address: str(formData, "address") || undefined,
    state: str(formData, "state") || undefined,
    network: str(formData, "network") || undefined,
    timezone: str(formData, "timezone") || undefined,
    floorAreaM2: Number.isFinite(floorArea) && floorArea > 0 ? floorArea : undefined,
  });

  revalidatePath(`/clients/${clientId}`);
}

export async function createMeteringPointAction(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  const siteId = str(formData, "siteId");
  const clientId = str(formData, "clientId");
  const nmi = str(formData, "nmi");
  if (!siteId || !clientId || !nmi) return;

  const mlf = Number(str(formData, "mlf"));
  const dlf = Number(str(formData, "dlf"));
  const assumedPf = Number(str(formData, "assumedPf"));
  const connectionUnits = Number(str(formData, "connectionUnits"));
  const voltage = str(formData, "connectionVoltage");
  await createMeteringPoint({
    siteId,
    clientId,
    nmi,
    meterSerial: str(formData, "meterSerial") || undefined,
    tariffCode: str(formData, "tariffCode") || undefined,
    mlf: Number.isFinite(mlf) && mlf > 0 ? mlf : undefined,
    dlf: Number.isFinite(dlf) && dlf > 0 ? dlf : undefined,
    connectionVoltage: voltage === "LV" || voltage === "HV" ? voltage : undefined,
    assumedPf: Number.isFinite(assumedPf) && assumedPf > 0 && assumedPf <= 1 ? assumedPf : undefined,
    connectionUnits: Number.isFinite(connectionUnits) && connectionUnits > 0 ? connectionUnits : undefined,
  });

  revalidatePath(`/sites/${siteId}`);
}

export async function updateMeteringPointSettingsAction(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  const meteringPointId = str(formData, "meteringPointId");
  if (!meteringPointId) return;

  const mlf = Number(str(formData, "mlf"));
  const dlf = Number(str(formData, "dlf"));
  const assumedPf = Number(str(formData, "assumedPf"));
  const connectionUnits = Number(str(formData, "connectionUnits"));
  const voltage = str(formData, "connectionVoltage");
  await updateMeteringPointSettings(meteringPointId, {
    tariffCode: str(formData, "tariffCode") || undefined,
    mlf: Number.isFinite(mlf) && mlf > 0 ? mlf : undefined,
    dlf: Number.isFinite(dlf) && dlf > 0 ? dlf : undefined,
    connectionVoltage: voltage === "LV" || voltage === "HV" ? voltage : undefined,
    assumedPf: Number.isFinite(assumedPf) && assumedPf > 0 && assumedPf <= 1 ? assumedPf : undefined,
    connectionUnits: Number.isFinite(connectionUnits) && connectionUnits > 0 ? connectionUnits : undefined,
  });

  revalidatePath(`/metering-points/${meteringPointId}`);
}

export async function importDataAction(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  const siteId = str(formData, "siteId");
  const file = formData.get("file");
  if (!siteId || !(file instanceof File) || file.size === 0) return;

  const site = await getSite(siteId);
  if (!site) return;
  const clientId = site.clientId;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // Pick the parser by file type: xlsx -> meter-profile export, otherwise NEM12 text.
  const isXlsx =
    /\.xlsx$/i.test(file.name) || file.type.includes("spreadsheet");
  let result: ParseResult;
  let format: string;
  if (isXlsx) {
    format = "MeterProfile";
    result = parseMeterProfile(await readMeterProfileRows(bytes));
  } else {
    format = "NEM12";
    result = parseNem12(new TextDecoder().decode(bytes));
  }
  const errors = [...result.errors];
  const warnings = [...result.warnings];

  // Keep the original file verbatim so we can always re-parse from source.
  let rawFileId: string | null = null;
  try {
    rawFileId = await storeRawFile({
      clientId,
      storagePath: `${clientId}/${Date.now()}-${file.name}`,
      filename: file.name,
      contentType: file.type || (isXlsx ? "application/octet-stream" : "text/plain"),
      byteSize: file.size,
      sha256,
      bytes,
    });
  } catch (e) {
    warnings.push(`Original file could not be stored: ${(e as Error).message}`);
  }

  const batchId = await createImportBatch({ clientId, rawFileId, filename: file.name, format });

  // Match each reading to a metering point. A reading with a meter serial matches by
  // (NMI, serial); without one (NEM12), it matches the site's single point for that NMI.
  const refs = await meteringPointRefsForSite(siteId);
  const byNmiSerial = new Map<string, MeteringPointRef>();
  const byNmi = new Map<string, MeteringPointRef[]>();
  for (const ref of refs) {
    byNmiSerial.set(`${ref.nmi}|${ref.meterSerial ?? ""}`, ref);
    const arr = byNmi.get(ref.nmi) ?? [];
    arr.push(ref);
    byNmi.set(ref.nmi, arr);
  }
  const matchRef = (r: ParsedReading): MeteringPointRef | undefined => {
    if (r.meterSerial != null) return byNmiSerial.get(`${r.nmi}|${r.meterSerial}`);
    const arr = byNmi.get(r.nmi);
    if (!arr || arr.length === 0) return undefined;
    return arr.find((a) => a.meterSerial == null) ?? (arr.length === 1 ? arr[0] : undefined);
  };

  const unmatched = new Set<string>();
  const rows: ReadingInsert[] = [];
  for (const r of result.readings) {
    const mp = matchRef(r);
    if (!mp) {
      unmatched.add(r.meterSerial ? `${r.nmi} / meter ${r.meterSerial}` : r.nmi);
      continue;
    }
    rows.push({
      clientId: mp.clientId,
      meteringPointId: mp.id,
      channel: r.channel,
      intervalStart: r.intervalStart,
      intervalLength: r.intervalLength,
      value: r.value,
      unit: r.unit,
      quality: r.quality,
      importBatchId: batchId,
    });
  }
  for (const u of unmatched) {
    warnings.push(
      `${u} in the file is not configured under this site — its readings were skipped.`,
    );
  }

  try {
    await upsertReadings(rows);
  } catch (e) {
    errors.push(`Failed to save readings: ${(e as Error).message}`);
  }

  // [v1.1] Quality gate evidence: the validator's summary lands on the batch so the
  // operator can accept it (or demand re-data) with the facts in front of them.
  const q = summariseQuality(result.readings);
  const gaps = detectGaps(result.readings);
  const qualitySummary = {
    total: q.total,
    actual: q.byFlag.actual,
    substituted: q.byFlag.substituted,
    finalSubstituted: q.byFlag["final-substituted"],
    estimated: q.byFlag.estimated,
    missing: q.byFlag.null,
    nonActualFraction: q.nonActualFraction,
    gapCount: gaps.length,
    missingIntervals: gaps.reduce((s, g) => s + g.missingIntervals, 0),
  };

  const status =
    rows.length === 0 ? "failed" : errors.length > 0 ? "partial" : "parsed";
  await finishImportBatch({
    id: batchId,
    status,
    readingCount: rows.length,
    errors,
    warnings,
    qualitySummary,
  });

  revalidatePath(`/sites/${siteId}`);
}

/**
 * [v1.1] The quality-gate verdict: accept a batch (its readings may feed cost and
 * reconciliation) or mark it needs re-data (it feeds nothing until re-supplied).
 */
export async function reviewImportBatchAction(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  const batchId = str(formData, "batchId");
  const siteId = str(formData, "siteId");
  const state = str(formData, "state") as BatchReviewState;
  if (!batchId || !["accepted", "needs_redata", "pending_review"].includes(state)) return;

  await setBatchReviewState(batchId, state);
  if (siteId) revalidatePath(`/sites/${siteId}`);
  revalidatePath("/");
}

export async function createBillAction(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  const meteringPointId = str(formData, "meteringPointId");
  const clientId = str(formData, "clientId");
  const periodStart = str(formData, "periodStart");
  const periodEnd = str(formData, "periodEnd");
  if (!meteringPointId || !clientId || !periodStart || !periodEnd) return;

  // A blank bucket means "not on this bill" (undefined); 0 is a deliberate zero.
  const bucket = (k: string): number | undefined => {
    const v = str(formData, k);
    if (v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const buckets: BilledBuckets = {
    energyPeak: bucket("energyPeak"),
    energyShoulder: bucket("energyShoulder"),
    energyOffpeak: bucket("energyOffpeak"),
    demand: bucket("demand"),
    supply: bucket("supply"),
    environmental: bucket("environmental"),
    market: bucket("market"),
    metering: bucket("metering"),
    other: bucket("other"),
  };
  const components = billedComponents(buckets);
  if (components.length === 0) return; // nothing entered — don't create an empty bill
  const billedTotal = billedBucketsTotal(buckets);

  const tariffCode = str(formData, "tariffCode") || undefined;
  const connectionUnits = Number(str(formData, "connectionUnits"));
  // Tariff display name from the DB registry (falls back to the code registry for safety).
  const tariffName = tariffCode
    ? (pickEffective(await listNetworkTariffVersions(tariffCode), periodStart)?.name ??
      getTariff(tariffCode)?.name)
    : undefined;
  await createBill({
    clientId,
    meteringPointId,
    retailer: str(formData, "retailer") || undefined,
    tariffCode,
    tariffName,
    periodStart,
    periodEnd,
    billedTotal,
    notes: str(formData, "notes") || undefined,
    connectionUnits:
      Number.isFinite(connectionUnits) && connectionUnits > 0 ? connectionUnits : undefined,
    components: components.map((c) => ({
      component: componentKey(c),
      label: c.label,
      amount: c.amount,
    })),
  });

  revalidatePath(`/metering-points/${meteringPointId}`);
}

export async function deleteBillAction(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  const billId = str(formData, "billId");
  const meteringPointId = str(formData, "meteringPointId");
  if (!billId) return;

  await deleteBill(billId);

  if (meteringPointId) revalidatePath(`/metering-points/${meteringPointId}`);
}

export async function createMarketPriceAction(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  const region = str(formData, "region") || "QLD";
  const futures = Number(str(formData, "futuresPerMwh"));
  if (!Number.isFinite(futures) || futures <= 0) return;

  await createMarketPrice({ orgId: ctx.orgId, region, futuresPerMwh: futures });
  revalidatePath("/");
}

export async function createEmissionsFactorAction(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  const region = str(formData, "region") || "QLD";
  const factor = Number(str(formData, "factorTPerMwh"));
  if (!Number.isFinite(factor) || factor <= 0) return;

  await createEmissionsFactor({
    orgId: ctx.orgId,
    region,
    factorTPerMwh: factor,
    ngaYear: str(formData, "ngaYear") || undefined,
  });
  revalidatePath("/");
}

/**
 * [v1.1] Save a retail contract version for an NMI. When the NMI already has an assignment,
 * the version is added to (or replaces, same date) its contract group; when it has none,
 * a new contract group is created AND the NMI is assigned (network side from the form's
 * tariff code) — so entering a contract is what takes an NMI out of the blocking state.
 */
export async function saveRetailContractAction(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  const meteringPointId = str(formData, "meteringPointId");
  const clientId = str(formData, "clientId");
  const peakRate = Number(str(formData, "peakRate"));
  const offpeakRate = Number(str(formData, "offpeakRate"));
  if (!meteringPointId || !clientId) return;
  if (!Number.isFinite(peakRate) || !Number.isFinite(offpeakRate)) return;

  const numOr = (key: string, fallback: number) => {
    const n = Number(str(formData, key));
    return Number.isFinite(n) ? n : fallback;
  };

  const label = str(formData, "label") || undefined;
  const retailer = str(formData, "retailer") || undefined;
  const effectiveFrom = str(formData, "effectiveFrom") || undefined;
  const rates: RetailPlan = {
    label: label ?? "Retail contract",
    peakRatePerKwh: peakRate,
    offpeakRatePerKwh: offpeakRate,
    peakWindow: {
      dayTypes: ["weekday"],
      ranges: [
        { startMin: numOr("peakStartHour", 7) * 60, endMin: numOr("peakEndHour", 21) * 60 },
      ],
    },
    environmentalPerKwh: numOr("environmentalRate", 0),
    marketPerKwh: numOr("marketRate", 0),
    supplyPerDay: numOr("supplyPerDay", 0),
    meteringPerDay: numOr("meteringPerDay", 0),
    ...(effectiveFrom ? { effectiveFrom } : {}),
    estimated: false,
  };

  const assignments = await listAssignments(meteringPointId);
  const current = pickEffective(assignments);
  const groupId = await upsertRetailContractVersion({
    clientId,
    groupId: current?.retailContractGroup,
    retailer,
    label,
    effectiveFrom,
    rates,
  });
  if (!current) {
    // First contract for this NMI: assign it (network side from the form's tariff code).
    const code = str(formData, "networkTariffCode");
    if (code) {
      await upsertAssignment({
        meteringPointId,
        clientId,
        networkTariffCode: code,
        retailContractGroup: groupId,
      });
    }
  }

  revalidatePath(`/metering-points/${meteringPointId}`);
}

/** [v1.1] Assign (or re-date) an NMI's network tariff code + retail contract group. */
export async function assignTariffAction(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  const meteringPointId = str(formData, "meteringPointId");
  const clientId = str(formData, "clientId");
  const networkTariffCode = str(formData, "networkTariffCode");
  const retailContractGroup = str(formData, "retailContractGroup");
  if (!meteringPointId || !clientId || !networkTariffCode || !retailContractGroup) return;

  await upsertAssignment({
    meteringPointId,
    clientId,
    networkTariffCode,
    retailContractGroup,
    effectiveFrom: str(formData, "effectiveFrom") || undefined,
  });
  revalidatePath(`/metering-points/${meteringPointId}`);
  revalidatePath("/");
}

/**
 * [v1.1] Run (or re-run) the reconciliation for one bill and persist it for review: the
 * pure core computes (modelled, billed) → findings with reason codes; this action only
 * gathers inputs and records the run. Uses quality-gated readings and the tariff/contract
 * versions effective during the bill's period — same maths as the metering-point page.
 */
export async function runReconciliationAction(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  const billId = str(formData, "billId");
  const meteringPointId = str(formData, "meteringPointId");
  if (!billId || !meteringPointId) return;

  const mp = await getMeteringPointDetail(meteringPointId);
  if (!mp) return;
  const bills = await listBillsForMeteringPoint(meteringPointId);
  const bill = bills.find((b) => b.id === billId);
  if (!bill) return;
  const fromInclusive = new Date(`${bill.periodStart}T00:00:00+10:00`).toISOString();
  const toExclusive = new Date(
    new Date(`${bill.periodEnd}T00:00:00+10:00`).getTime() + 86_400_000,
  ).toISOString();
  const [readings, pricing] = await Promise.all([
    getReadingsForMeteringPoint(meteringPointId, mp.clientId, {
      fromInclusive,
      toExclusive,
    }),
    resolvePricingTimeline(meteringPointId, bill.periodStart, bill.periodEnd),
  ]);
  if (!pricing.assigned) {
    throw new Error(`Cannot reconcile this bill: ${pricing.detail}`);
  }
  if (bill.billedComponents.length === 0) return; // total-only bill — nothing to triage
  const inPeriod = readings.filter((r) => {
    const d = aestDate(r.intervalStart);
    return d >= bill.periodStart && d <= bill.periodEnd;
  });
  const cost = computeVersionedFullCost(
    inPeriod,
    pricing.networkPeriods,
    pricing.retailPeriods,
    {
      mlf: mp.mlf ?? undefined,
      dlf: mp.dlf ?? undefined,
      assumedPf: mp.assumedPf ?? undefined,
      connectionUnits: bill.connectionUnits ?? mp.connectionUnits ?? undefined,
    },
  );
  const estimatedFraction = consumptionSummary(inPeriod).estimatedFraction;
  const coverage = periodIntervalCoverage(
    inPeriod,
    bill.periodStart,
    bill.periodEnd,
  );
  const result = reconcileComponents(modelledComponents(cost), bill.billedComponents, {
    estimatedDataPct: estimatedFraction,
    coverageFraction: coverage,
  });

  await saveRun({
    clientId: mp.clientId,
    meteringPointId,
    billId,
    periodStart: bill.periodStart,
    periodEnd: bill.periodEnd,
    modelledTotal: result.modelledTotalAud,
    billedTotal: bill.billedTotal,
    judgement: result.judgement,
    coverageFraction: coverage,
    estimatedFraction,
    findings: deriveFindings(result),
  });

  revalidatePath("/review");
  redirect("/review");
}

/**
 * [v1.1] Triage one finding. Confirming an error automatically opens its recovery (the
 * chase to recovered dollars) with the variance as the identified amount.
 */
export async function triageFindingAction(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  const findingId = str(formData, "findingId");
  const clientId = str(formData, "clientId");
  const status = str(formData, "status") as FindingStatus;
  const variance = Number(str(formData, "variance"));
  if (!findingId || !clientId) return;
  if (!["confirmed_error", "queried", "dismissed", "within_tolerance", "open"].includes(status))
    return;

  await triageFinding({
    findingId,
    status,
    operatorNote: str(formData, "operatorNote") || undefined,
    recommendation: str(formData, "recommendation") || undefined,
  });
  if (status === "confirmed_error" && Number.isFinite(variance) && variance !== 0) {
    await openRecovery({ clientId, findingId, amountIdentified: Math.abs(variance) });
  }
  revalidatePath("/review");
  revalidatePath("/recovery");
}

/** [v1.1] Sign off a run (fails while findings are open); unlocks the client report. */
export async function signOffRunAction(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");
  const runId = str(formData, "runId");
  if (!runId) return;
  await signOffRun(runId, ctx.userId);
  revalidatePath("/review");
}

/** [v1.1] Re-open a signed-off run — everything is per billing period and re-openable. */
export async function reopenRunAction(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");
  const runId = str(formData, "runId");
  if (!runId) return;
  await reopenRun(runId);
  revalidatePath("/review");
}

/** [v1.1] Advance a recovery through to_raise → query_lodged → responded → recovered. */
export async function updateRecoveryAction(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  const recoveryId = str(formData, "recoveryId");
  const state = str(formData, "state") as RecoveryState;
  if (!recoveryId) return;
  if (!["to_raise", "query_lodged", "responded", "recovered"].includes(state)) return;

  const amountRecovered = Number(str(formData, "amountRecovered"));
  await updateRecovery({
    recoveryId,
    state,
    amountRecovered: Number.isFinite(amountRecovered) && amountRecovered > 0 ? amountRecovered : undefined,
    retailerRef: str(formData, "retailerRef") || undefined,
    notes: str(formData, "notes") || undefined,
  });
  revalidatePath("/recovery");
  revalidatePath("/");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
