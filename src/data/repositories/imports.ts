import { createSupabaseServerClient } from "@/data/supabase/server";
import type { QualityFlag, ReadingUnit } from "@/core/types";

/** Private Supabase Storage bucket holding original uploaded files (create it once). */
export const RAW_FILES_BUCKET = "raw-files";

/** [v1.1] Validator output stored on the batch — the quality gate's evidence. */
export interface BatchQualitySummary {
  total: number;
  actual: number;
  substituted: number;
  finalSubstituted: number;
  estimated: number;
  missing: number;
  /** Fraction (0..1) of intervals that are NOT actual reads. */
  nonActualFraction: number;
  gapCount: number;
  missingIntervals: number;
}

export type BatchReviewState = "pending_review" | "accepted" | "needs_redata";

export interface ImportBatchSummary {
  id: string;
  filename: string | null;
  status: string;
  uploadedAt: string;
  readingCount: number;
  errorCount: number;
  warningCount: number;
  reviewState: BatchReviewState;
  qualitySummary: BatchQualitySummary | null;
}

export interface MeteringPointRef {
  id: string;
  clientId: string;
  nmi: string;
  meterSerial: string | null;
}

/** Every metering point configured under a site, for matching parsed readings. */
export async function meteringPointRefsForSite(
  siteId: string,
): Promise<MeteringPointRef[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("metering_point")
    .select("id, client_id, nmi, meter_serial")
    .eq("site_id", siteId);
  if (error) throw error;

  return (
    data as { id: string; client_id: string; nmi: string; meter_serial: string | null }[]
  ).map((row) => ({
    id: row.id,
    clientId: row.client_id,
    nmi: row.nmi,
    meterSerial: row.meter_serial,
  }));
}

export interface UploadedRawFile {
  clientId: string;
  storagePath: string;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  bytes: Uint8Array;
}

/** Store the original file bytes in Storage and record a raw_file row. Returns its id. */
export async function storeRawFile(file: UploadedRawFile): Promise<string> {
  const supabase = await createSupabaseServerClient();

  const { error: uploadError } = await supabase.storage
    .from(RAW_FILES_BUCKET)
    .upload(file.storagePath, file.bytes, {
      contentType: file.contentType,
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("raw_file")
    .insert({
      client_id: file.clientId,
      storage_path: file.storagePath,
      filename: file.filename,
      content_type: file.contentType,
      byte_size: file.byteSize,
      sha256: file.sha256,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function createImportBatch(params: {
  clientId: string;
  rawFileId: string | null;
  filename: string;
  format: string;
}): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("import_batch")
    .insert({
      client_id: params.clientId,
      raw_file_id: params.rawFileId,
      filename: params.filename,
      format: params.format,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function finishImportBatch(params: {
  id: string;
  status: "parsed" | "partial" | "failed";
  readingCount: number;
  errors: string[];
  warnings: string[];
  qualitySummary?: BatchQualitySummary;
}): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("import_batch")
    .update({
      status: params.status,
      reading_count: params.readingCount,
      error_count: params.errors.length,
      warning_count: params.warnings.length,
      errors: params.errors,
      warnings: params.warnings,
      ...(params.qualitySummary ? { quality_summary: params.qualitySummary } : {}),
    })
    .eq("id", params.id);
  if (error) throw error;
}

/**
 * [v1.1] The quality gate's operator verdict: a batch feeds cost/reconciliation only once
 * ACCEPTED; "needs_redata" keeps it (and its readings) quarantined until re-supplied.
 */
export async function setBatchReviewState(
  batchId: string,
  state: BatchReviewState,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("import_batch")
    .update({ review_state: state })
    .eq("id", batchId);
  if (error) throw error;
}

/** Ids of a client's batches that are NOT accepted (the set the reading gate excludes). */
export async function nonAcceptedBatchIds(clientId: string): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("import_batch")
    .select("id")
    .eq("client_id", clientId)
    .neq("review_state", "accepted");
  if (error) throw error;
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

export interface ReadingInsert {
  clientId: string;
  meteringPointId: string;
  channel: string;
  intervalStart: string;
  intervalLength: number;
  value: number;
  unit: ReadingUnit;
  quality: QualityFlag;
  importBatchId: string;
}

/** Upsert readings in chunks (re-importing a file updates rather than duplicates). */
export async function upsertReadings(rows: ReadingInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const supabase = await createSupabaseServerClient();

  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({
      client_id: r.clientId,
      metering_point_id: r.meteringPointId,
      channel: r.channel,
      interval_start: r.intervalStart,
      interval_length: r.intervalLength,
      value: r.value,
      unit: r.unit,
      quality: r.quality,
      import_batch_id: r.importBatchId,
    }));
    const { error } = await supabase
      .from("interval_reading")
      .upsert(chunk, { onConflict: "metering_point_id,channel,interval_start" });
    if (error) throw error;
  }
}

export async function listImportBatchesForClient(
  clientId: string,
): Promise<ImportBatchSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("import_batch")
    .select(
      "id, filename, status, uploaded_at, reading_count, error_count, warning_count, review_state, quality_summary",
    )
    .eq("client_id", clientId)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;

  return (
    data as {
      id: string;
      filename: string | null;
      status: string;
      uploaded_at: string;
      reading_count: number;
      error_count: number;
      warning_count: number;
      review_state: BatchReviewState;
      quality_summary: BatchQualitySummary | null;
    }[]
  ).map((r) => ({
    id: r.id,
    filename: r.filename,
    status: r.status,
    uploadedAt: r.uploaded_at,
    readingCount: r.reading_count,
    errorCount: r.error_count,
    warningCount: r.warning_count,
    reviewState: r.review_state,
    qualitySummary: r.quality_summary,
  }));
}
