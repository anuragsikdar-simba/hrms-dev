import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function EmployeeDetailLoading() {
  return (
    <div className="space-y-6">
      {/* Back button */}
      <Skeleton className="h-4 w-32" />

      {/* Profile banner */}
      <div className="rounded-xl border border-[var(--border)] bg-white p-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-36" />
          </div>
        </div>
      </div>

      {/* Detail cards */}
      <div className="grid gap-6 md:grid-cols-2">
        <SkeletonCard lines={5} />
        <SkeletonCard lines={5} />
        <SkeletonCard lines={5} />
        <SkeletonCard lines={5} />
      </div>
    </div>
  );
}
