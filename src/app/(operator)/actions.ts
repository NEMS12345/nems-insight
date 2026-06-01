"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOperatorContext } from "@/data/repositories/session";
import { createClient } from "@/data/repositories/clients";
import { createSite, getSite } from "@/data/repositories/sites";
import { createMeteringPoint } from "@/data/repositories/meteringPoints";
import {
  meteringPointsByNmiForSite,
  storeRawFile,
  createImportBatch,
  finishImportBatch,
  upsertReadings,
  type ReadingInsert,
} from "@/data/repositories/imports";
import { parseNem12 } from "@/ingestion/parsers/nem12";
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

  await createMeteringPoint({ siteId, clientId, nmi });

  revalidatePath(`/sites/${siteId}`);
}

export async function importNem12Action(formData: FormData) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  const siteId = str(formData, "siteId");
  const file = formData.get("file");
  if (!siteId || !(file instanceof File) || file.size === 0) return;

  const site = await getSite(siteId);
  if (!site) return;
  const clientId = site.clientId;

  // Read the upload once; derive both the text (to parse) and bytes (to store + hash).
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const result = parseNem12(text);
  const errors = [...result.errors];
  const warnings = [...result.warnings];

  // Keep the original file verbatim so we can always re-parse from source.
  let rawFileId: string | null = null;
  try {
    rawFileId = await storeRawFile({
      clientId,
      storagePath: `${clientId}/${Date.now()}-${file.name}`,
      filename: file.name,
      contentType: file.type || "text/plain",
      byteSize: file.size,
      sha256,
      bytes,
    });
  } catch (e) {
    warnings.push(`Original file could not be stored: ${(e as Error).message}`);
  }

  const batchId = await createImportBatch({
    clientId,
    rawFileId,
    filename: file.name,
  });

  // Match each NMI in the file to a metering point configured under this site.
  const mpByNmi = await meteringPointsByNmiForSite(siteId);
  const unmatched = new Set<string>();
  const rows: ReadingInsert[] = [];

  for (const r of result.readings) {
    const mp = mpByNmi.get(r.nmi);
    if (!mp) {
      unmatched.add(r.nmi);
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
  for (const nmi of unmatched) {
    warnings.push(
      `NMI ${nmi} in the file is not configured under this site — its readings were skipped.`,
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

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
