"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CalendarCheck2, FileText, Loader2, Sparkles, Split } from "lucide-react";

import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { categoryLabel, units } from "@/lib/leave/api";
import type { LeaveIssue, LeavePreview, PreviewDay } from "@/lib/leave/types";

import { FlagBadges, IssueList } from "./LeaveBits";

/** What a previewed day means for the balance (the "charged / weekly off / holiday / sandwich" column). */
export function dayKind(day: PreviewDay): { kind: string; label: string } {
  if (!day.employed) return { kind: "not-employed", label: "Not employed" };
  if (day.charged > 0 && day.charge_reason === "SANDWICH") {
    return { kind: "sandwich", label: `Sandwich · ${units(day.charged)} counted` };
  }
  if (day.charged > 0) {
    const half = day.portion === "FIRST_HALF" ? " (first half)" : day.portion === "SECOND_HALF" ? " (second half)" : "";
    return { kind: "charged", label: `${units(day.charged)} charged${half}` };
  }
  if (day.holiday) return { kind: "holiday", label: `Holiday · ${day.holiday}` };
  if (day.weekly_off) return { kind: "weekly-off", label: "Weekly off" };
  return { kind: "free", label: "Not charged" };
}

const KIND_DOT: Record<string, string> = {
  charged: "bg-primary",
  sandwich: "bg-warning",
  holiday: "bg-success",
  "weekly-off": "bg-muted-foreground/50",
  free: "bg-muted-foreground/30",
  "not-employed": "bg-danger",
};

/**
 * Live preview of a leave request (`POST /leaves/preview`): each day, the validator's findings, balance before and
 * after, the split to unpaid leave and the documents the plan asks for.
 */
export function LeavePreviewPanel({
  preview,
  loading,
  error,
  errorIssues = [],
  empty,
}: {
  preview: LeavePreview | null;
  loading?: boolean;
  error?: string | null;
  errorIssues?: LeaveIssue[];
  empty?: string;
}) {
  return (
    <section
      className="relative space-y-4 rounded-2xl border border-border bg-surface-muted/40 p-4"
      aria-label="Preview"
      aria-busy={loading || undefined}
      data-testid="leave-preview"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Preview</h3>
        <AnimatePresence>
          {loading && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Checking…
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {error && (
        <div className="space-y-2" data-testid="preview-error">
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
          <IssueList issues={errorIssues} testId="preview-error-issues" />
        </div>
      )}

      {!preview && !error && (
        <p className="text-sm text-muted-foreground">{empty ?? "Choose a leave type and dates to see how many days this takes."}</p>
      )}

      {preview && (
        <motion.div key={`${preview.leave_type}-${preview.start_date}-${preview.end_date}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn("space-y-4 transition-opacity", loading && "opacity-60")}>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-surface p-3 shadow-sm">
              <p className="text-xs text-muted-foreground">This request</p>
              <p className="mt-1 font-display text-2xl font-semibold tabular-nums" data-testid="preview-charged">
                {units(preview.charged_units, preview.unit)}
              </p>
            </div>
            <div className="rounded-xl bg-surface p-3 shadow-sm" data-testid="preview-balance">
              <p className="text-xs text-muted-foreground">Balance</p>
              {preview.unlimited ? (
                <p className="mt-1 text-sm font-medium">Unlimited</p>
              ) : preview.balance_before === null ? (
                <p className="mt-1 text-sm text-muted-foreground">—</p>
              ) : (
                <p className="mt-1 flex items-center gap-1.5 font-display text-lg font-semibold tabular-nums">
                  <span>{preview.balance_before}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" aria-label="after this request" />
                  <span className={cn((preview.balance_after ?? 0) < 0 && "text-danger")}>{preview.balance_after}</span>
                </p>
              )}
            </div>
          </div>

          {preview.auto_approve && !preview.blocking && (
            <p className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-xs font-medium text-success" data-testid="preview-auto-approve">
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> Approved automatically when submitted
            </p>
          )}
          <FlagBadges flags={preview.flags} />

          {preview.split && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-sm" data-testid="preview-split">
              <Split className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <p>
                <span className="font-medium">{units(preview.split.units)} will be unpaid leave</span>
                {preview.split.dates.length > 0 && (
                  <span className="text-muted-foreground"> ({preview.split.dates.map((d) => fmtDate(d, "d MMM")).join(", ")})</span>
                )}
                . Your balance covers the rest.
              </p>
            </div>
          )}

          <IssueList issues={preview.issues} testId="preview-issues" />

          {preview.documents_required.length > 0 && (
            <div className="rounded-xl border border-border bg-surface px-3 py-2 text-sm" data-testid="preview-documents">
              <p className="mb-1 inline-flex items-center gap-1.5 font-medium"><FileText className="h-4 w-4 text-primary" aria-hidden /> Documents required</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {preview.documents_required.map((d) => (
                  <li key={d.category}>
                    {categoryLabel(d.category)}
                    {d.due === "AT_SUBMIT" ? " · attach before submitting" : d.due_date ? ` · by ${fmtDate(d.due_date)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.days.length > 0 && (
            <div>
              <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <CalendarCheck2 className="h-3.5 w-3.5" aria-hidden /> Day by day
              </p>
              <ul className="scrollbar-thin max-h-64 space-y-1 overflow-y-auto pe-1" data-testid="preview-days">
                {preview.days.map((day) => {
                  const k = dayKind(day);
                  return (
                    <li key={day.date} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm odd:bg-surface" data-testid={`preview-day-${day.date}`} data-kind={k.kind}>
                      <span className="tabular-nums">{fmtDate(day.date, "EEE, d MMM")}</span>
                      <span className="inline-flex items-center gap-1.5 text-end text-xs text-muted-foreground">
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", KIND_DOT[k.kind])} aria-hidden />
                        {k.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </motion.div>
      )}
    </section>
  );
}
