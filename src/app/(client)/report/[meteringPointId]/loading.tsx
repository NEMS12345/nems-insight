import { PageSkeleton } from "@/components/PageSkeleton";

export default function Loading() {
  // The report composes the whole core (cost, reconciliation, solar, emissions) — can take a beat.
  return (
    <div className="mx-auto max-w-4xl p-8">
      <PageSkeleton cards={6} light />
    </div>
  );
}
