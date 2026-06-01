import Link from "next/link";
import { redirect } from "next/navigation";
import { getOperatorContext } from "@/data/repositories/session";
import { signOutAction } from "./actions";

/**
 * Guards the whole operator console: anyone who isn't a signed-in operator is sent to
 * /login. v1's only logged-in users are operators (CLAUDE.md §3).
 */
export default async function OperatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getOperatorContext();
  if (!ctx) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-black/10 px-6 py-3">
        <Link href="/" className="font-semibold">
          NEMS Insight
        </Link>
        <div className="flex items-center gap-4 text-sm text-foreground/60">
          <span>{ctx.email}</span>
          <form action={signOutAction}>
            <button type="submit" className="underline">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-6">{children}</main>
    </div>
  );
}
