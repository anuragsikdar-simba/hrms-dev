import * as React from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

const buttonVariants = {
  variant: {
    default:
      "bg-gray-900 text-white border-gray-900 hover:bg-black focus-visible:ring-gray-900",
    destructive:
      "text-red-700 border-red-300 bg-white hover:bg-red-50 focus-visible:ring-red-500",
    outline:
      "bg-white border-gray-200 text-gray-900 hover:bg-gray-50 focus-visible:ring-gray-400",
    secondary:
      "bg-gray-100 text-gray-900 border-gray-200 hover:bg-gray-200 focus-visible:ring-gray-400",
    ghost:
      "border-transparent bg-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-gray-400",
    link: "border-transparent bg-transparent text-gray-900 underline-offset-4 hover:underline focus-visible:ring-gray-400",
  },
  size: {
    default: "h-[30px] px-3 text-xs",
    sm: "h-[26px] px-2 text-[11px]",
    lg: "h-9 px-4 text-[13px]",
    icon: "h-[30px] w-[30px]",
  },
} as const;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof buttonVariants.variant;
  size?: keyof typeof buttonVariants.size;
  /** Show a spinner and disable interactions */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      loading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&>.ic]:h-[13px] [&>.ic]:w-[13px]",
        buttonVariants.variant[variant],
        buttonVariants.size[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
