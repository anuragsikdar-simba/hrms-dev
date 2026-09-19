import { Skeleton, SkeletonCard, SkeletonList, SkeletonPageHeader, SkeletonStats } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />

      {/* Main 2-column layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left 2 cols */}
        <div className="space-y-6 lg:col-span-2">
          {/* Today across August banner */}
          <div className="rounded-xl border border-[var(--border)] bg-white p-5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-44" />
              <div className="flex gap-2">
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            </div>
            <Skeleton className="mt-3 h-4 w-52" />
            <div className="mt-6 flex h-24 items-center justify-center rounded-lg bg-gray-50/70">
              <Skeleton className="h-4 w-48" />
            </div>
          </div>

          {/* Leave balance card */}
          <div className="rounded-xl border border-[var(--border)] bg-white p-5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
            <div className="mt-4 space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-3.5 w-16" />
                  </div>
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-6">
          <SkeletonCard lines={4} />
          <div className="rounded-xl border border-[var(--border)] bg-white p-5">
            <Skeleton className="mb-4 h-5 w-36" />
            <SkeletonList rows={4} />
          </div>
        </div>
      </div>

      {/* Lower Team Insights teaser */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-28" />
        </div>
        <SkeletonStats count={4} />
      </div>
    </div>
  );
}
