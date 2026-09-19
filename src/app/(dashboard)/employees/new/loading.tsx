import { Skeleton, SkeletonCard, SkeletonPageHeader } from "@/components/ui/skeleton";

export default function NewEmployeeLoading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />
      <div className="grid gap-6 md:grid-cols-2">
        <SkeletonCard lines={6} />
        <SkeletonCard lines={6} />
      </div>
    </div>
  );
}
