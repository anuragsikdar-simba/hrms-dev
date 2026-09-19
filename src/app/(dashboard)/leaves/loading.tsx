import { Skeleton, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function LeavesLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SkeletonPageHeader />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>

      {/* Leave balance cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-lg border border-[var(--border)] bg-white p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-6 w-16" />
            <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>

      {/* Requests table */}
      <SkeletonTable rows={6} columns={6} />
    </div>
  );
}
