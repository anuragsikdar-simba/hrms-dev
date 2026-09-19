import { Skeleton, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function IpAllowlistLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SkeletonPageHeader />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <div className="space-y-6">
        <SkeletonTable rows={4} columns={4} />
        <SkeletonTable rows={3} columns={3} />
      </div>
    </div>
  );
}
