import { createSupabaseServerClient } from "@/data/supabase/server";

export interface OperatorContext {
  userId: string;
  email: string | null;
  orgId: string;
}

/**
 * Returns the current operator's context (user + the org they operate), or null if the
 * caller is not signed in as an operator. Used by the operator console layout to guard
 * routes and to know which org new clients belong to.
 */
export async function getOperatorContext(): Promise<OperatorContext | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // RLS lets a user see only their own memberships.
  const { data: membership } = await supabase
    .from("org_member")
    .select("org_id, role")
    .eq("role", "operator")
    .limit(1)
    .maybeSingle();

  if (!membership) return null;

  return { userId: user.id, email: user.email ?? null, orgId: membership.org_id };
}
