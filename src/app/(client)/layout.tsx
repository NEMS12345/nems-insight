import { redirect } from "next/navigation";
import { getOperatorContext } from "@/data/repositories/session";

/**
 * The read-only client reporting view. For v1 only operators are signed in (they generate
 * and preview the report); the same routes become the client-facing portal later via a
 * narrower RLS role. Deliberately chrome-free so it prints cleanly to PDF.
 */
export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  return <div className="min-h-screen bg-white">{children}</div>;
}
