import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";

export default function PayrollRunDetailLoading() {
  return (
    <div className="space-y-6">
      {/* Back link + header */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      </div>

      {/* 3 summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-lg border border-[var(--border)] bg-white p-4">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-3 h-7 w-32" />
          </div>
        ))}
      </div>

      {/* Payslips table */}
      <SkeletonTable rows={6} columns={7} />
    </div>
  );
}
