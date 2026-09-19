"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Upload, File, X, Image as ImageIcon, AlertCircle, CheckCircle2 } from "lucide-react";

export interface UploadedFile {
  file: File;
  id: string;
  progress: number;
}

export interface FileUploadProps {
  label: string;
  accept?: string;
  maxSize?: number;
  multiple?: boolean;
  value: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  error?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function FileUpload({
  label,
  accept = ".pdf,.jpg,.jpeg,.png",
  maxSize = 2 * 1024 * 1024,
  multiple = false,
  value,
  onChange,
  error,
}: FileUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);

  const displayError = error || localError;

  const acceptedFormats = accept
    .split(",")
    .map((f) => f.trim().replace(".", "").toUpperCase())
    .join(", ");

  // Use a ref to always access the latest value without stale closures
  const valueRef = React.useRef(value);
  valueRef.current = value;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const simulateProgress = React.useCallback(
    (id: string) => {
      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 30 + 10;
        if (progress >= 100) {
          progress = 100;
          clearInterval(interval);
        }
        // Use refs to always read the latest value
        onChangeRef.current(
          valueRef.current.map((f) => (f.id === id ? { ...f, progress } : f)),
        );
      }, 200);
    },
    [],
  );

  const processFiles = React.useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      setLocalError(null);

      const files = Array.from(fileList);
      const acceptedExtensions = accept
        .split(",")
        .map((f) => f.trim().toLowerCase());

      const validFiles: UploadedFile[] = [];
      for (const file of files) {
        const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
        const mimeValid =
          acceptedExtensions.includes(ext) ||
          acceptedExtensions.some((a) => file.type.includes(a.replace(".", "")));

        if (!mimeValid) {
          setLocalError(
            `"${file.name}" is not an accepted format. Accepted: ${acceptedFormats}`,
          );
          return;
        }
        if (file.size > maxSize) {
          setLocalError(
            `"${file.name}" exceeds the maximum size of ${formatFileSize(maxSize)}.`,
          );
          return;
        }
        // Mark progress as 100 immediately (no actual upload happening yet,
        // real upload happens on form submit)
        validFiles.push({ file, id: generateId(), progress: 100 });
      }

      const currentVal = valueRef.current;
      const newFiles = multiple
        ? [...currentVal, ...validFiles]
        : validFiles.slice(0, 1);

      onChangeRef.current(newFiles);
    },
    [accept, acceptedFormats, maxSize, multiple],
  );

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      processFiles(e.dataTransfer.files);
    },
    [processFiles],
  );

  const handleRemove = (id: string) => {
    onChange(value.filter((f) => f.id !== id));
    setLocalError(null);
  };

  const isImage = (file: File) => file.type.startsWith("image/");

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">{label}</label>

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors",
          dragOver
            ? "border-blue-500 bg-blue-50"
            : displayError
              ? "border-red-300 bg-red-50"
              : "border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100",
        )}
      >
        <Upload
          className={cn(
            "h-8 w-8",
            dragOver ? "text-blue-500" : "text-gray-400",
          )}
        />
        <div>
          <p className="text-sm font-medium text-gray-700">
            Drag & drop {multiple ? "files" : "a file"} here, or{" "}
            <span className="text-blue-600 underline">browse</span>
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Accepted formats: {acceptedFormats} | Max size:{" "}
            {formatFileSize(maxSize)}
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          processFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Error */}
      {displayError && (
        <div className="flex items-center gap-1.5 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{displayError}</span>
        </div>
      )}

      {/* Uploaded files list */}
      {value.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {value.map((uploaded) => (
            <li
              key={uploaded.id}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
            >
              {isImage(uploaded.file) ? (
                <ImageIcon className="h-5 w-5 shrink-0 text-blue-500" />
              ) : (
                <File className="h-5 w-5 shrink-0 text-gray-500" />
              )}
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-gray-800">
                  {uploaded.file.name}
                </p>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs text-gray-500">
                    {formatFileSize(uploaded.file.size)}
                  </p>
                  {uploaded.progress >= 100 && (
                    <span className="inline-flex items-center gap-0.5 text-xs text-green-600 font-medium">
                      <CheckCircle2 className="h-3 w-3" />
                      Ready
                    </span>
                  )}
                </div>
                {uploaded.progress < 100 && (
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-200">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${uploaded.progress}%` }}
                    />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(uploaded.id);
                }}
                className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                aria-label={`Remove ${uploaded.file.name}`}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
