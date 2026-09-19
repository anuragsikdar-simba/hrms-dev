"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Search, X } from "lucide-react";

export interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  /** Callback with the debounced value */
  onSearch?: (value: string) => void;
  /** Debounce delay in ms (default 300) */
  debounceMs?: number;
  /** Controlled value */
  value?: string;
  /** Direct onChange (non-debounced) */
  onChange?: (value: string) => void;
}

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      className,
      onSearch,
      debounceMs = 300,
      value: controlledValue,
      onChange,
      placeholder = "Search...",
      ...props
    },
    ref,
  ) => {
    const [internalValue, setInternalValue] = React.useState("");
    const isControlled = controlledValue !== undefined;
    const value = isControlled ? controlledValue : internalValue;

    // Debounced search callback
    const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleChange = React.useCallback(
      (val: string) => {
        if (!isControlled) setInternalValue(val);
        onChange?.(val);

        if (onSearch) {
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => onSearch(val), debounceMs);
        }
      },
      [isControlled, onChange, onSearch, debounceMs],
    );

    // Cleanup timer on unmount
    React.useEffect(() => {
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }, []);

    const handleClear = () => {
      handleChange("");
      onSearch?.("");
      if (timerRef.current) clearTimeout(timerRef.current);
    };

    return (
      <div className={cn("relative", className)}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          ref={ref}
          type="search"
          role="searchbox"
          aria-label="Search"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "flex h-10 w-full rounded-md border border-gray-300 bg-white pl-9 pr-9 text-sm",
            "placeholder:text-gray-400",
            "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "transition-colors",
          )}
          {...props}
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  },
);
SearchInput.displayName = "SearchInput";

export { SearchInput };
