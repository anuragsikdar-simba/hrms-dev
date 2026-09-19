import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines clsx and tailwind-merge for conditional class name merging.
 * Handles Tailwind class conflicts intelligently.
 *
 * @example
 * cn("px-4 py-2", isActive && "bg-primary-600 text-white", className)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
