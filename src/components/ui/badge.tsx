import * as React from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Variant styles                                                     */
/* ------------------------------------------------------------------ */

const pillVariants = {
  green: "bg-green-50 text-green-700 border-green-300",
  amber: "bg-amber-50 text-amber-700 border-amber-300",
  red: "bg-red-50 text-red-700 border-red-300",
  purple: "bg-purple-50 text-purple-700 border-purple-300",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  slate: "bg-gray-100 text-gray-600 border-gray-300",
  /* semantic aliases (backward compat) */
  default: "bg-blue-50 text-blue-700 border-blue-200",
  success: "bg-green-50 text-green-700 border-green-300",
  warning: "bg-amber-50 text-amber-700 border-amber-300",
  destructive: "bg-red-50 text-red-700 border-red-300",
  secondary: "bg-gray-100 text-gray-600 border-gray-300",
  outline: "bg-transparent text-gray-700 border-gray-300",
} as const;

export type BadgeVariant = keyof typeof pillVariants;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** Show a small colored dot before the label */
  dot?: boolean;
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", dot = false, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 px-[7px] py-[1px] rounded-full text-[10px] font-semibold tracking-wide border transition-colors",
        pillVariants[variant],
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          className="h-[5px] w-[5px] rounded-full shrink-0"
          style={{ background: "currentColor" }}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  ),
);
Badge.displayName = "Badge";

/** Alias for Badge - matches design language ("Pill") */
const Pill = Badge;

// Keep old export name for backward compat
const badgeVariants = pillVariants;

export { Badge, Pill, badgeVariants, pillVariants };
