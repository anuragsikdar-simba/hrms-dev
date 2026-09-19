import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PaginationProps extends React.HTMLAttributes<HTMLElement> {
  /** Current page (1-based) */
  currentPage: number;
  /** Total number of pages */
  totalPages: number;
  /** Total number of items */
  totalItems?: number;
  /** Items per page (for range display) */
  pageSize?: number;
  /** Page change callback */
  onPageChange: (page: number) => void;
  /** Maximum page buttons to show (default 5) */
  maxVisible?: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getPageNumbers(
  current: number,
  total: number,
  maxVisible: number,
): (number | "ellipsis")[] {
  if (total <= maxVisible) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "ellipsis")[] = [];
  const half = Math.floor(maxVisible / 2);
  let start = Math.max(2, current - half);
  let end = Math.min(total - 1, current + half);

  if (current - half <= 2) end = Math.min(total - 1, maxVisible - 1);
  if (current + half >= total - 1) start = Math.max(2, total - maxVisible + 2);

  pages.push(1);
  if (start > 2) pages.push("ellipsis");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push("ellipsis");
  if (total > 1) pages.push(total);

  return pages;
}

/* ------------------------------------------------------------------ */
/*  Pagination                                                         */
/* ------------------------------------------------------------------ */

function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  maxVisible = 5,
  className,
  ...props
}: PaginationProps) {
  const pages = getPageNumbers(currentPage, totalPages, maxVisible);

  const rangeStart =
    totalItems !== undefined && pageSize
      ? (currentPage - 1) * pageSize + 1
      : null;
  const rangeEnd =
    totalItems !== undefined && pageSize
      ? Math.min(currentPage * pageSize, totalItems)
      : null;

  return (
    <nav
      role="navigation"
      aria-label="Pagination"
      className={cn("flex items-center justify-between gap-4", className)}
      {...props}
    >
      {/* Range info */}
      {rangeStart !== null && totalItems !== undefined && (
        <p className="text-sm text-gray-600">
          Showing{" "}
          <span className="font-medium">{rangeStart}</span>
          {" - "}
          <span className="font-medium">{rangeEnd}</span>
          {" of "}
          <span className="font-medium">{totalItems}</span>
        </p>
      )}

      {/* Page buttons */}
      <div className="flex items-center gap-1">
        {/* Previous */}
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label="Previous page"
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-md text-sm transition-colors",
            "hover:bg-gray-100 disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {pages.map((page, idx) =>
          page === "ellipsis" ? (
            <span
              key={`ellipsis-${idx}`}
              className="flex h-9 w-9 items-center justify-center text-sm text-gray-400"
              aria-hidden
            >
              ...
            </span>
          ) : (
            <button
              key={page}
              type="button"
              onClick={() => onPageChange(page)}
              aria-current={page === currentPage ? "page" : undefined}
              aria-label={`Page ${page}`}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium transition-colors",
                page === currentPage
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-700 hover:bg-gray-100",
              )}
            >
              {page}
            </button>
          ),
        )}

        {/* Next */}
        <button
          type="button"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label="Next page"
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-md text-sm transition-colors",
            "hover:bg-gray-100 disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}

export { Pagination };
