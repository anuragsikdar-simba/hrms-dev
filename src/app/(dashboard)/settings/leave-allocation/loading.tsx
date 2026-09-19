import { SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function LeaveAllocationLoading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />
      <SkeletonTable rows={4} columns={4} />
    </div>
  );
}
