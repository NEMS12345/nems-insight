/**
 * A lightweight placeholder shown by a route's `loading.tsx` while its server component fetches
 * data and runs the cost engine. Next.js renders this instantly on navigation so the user gets
 * immediate "it's working" feedback instead of a frozen page. Mirrors the rough shape of the real
 * pages (title + a few cards) so the swap-in isn't jarring.
 */
export function PageSkeleton({ cards = 3, light = false }: { cards?: number; light?: boolean }) {
  const block = light ? "bg-black/5" : "bg-foreground/10";
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className={`h-7 w-1/2 rounded ${block}`} />
      <div className={`h-4 w-1/3 rounded ${block}`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`h-16 rounded ${block}`} />
        ))}
      </div>
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className={`h-32 rounded ${block}`} />
      ))}
    </div>
  );
}
