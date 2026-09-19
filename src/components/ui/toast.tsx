"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ToastVariant = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  variant: ToastVariant;
  title?: string;
  description?: string;
}

interface ToastContextValue {
  toasts: Toast[];
  toast: (opts: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Variant config                                                     */
/* ------------------------------------------------------------------ */

const variantStyles: Record<
  ToastVariant,
  { container: string; icon: React.ReactNode }
> = {
  success: {
    container: "border-green-200 bg-green-50",
    icon: <CheckCircle2 className="h-5 w-5 text-green-600" />,
  },
  error: {
    container: "border-red-200 bg-red-50",
    icon: <AlertCircle className="h-5 w-5 text-red-600" />,
  },
  warning: {
    container: "border-yellow-200 bg-yellow-50",
    icon: <AlertTriangle className="h-5 w-5 text-yellow-600" />,
  },
  info: {
    container: "border-blue-200 bg-blue-50",
    icon: <Info className="h-5 w-5 text-blue-600" />,
  },
};

/* ------------------------------------------------------------------ */
/*  ToastItem                                                          */
/* ------------------------------------------------------------------ */

function ToastItem({
  toast: t,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  const { container, icon } = variantStyles[t.variant];

  React.useEffect(() => {
    const timer = setTimeout(() => onDismiss(t.id), 5000);
    return () => clearTimeout(timer);
  }, [t.id, onDismiss]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border p-4 shadow-lg transition-all",
        "animate-in slide-in-from-bottom-5 fade-in-0",
        container,
      )}
    >
      <span className="shrink-0 pt-0.5">{icon}</span>
      <div className="flex-1 space-y-1">
        {t.title && (
          <p className="text-sm font-semibold text-gray-900">{t.title}</p>
        )}
        {t.description && (
          <p className="text-sm text-gray-600">{t.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(t.id)}
        aria-label="Dismiss notification"
        className="shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-600"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ToastProvider                                                      */
/* ------------------------------------------------------------------ */

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const toast = React.useCallback((opts: Omit<Toast, "id">) => {
    const id = `toast-${++counter}-${Date.now()}`;
    setToasts((prev) => [...prev, { ...opts, id }]);
  }, []);

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = React.useMemo(
    () => ({ toasts, toast, dismiss }),
    [toasts, toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted &&
        createPortal(
          <div
            aria-label="Notifications"
            className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2"
          >
            {toasts.map((t) => (
              <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
