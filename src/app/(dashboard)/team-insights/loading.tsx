import { Skeleton, SkeletonPageHeader, SkeletonStats } from "@/components/ui/skeleton";

export default function TeamInsightsLoading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />

      {/* Period filter buttons */}
      <div className="flex gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>

      {/* KPI stats */}
      <SkeletonStats count={4} />

      {/* Charts placeholders */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-64 rounded-xl border border-[var(--border)] bg-white p-5">
          <Skeleton className="mb-4 h-5 w-36" />
          <Skeleton className="h-44 w-full rounded-lg" />
        </div>
        <div className="h-64 rounded-xl border border-[var(--border)] bg-white p-5">
          <Skeleton className="mb-4 h-5 w-36" />
          <Skeleton className="h-44 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
