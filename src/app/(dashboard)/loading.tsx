import { SkeletonPageHeader, SkeletonTable, SkeletonStats } from "@/components/ui/skeleton";

export default function DashboardRootLoading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />
      <SkeletonStats count={4} />
      <SkeletonTable rows={6} columns={5} />
    </div>
  );
}
