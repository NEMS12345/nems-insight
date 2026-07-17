import { PageSkeleton } from "@/components/PageSkeleton";

export default function Loading() {
  // The metering-point page is the heaviest: readings + analytics + cost engine + reconciliation.
  return <PageSkeleton cards={5} />;
}
