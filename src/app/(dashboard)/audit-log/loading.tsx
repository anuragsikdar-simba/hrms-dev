import { Skeleton, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function AuditLogLoading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />

      {/* Filter toolbar */}
      <div className="flex gap-3">
        <Skeleton className="h-9 w-40 rounded-md" />
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>

      {/* Audit table */}
      <SkeletonTable rows={10} columns={5} />
    </div>
  );
}
