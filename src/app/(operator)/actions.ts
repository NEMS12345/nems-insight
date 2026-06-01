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

  await createSite({
    clientId,
    name,
    address: str(formData, "address") || undefined,
    state: str(formData, "state") || undefined,
    network: str(formData, "network") || undefined,
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

  await createMeteringPoint({
    siteId,
    clientId,
    nmi,
    meterSerial: str(formData, "meterSerial") || undefined,
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
  const billedTotal = Number(str(formData, "billedTotal"));
  if (!meteringPointId || !clientId || !periodStart || !periodEnd) return;
  if (!Number.isFinite(billedTotal)) return;

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
  });

  revalidatePath(`/metering-points/${meteringPointId}`);
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
