import { Skeleton, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function AttendanceLoading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />

      {/* Filter / action toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>

      {/* Attendance records table */}
      <SkeletonTable rows={8} columns={6} />
    </div>
  );
}
