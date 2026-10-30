"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Download, FileText, Paperclip, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/primitives";
import { DOCUMENT_CATEGORIES, attachmentDownloadUrl, categoryLabel, leaveApi, leaveErrorMessage } from "@/lib/leave/api";
import type { LeaveAttachment } from "@/lib/leave/types";

const ACCEPT = "application/pdf,image/png,image/jpeg";

function size(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Upload a supporting document (`POST /leaves/attachments`, multipart `file` + `category`). For a saved request the
 * file is attached at once (`leave_id`); for a new one the returned id goes into `attachment_ids` on submit.
 */
export function AttachmentUploader({
  attachments,
  onUploaded,
  onRemove,
  leaveId,
  employeeId,
  suggestedCategory,
  disabled,
  readOnly,
}: {
  attachments: LeaveAttachment[];
  onUploaded: (attachment: LeaveAttachment) => void;
  /** Only for files not yet attached to a saved request (they are simply left out of `attachment_ids`). */
  onRemove?: (id: number) => void;
  leaveId?: number | null;
  employeeId?: number | null;
  suggestedCategory?: string | null;
  disabled?: boolean;
  /** List only (no upload controls). */
  readOnly?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<string>(suggestedCategory ?? "SUPPORTING_DOCUMENT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (suggestedCategory) setCategory(suggestedCategory);
  }, [suggestedCategory]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const row = await leaveApi.upload(file, category, { leaveId, employeeId });
      onUploaded(row);
    } catch (e) {
      setError(leaveErrorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="space-y-2" data-testid="attachment-uploader">
      {!readOnly && <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor={`${id}-category`} className="sr-only">Document type</label>
        <Select id={`${id}-category`} value={category} onChange={(e) => setCategory(e.target.value)} className="sm:w-60" disabled={disabled || busy} data-testid="attachment-category">
          {DOCUMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>{categoryLabel(c)}</option>
          ))}
        </Select>
        <input
          ref={input}
          id={`${id}-file`}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={disabled || busy}
          onChange={(e) => void upload(e.target.files?.[0])}
          data-testid="attachment-file"
          aria-label="Choose a document to upload"
        />
        <Button variant="secondary" size="sm" loading={busy} disabled={disabled} onClick={() => input.current?.click()} data-testid="attachment-upload">
          <Paperclip className="h-4 w-4" aria-hidden /> Upload document
        </Button>
        <span className="text-xs text-muted-foreground">PDF, PNG or JPEG</span>
      </div>}
      {error &&<p role="alert" className="text-xs font-medium text-danger">{error}</p>}
      <ul className="space-y-1.5" data-testid="attachment-list">
        <AnimatePresence initial={false}>
          {attachments.map((a) => (
            <motion.li
              key={a.id}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 12 }}
              className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm"
            >
              <FileText className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {a.original_name}
                <span className="text-xs text-muted-foreground"> · {categoryLabel(a.category)}{a.bytes ? ` · ${size(a.bytes)}` : ""}</span>
              </span>
              {a.verification_status === "VERIFIED" && <Badge tone="success">Verified</Badge>}
              {a.verification_status === "REJECTED" && <Badge tone="danger">Rejected</Badge>}
              {a.can_view !== false && (
                <a
                  href={attachmentDownloadUrl(a.id)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Download ${a.original_name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="h-4 w-4" aria-hidden />
                </a>
              )}
              {onRemove && !a.leave_id && (
                <button type="button" onClick={() => onRemove(a.id)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Remove ${a.original_name}`}>
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
