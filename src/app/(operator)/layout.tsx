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
    <div className="min-h-screen bg-bg">
      <div className="solar-flare-bar h-1" />
      <header className="flex items-center justify-between bg-sidebar px-6 py-3 text-white">
        <div className="flex items-center gap-5">
          <Link href="/" className="font-semibold tracking-tight">
            NEMS Insight
          </Link>
          <nav className="flex items-center gap-3 text-sm text-white/70">
            <Link href="/setup" className="hover:text-white">
              Setup
            </Link>
            <Link href="/review" className="hover:text-white">
              Review
            </Link>
            <Link href="/recovery" className="hover:text-white">
              Recovery
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm text-white/60">
          <span>{ctx.email}</span>
          <form action={signOutAction}>
            <button type="submit" className="hover:text-white">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-6">{children}</main>
    </div>
  );
}
