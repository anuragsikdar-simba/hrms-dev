import { Skeleton, SkeletonCard, SkeletonPageHeader } from "@/components/ui/skeleton";

export default function PunchLocationsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SkeletonPageHeader />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <div className="space-y-4">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
      </div>
    </div>
  );
}
