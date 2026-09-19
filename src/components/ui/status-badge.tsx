import * as React from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Status config                                                      */
/* ------------------------------------------------------------------ */

const statusConfig = {
  active: {
    label: "Active",
    className: "bg-green-50 text-green-700 border-green-300",
  },
  pending: {
    label: "Pending",
    className: "bg-amber-50 text-amber-700 border-amber-300",
  },
  terminated: {
    label: "Terminated",
    className: "bg-red-50 text-red-700 border-red-300",
  },
  inactive: {
    label: "Inactive",
    className: "bg-gray-100 text-gray-600 border-gray-300",
  },
  on_leave: {
    label: "On Leave",
    className: "bg-purple-50 text-purple-700 border-purple-300",
  },
  probation: {
    label: "Probation",
    className: "bg-amber-50 text-amber-700 border-amber-300",
  },
  suspended: {
    label: "Suspended",
    className: "bg-red-50 text-red-700 border-red-300",
  },
  resigned: {
    label: "Resigned",
    className: "bg-purple-50 text-purple-700 border-purple-300",
  },
} as const;

export type EmployeeStatus = keyof typeof statusConfig;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  status: EmployeeStatus;
  /** Override the display label */
  label?: string;
  /** Show the colored dot indicator (default true) */
  showDot?: boolean;
}

const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ status, label, showDot = true, className, ...props }, ref) => {
    const config = statusConfig[status];

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1 px-[7px] py-[1px] rounded-full text-[10px] font-semibold tracking-wide border",
          config.className,
          className,
        )}
        {...props}
      >
        {showDot && (
          <span
            className="h-[5px] w-[5px] rounded-full shrink-0"
            style={{ background: "currentColor" }}
            aria-hidden="true"
          />
        )}
        {label || config.label}
      </span>
    );
  },
);
StatusBadge.displayName = "StatusBadge";

export { StatusBadge, statusConfig };
