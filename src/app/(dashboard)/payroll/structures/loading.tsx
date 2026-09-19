import { Skeleton, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function SalaryStructuresLoading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />
      <Skeleton className="h-9 w-full max-w-sm rounded-md" />
      <SkeletonTable rows={6} columns={5} />
    </div>
  );
}
