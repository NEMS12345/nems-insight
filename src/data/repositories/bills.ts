import { createSupabaseServerClient } from "@/data/supabase/server";

export interface Bill {
  id: string;
  clientId: string;
  meteringPointId: string;
  retailer: string | null;
  tariffCode: string | null;
  tariffName: string | null;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  billedTotal: number; // ex-GST
  notes: string | null;
  createdAt: string;
}

interface BillRow {
  id: string;
  client_id: string;
  metering_point_id: string;
  retailer: string | null;
  tariff_code: string | null;
  tariff_name: string | null;
  period_start: string;
  period_end: string;
  billed_total: number | string;
  notes: string | null;
  created_at: string;
}

function toBill(r: BillRow): Bill {
  return {
    id: r.id,
    clientId: r.client_id,
    meteringPointId: r.metering_point_id,
    retailer: r.retailer,
    tariffCode: r.tariff_code,
    tariffName: r.tariff_name,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    billedTotal: Number(r.billed_total) || 0,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

const COLS =
  "id, client_id, metering_point_id, retailer, tariff_code, tariff_name, period_start, period_end, billed_total, notes, created_at";

export async function listBillsForMeteringPoint(
  meteringPointId: string,
): Promise<Bill[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("bill")
    .select(COLS)
    .eq("metering_point_id", meteringPointId)
    .order("period_start", { ascending: false });
  if (error) throw error;
  return (data as BillRow[]).map(toBill);
}

export interface NewBill {
  clientId: string;
  meteringPointId: string;
  retailer?: string;
  tariffCode?: string;
  tariffName?: string;
  periodStart: string;
  periodEnd: string;
  billedTotal: number;
  notes?: string;
}

export async function createBill(input: NewBill): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("bill")
    .insert({
      client_id: input.clientId,
      metering_point_id: input.meteringPointId,
      retailer: input.retailer || null,
      tariff_code: input.tariffCode || null,
      tariff_name: input.tariffName || null,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      billed_total: input.billedTotal,
      notes: input.notes || null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}
