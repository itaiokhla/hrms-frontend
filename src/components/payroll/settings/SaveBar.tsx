"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, RefreshCw, Undo2 } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";

import { fmtDay, grainNotice } from "./model";
import type { SettingIssue } from "./types";

/**
 * Sticky footer of a settings section (3.8 §5.16): effective date, reason when required, what the
 * date means for open periods (PERIOD settings apply to the whole period, DAY settings from the day),
 * and Save. Always visible; it says when there is nothing to save.
 */
export function SaveBar({
  dirtyCount,
  grains,
  effectiveFrom,
  onEffectiveFrom,
  today,
  reason,
  onReason,
  reasonError,
  saving,
  canSave,
  onSave,
  onDiscard,
  effectiveDated,
}: {
  dirtyCount: number;
  /** Grains of the changed settings. */
  grains: ("PERIOD" | "DAY")[];
  effectiveFrom: string;
  onEffectiveFrom: (value: string) => void;
  today: string;
  reason: string;
  onReason: (value: string) => void;
  reasonError?: string | null;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** False when every changed setting applies immediately (not effective-dated). */
  effectiveDated: boolean;
}) {
  const id = useId();
  const past = effectiveFrom < today;
  const notices = Array.from(new Set(grains)).map((g) => `${g === "PERIOD" ? "Period settings" : "Day settings"}: ${grainNotice(g, effectiveFrom)}.`);
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-border bg-background/90 px-4 py-3 backdrop-blur-xl sm:mx-0 sm:rounded-2xl sm:border sm:px-4 sm:shadow-lift">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <label htmlFor={`${id}-from`} className="text-[13px] font-medium">
              Effective from
            </label>
            <Input
              id={`${id}-from`}
              type="date"
              className="h-11 sm:w-44"
              value={effectiveFrom}
              onChange={(e) => onEffectiveFrom(e.target.value || today)}
              disabled={!effectiveDated}
              aria-describedby={`${id}-notice`}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1 sm:w-72">
            <label htmlFor={`${id}-reason`} className="text-[13px] font-medium">
              Reason{past ? " (required)" : ""}
            </label>
            <Textarea
              id={`${id}-reason`}
              rows={1}
              className="min-h-[44px] py-2.5"
              value={reason}
              maxLength={500}
              onChange={(e) => onReason(e.target.value)}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? `${id}-reason-error` : undefined}
              placeholder={past ? "Why does this apply to the past?" : "Recorded in the audit log"}
            />
            {reasonError && (
              <p id={`${id}-reason-error`} role="alert" className="text-xs font-medium text-danger">
                {reasonError}
              </p>
            )}
          </div>
        </div>
        <div id={`${id}-notice`} className="min-w-0 flex-1 text-xs text-muted-foreground" aria-live="polite">
          {dirtyCount === 0 ? (
            <p>No unsaved changes.</p>
          ) : (
            <>
              <p className="font-medium text-foreground">
                {dirtyCount} unsaved change{dirtyCount === 1 ? "" : "s"}
              </p>
              {effectiveDated ? notices.map((n) => <p key={n}>{n}</p>) : <p>Applies immediately.</p>}
              {past && effectiveDated && (
                <p className="flex items-center gap-1 text-foreground">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Back-dated to {fmtDay(effectiveFrom)}: payroll for that period may be
                  recalculated.
                </p>
              )}
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="h-11" onClick={onDiscard} disabled={dirtyCount === 0 || saving}>
            <Undo2 className="h-4 w-4" /> Discard
          </Button>
          <Button className="h-11 min-w-[7rem]" onClick={onSave} loading={saving} disabled={!canSave || dirtyCount === 0}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Validation summary at the top of a section; each entry jumps to its control. */
export function IssueSummary({
  issues,
  labelOf,
  title = "Fix these before saving",
}: {
  issues: { key: string | null; message: string; severity?: SettingIssue["severity"]; rule?: string }[];
  labelOf: (key: string) => string;
  title?: string;
}) {
  const errors = issues.filter((i) => i.severity !== "WARNING");
  const warnings = issues.filter((i) => i.severity === "WARNING");
  if (!issues.length) return null;
  const jump = (key: string | null) => {
    if (!key) return;
    const safe = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(key) : key.replace(/"/g, "");
    const el = document.querySelector<HTMLElement>(`[data-setting="${safe}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.querySelector<HTMLElement>("input, select, textarea, button[role=switch]")?.focus();
  };
  const list = (items: typeof issues) => (
    <ul className="mt-2 space-y-1">
      {items.map((issue, i) => (
        <li key={`${issue.rule ?? ""}-${issue.key ?? ""}-${i}`}>
          {issue.key ? (
            <button type="button" className="text-start underline-offset-2 hover:underline" onClick={() => jump(issue.key)}>
              {issue.rule ? <span className="font-mono text-xs">{issue.rule} </span> : null}
              <span className="font-medium">{labelOf(issue.key)}:</span> {issue.message}
            </button>
          ) : (
            <span>
              {issue.rule ? <span className="font-mono text-xs">{issue.rule} </span> : null}
              {issue.message}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="space-y-3">
      {errors.length > 0 && (
        <div role="alert" className="rounded-2xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-foreground">
          <p className="font-semibold">{title}</p>
          {list(errors)}
        </div>
      )}
      {warnings.length > 0 && (
        <div role="status" className="rounded-2xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-foreground">
          <p className="font-semibold">Check these</p>
          {list(warnings)}
        </div>
      )}
    </div>
  );
}

/** "Someone else changed this" (409, EC-UX-04): their value vs yours, and Reload. Never overwrites silently. */
export function ConflictBanner({
  open,
  message,
  label,
  theirs,
  yours,
  onReload,
  onDismiss,
}: {
  open: boolean;
  message: string;
  label: string | null;
  theirs: string | null;
  yours: string | null;
  onReload: () => void;
  onDismiss: () => void;
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          role="alert"
          className="rounded-2xl border border-warning/50 bg-warning-soft px-4 py-3 text-sm text-foreground"
        >
          <p className="font-semibold">Someone else changed this</p>
          <p className="mt-1">{message}</p>
          {label && (theirs !== null || yours !== null) && (
            <dl className="mt-2 grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-4">
              <dt className="text-muted-foreground">{label} now</dt>
              <dd className="font-medium">{theirs ?? "—"}</dd>
              <dt className="text-muted-foreground">Your change</dt>
              <dd className="font-medium">{yours ?? "—"}</dd>
            </dl>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" className="h-10" onClick={onReload}>
              <RefreshCw className="h-4 w-4" /> Reload latest values
            </Button>
            <Button size="sm" variant="ghost" className={cn("h-10")} onClick={onDismiss}>
              Keep editing
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
