import * as React from "react";
import { cn } from "@/lib/utils";
import { Inbox, type LucideIcon } from "lucide-react";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Lucide icon component */
  icon?: LucideIcon;
  /** Headline */
  title?: string;
  /** Supporting text */
  description?: string;
  /** Primary action (render a button/link here) */
  action?: React.ReactNode;
}

function EmptyState({
  icon: Icon = Inbox,
  title = "No data found",
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-6 py-16 text-center",
        className,
      )}
      {...props}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
        <Icon className="h-7 w-7 text-gray-400" aria-hidden="true" />
      </div>
      {title && (
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      )}
      {description && (
        <p className="max-w-sm text-sm text-gray-500">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export { EmptyState };
