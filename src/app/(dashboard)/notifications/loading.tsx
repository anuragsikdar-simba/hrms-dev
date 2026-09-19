import { SkeletonList, SkeletonPageHeader } from "@/components/ui/skeleton";

export default function NotificationsLoading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />
      <div className="rounded-xl border border-[var(--border)] bg-white p-5">
        <SkeletonList rows={8} />
      </div>
    </div>
  );
}
