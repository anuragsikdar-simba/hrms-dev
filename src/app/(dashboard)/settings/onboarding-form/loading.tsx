import { SkeletonCard, SkeletonPageHeader } from "@/components/ui/skeleton";

export default function OnboardingFormLoading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />
      <SkeletonCard lines={6} />
      <SkeletonCard lines={6} />
    </div>
  );
}
