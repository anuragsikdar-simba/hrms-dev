import { SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function OnboardingLoading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />
      <SkeletonTable rows={6} columns={5} />
    </div>
  );
}
