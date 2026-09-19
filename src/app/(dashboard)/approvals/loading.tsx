import { Skeleton, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function ApprovalsLoading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />

      {/* Filter tabs */}
      <div className="flex gap-2 border-b border-[var(--border)] pb-2">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>

      {/* Queue table */}
      <SkeletonTable rows={6} columns={5} />
    </div>
  );
}
