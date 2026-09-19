import { Skeleton, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function EmployeesLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SkeletonPageHeader />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>

      {/* Search and filter bar */}
      <div className="flex gap-3">
        <Skeleton className="h-9 w-full max-w-sm rounded-md" />
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>

      {/* Employees table */}
      <SkeletonTable rows={8} columns={6} />
    </div>
  );
}
