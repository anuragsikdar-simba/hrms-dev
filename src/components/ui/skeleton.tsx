import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Loading placeholders.
 *
 * Why skeletons instead of a spinner: a spinner says "something is happening
 * somewhere". A skeleton says "a table with six rows is arriving here". The
 * second reads as faster even when the wait is identical, because the layout
 * stops jumping once real data lands.
 *
 * Rules for using these:
 * - Match the SHAPE of the real content (same rows, columns, card count). A
 *   skeleton that does not match causes a visible reflow on load, which is
 *   worse than no skeleton at all.
 * - Only `opacity` animates (`animate-pulse`), so this stays off the main
 *   thread and costs nothing to render.
 * - `motion-reduce:animate-none` honours prefers-reduced-motion — the shapes
 *   still convey structure without the pulsing.
 */

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-md bg-gray-100 motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Stacked text lines. The last line is short so it reads as a paragraph
 * instead of a solid block.
 */
function SkeletonText({
  lines = 3,
  className,
  ...props
}: SkeletonProps & { lines?: number }) {
  return (
    <div className={cn("space-y-2", className)} {...props}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3.5", i === lines - 1 ? "w-2/5" : "w-full")}
        />
      ))}
    </div>
  );
}

/** Page title + subtitle block, matching the dashboard page headers. */
function SkeletonPageHeader({ className, ...props }: SkeletonProps) {
  return (
    <div className={cn("space-y-2", className)} {...props}>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

/**
 * Table placeholder including the header row, so the column rhythm is already
 * on screen before the data arrives.
 */
function SkeletonTable({
  rows = 6,
  columns = 5,
  className,
  ...props
}: SkeletonProps & { rows?: number; columns?: number }) {
  return (
    <div
      className={cn("overflow-hidden rounded-lg border border-[var(--border)] bg-white", className)}
      {...props}
    >
      <div className="flex items-center gap-4 border-b border-[var(--border)] bg-gray-50/60 px-4 py-3">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className={cn("h-3", i === 0 ? "w-40" : "flex-1 max-w-[7rem]")} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className="flex items-center gap-4 border-b border-[var(--border)] px-4 py-3.5 last:border-b-0"
        >
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton
              key={c}
              className={cn("h-4", c === 0 ? "w-40" : "flex-1 max-w-[7rem]")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A single bordered card with a title and a few lines of body. */
function SkeletonCard({
  lines = 3,
  className,
  ...props
}: SkeletonProps & { lines?: number }) {
  return (
    <div
      className={cn("rounded-lg border border-[var(--border)] bg-white p-4", className)}
      {...props}
    >
      <Skeleton className="mb-4 h-4 w-32" />
      <SkeletonText lines={lines} />
    </div>
  );
}

/** Row of KPI/stat tiles, as used on the dashboard and Team Insights. */
function SkeletonStats({
  count = 4,
  className,
  ...props
}: SkeletonProps & { count?: number }) {
  return (
    <div
      className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}
      {...props}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border border-[var(--border)] bg-white p-4">
          <div className="flex items-start justify-between">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-9 rounded-lg" />
          </div>
          <Skeleton className="mt-3 h-7 w-16" />
          <Skeleton className="mt-2 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** List of avatar + two-line rows (people lists, activity feeds). */
function SkeletonList({
  rows = 5,
  className,
  ...props
}: SkeletonProps & { rows?: number }) {
  return (
    <div className={cn("space-y-3", className)} {...props}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export {
  Skeleton,
  SkeletonText,
  SkeletonPageHeader,
  SkeletonTable,
  SkeletonCard,
  SkeletonStats,
  SkeletonList,
};
