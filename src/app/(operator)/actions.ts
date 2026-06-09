"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOperatorContext } from "@/data/repositories/session";
import { createClient } from "@/data/repositories/clients";
import { createSite, getSite } from "@/data/repositories/sites";
import { createMeteringPoint } from "@/data/repositories/meteringPoints";
import {
  meteringPointRefsForSite,
  storeRawFile,
  createImportBatch,
  finishImportBatch,
  upsertReadings,
  type ReadingInsert,
  type MeteringPointRef,
} from "@/data/repositories/imports";
import { parseNem12 } from "@/ingestion/parsers/nem12";
import { parseMeterProfile } from "@/ingestion/parsers/meterProfile";
import { readMeterProfileRows } from "@/ingestion/parsers/xlsxRows";
import type { ParsedReading, ParseResult } from "@/ingestion/types";
import { createBill } from "@/data/repositories/bills";
import {
  billedComponents,
  billedBucketsTotal,
  componentKey,
  type BilledBuckets,
} from "@/core/reconciliation";
import { createMarketPrice } from "@/data/repositories/marketPrices";
import { createEmissionsFactor } from "@/data/repositories/emissionsFactors";
import { upsertRetailPlan } from "@/data/repositories/retailPlans";
import { getTariff } from "@/core/tariff";
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
  });

  revalidatePath(`/sites/${siteId}`);
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

  const status =
    rows.length === 0 ? "failed" : errors.length > 0 ? "partial" : "parsed";
  await finishImportBatch({
    id: batchId,
    status,
    readingCount: rows.length,
    errors,
    warnings,
  });

  revalidatePath(`/sites/${siteId}`);
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
  await createBill({
    clientId,
    meteringPointId,
    retailer: str(formData, "retailer") || undefined,
    tariffCode,
    tariffName: tariffCode ? getTariff(tariffCode)?.name : undefined,
    periodStart,
    periodEnd,
    billedTotal,
    notes: str(formData, "notes") || undefined,
    components: components.map((c) => ({
      component: componentKey(c),
      label: c.label,
      amount: c.amount,
    })),
  });

  revalidatePath(`/metering-points/${meteringPointId}`);
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

export async function createRetailPlanAction(formData: FormData) {
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

  await upsertRetailPlan({
    meteringPointId,
    clientId,
    label: str(formData, "label") || undefined,
    peakRate,
    offpeakRate,
    peakStartHour: numOr("peakStartHour", 7),
    peakEndHour: numOr("peakEndHour", 21),
    environmentalRate: numOr("environmentalRate", 0),
    marketRate: numOr("marketRate", 0),
    supplyPerDay: numOr("supplyPerDay", 0),
    meteringPerDay: numOr("meteringPerDay", 0),
  });

  revalidatePath(`/metering-points/${meteringPointId}`);
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
