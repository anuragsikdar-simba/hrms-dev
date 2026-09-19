import { Skeleton, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function PayrollLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SkeletonPageHeader />
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>

      {/* Month/year + create card */}
      <div className="rounded-xl border border-[var(--border)] bg-white p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-9 w-36 rounded-md" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-9 w-28 rounded-md" />
          </div>
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </div>

      {/* Runs table */}
      <SkeletonTable rows={5} columns={6} />
    </div>
  );
}
