"use client";

import { CheckCircle2, FileUp, XCircle } from "lucide-react";
import { useId, useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

export interface UploadState {
  file: File;
  /** 0–100, or null while unknown. */
  progress: number | null;
  status: "uploading" | "done" | "failed";
  error?: string;
}

export interface FileDropzoneProps {
  /** Allowed types: extensions (".csv") and/or MIME types ("text/csv", "image/*"). */
  accept: string[];
  /** Maximum size per file in bytes. */
  maxBytes: number;
  multiple?: boolean;
  label?: string;
  hint?: string;
  disabled?: boolean;
  /** Valid files, when the page uploads them itself. */
  onFiles?: (files: File[]) => void;
  /** Or let the dropzone upload each valid file and show progress (e.g. axios onUploadProgress). */
  upload?: (file: File, onProgress: (percent: number) => void) => Promise<void>;
  className?: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Check one file against the allowed types and size; returns an error message or null. */
export function validateFile(file: File, accept: string[], maxBytes: number): string | null {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  const ok =
    accept.length === 0 ||
    accept.some((a) => {
      const rule = a.trim().toLowerCase();
      if (rule.startsWith(".")) return name.endsWith(rule);
      if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
      return type === rule;
    });
  if (!ok) return `${file.name}: this file type isn't allowed. Use ${accept.join(", ")}.`;
  if (file.size > maxBytes) return `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(maxBytes)}.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

/** Drag-and-drop or browse, with type/size validation and per-file progress (3.8 §7). */
export function FileDropzone({ accept, maxBytes, multiple, label = "Upload a file", hint, disabled, onFiles, upload, className }: FileDropzoneProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [uploads, setUploads] = useState<UploadState[]>([]);

  const take = (list: FileList | File[] | null) => {
    if (!list || disabled) return;
    const files = Array.from(list).slice(0, multiple ? undefined : 1);
    const problems: string[] = [];
    const valid: File[] = [];
    files.forEach((f) => {
      const problem = validateFile(f, accept, maxBytes);
      if (problem) problems.push(problem);
      else valid.push(f);
    });
    setErrors(problems);
    if (!valid.length) return;
    onFiles?.(valid);
    if (upload) {
      setUploads((prev) => [...prev.filter((u) => u.status === "uploading"), ...valid.map((file) => ({ file, progress: 0, status: "uploading" as const }))]);
      valid.forEach((file) => {
        const set = (patch: Partial<UploadState>) => setUploads((prev) => prev.map((u) => (u.file === file ? { ...u, ...patch } : u)));
        upload(file, (percent) => set({ progress: Math.max(0, Math.min(100, Math.round(percent))) }))
          .then(() => set({ status: "done", progress: 100 }))
          .catch((err) => set({ status: "failed", error: errorMessage(err) }));
      });
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer?.files ?? null);
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors",
          over ? "border-primary bg-primary-soft/50" : "border-border bg-surface-muted/40",
          disabled && "opacity-60",
        )}
        data-dragging={over || undefined}
      >
        <FileUp className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground" id={`${id}-hint`}>
          {hint ?? `Drag a file here or browse. ${accept.join(", ")} · up to ${formatBytes(maxBytes)}`}
        </p>
        <Button variant="secondary" className="min-h-[44px]" disabled={disabled} onClick={() => input.current?.click()} aria-describedby={`${id}-hint`}>
          Browse files
        </Button>
        <input
          ref={input}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label={label}
          accept={accept.join(",")}
          multiple={multiple}
          disabled={disabled}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="space-y-1 text-sm text-danger">
          {errors.map((m) => (
            <li key={m} className="flex items-start gap-1.5">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {m}
            </li>
          ))}
        </ul>
      )}
      {uploads.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {uploads.map((u) => (
            <li key={`${u.file.name}-${u.file.size}-${u.file.lastModified}`} className="rounded-xl border border-border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{u.file.name}</span>
                <span className={cn("shrink-0 text-xs", u.status === "failed" ? "text-danger" : "text-muted-foreground")}>
                  {u.status === "done" ? (
                    <span className="inline-flex items-center gap-1 text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                      Uploaded
                    </span>
                  ) : u.status === "failed" ? (
                    `Failed: ${u.error}`
                  ) : (
                    `${u.progress ?? 0}%`
                  )}
                </span>
              </div>
              {u.status === "uploading" && (
                <div
                  role="progressbar"
                  aria-label={`Uploading ${u.file.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={u.progress ?? undefined}
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${u.progress ?? 0}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
