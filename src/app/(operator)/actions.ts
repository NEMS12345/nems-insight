"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOperatorContext } from "@/data/repositories/session";
import { createClient } from "@/data/repositories/clients";
import { createSite } from "@/data/repositories/sites";
import { createMeteringPoint } from "@/data/repositories/meteringPoints";
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

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
