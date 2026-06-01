// Placeholder landing page for the scaffold. Real routes live under
// app/(operator) (the operator console) and app/(client) (the read-only client view),
// and will be built from Phase 1 onwards. See CLAUDE.md §7 for the phased plan.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">NEMS Insight</h1>
      <p className="text-foreground/70">
        Energy monitoring and analysis for Australian commercial &amp; industrial
        businesses. This is the project scaffold — features are built in phases (see{" "}
        <code>CLAUDE.md</code>).
      </p>
    </main>
  );
}
