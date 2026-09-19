import { SkeletonCard, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function EmailNotificationsLoading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />
      <SkeletonCard lines={4} />
      <SkeletonTable rows={5} columns={4} />
    </div>
  );
}
