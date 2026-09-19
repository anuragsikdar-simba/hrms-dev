import { Skeleton, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function HolidaysLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SkeletonPageHeader />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <SkeletonTable rows={7} columns={4} />
    </div>
  );
}
