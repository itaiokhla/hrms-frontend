"use client";

import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate, fmtDateTime, titleCase } from "@/lib/format";
import { FLAG_LABEL, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE, portionText } from "@/lib/leave/api";
import { leaveChipStyle, leaveColor } from "@/lib/leave/colors";
import type { ApprovalStep, IssueSeverity, LeaveIssue } from "@/lib/leave/types";

/** Status chip of a v2 status (UPPER_SNAKE); unknown values are title-cased. */
export function LeaveStatusChip({ status, className }: { status: string; className?: string }) {
  const key = status.toUpperCase();
  return (
    <Badge tone={STATUS_TONE[key] ?? "neutral"} dot className={className} data-testid="leave-status" data-status={key}>
      {STATUS_LABEL[key] ?? titleCase(status.toLowerCase())}
    </Badge>
  );
}

/** Coloured dot + leave type name; the API already masks protected leave (`leave-neutral`, "Protected leave"). */
export function LeaveTypeChip({ name, token, pending, className }: { name: string; token: string | null | undefined; pending?: boolean; className?: string }) {
  return (
    <span
      className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium text-foreground", className)}
      style={leaveChipStyle(token, { pending })}
      data-token={token ?? undefined}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: leaveColor(token) }} aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function FlagBadges({ flags, source }: { flags?: string[]; source?: string | null }) {
  const list = flags ?? [];
  const showSource = source && source !== "SELF";
  if (!list.length && !showSource) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="leave-flags">
      {showSource && <Badge tone="primary">{SOURCE_LABEL[source!] ?? titleCase(source!.toLowerCase())}</Badge>}
      {list.map((flag) => (
        <Badge key={flag} tone={flag === "EMERGENCY" ? "danger" : flag === "BALANCE_CONFLICT" ? "warning" : "info"} data-flag={flag}>
          {flag === "EMERGENCY" && <ShieldAlert className="h-3 w-3" aria-hidden />}
          {FLAG_LABEL[flag] ?? titleCase(flag.toLowerCase())}
        </Badge>
      ))}
    </span>
  );
}

export function DateRangeText({ start, end, startPortion, endPortion }: { start: string; end: string; startPortion?: string | null; endPortion?: string | null }) {
  const same = start === end;
  const portion = portionText(startPortion, endPortion, same);
  return (
    <span>
      {same ? fmtDate(start, "EEE, d MMM yyyy") : `${fmtDate(start, "d MMM")} – ${fmtDate(end, "d MMM yyyy")}`}
      {portion && <span className="text-muted-foreground"> · {portion}</span>}
    </span>
  );
}

const SEVERITY: Record<IssueSeverity, { icon: typeof Info; box: string; label: string }> = {
  ERROR: { icon: XCircle, box: "border-danger/30 bg-danger-soft text-danger", label: "Problem" },
  WARNING: { icon: AlertTriangle, box: "border-warning/30 bg-warning-soft text-warning", label: "Warning" },
  INFO: { icon: Info, box: "border-info/30 bg-info-soft text-info", label: "Note" },
};

/** Validator findings, errors first. */
export function IssueList({ issues, testId = "leave-issues" }: { issues: LeaveIssue[]; testId?: string }) {
  if (!issues.length) return null;
  const order: IssueSeverity[] = ["ERROR", "WARNING", "INFO"];
  const sorted = [...issues].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  return (
    <ul className="space-y-2" data-testid={testId} aria-live="polite">
      {sorted.map((issue, i) => {
        const s = SEVERITY[issue.severity] ?? SEVERITY.INFO;
        const Icon = s.icon;
        return (
          <motion.li
            key={`${issue.code}-${i}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className={cn("flex items-start gap-2 rounded-xl border px-3 py-2 text-sm", s.box)}
            data-severity={issue.severity}
            data-code={issue.code}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="text-foreground">
              <span className="sr-only">{s.label}: </span>
              {issue.message}
            </span>
          </motion.li>
        );
      })}
    </ul>
  );
}

/** The approval route as a vertical timeline. */
export function ApprovalSteps({ steps }: { steps: ApprovalStep[] }) {
  if (!steps.length) return <p className="text-sm text-muted-foreground">No approval steps.</p>;
  return (
    <ol className="space-y-3" data-testid="approval-steps">
      {steps.map((s) => {
        const done = s.status === "approved";
        const bad = s.status === "rejected";
        const live = s.status === "pending";
        return (
          <li key={s.step_order} className="flex gap-3">
            <span
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                done ? "bg-success-soft text-success" : bad ? "bg-danger-soft text-danger" : live ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground",
              )}
              aria-hidden
            >
              {done ? <CheckCircle2 className="h-4 w-4" /> : bad ? <XCircle className="h-4 w-4" /> : s.step_order}
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-medium">
                {s.approver_label}
                {s.approver ? <span className="text-muted-foreground"> · {s.approver}</span> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {titleCase(s.status)}
                {s.acted_by ? ` by ${s.acted_by}` : ""}
                {s.acted_as && s.acted_as !== "approver" ? ` (${s.acted_as})` : ""}
                {s.acted_at ? ` · ${fmtDateTime(s.acted_at)}` : ""}
              </p>
              {s.remarks && <p className="mt-1 italic text-foreground/80">“{s.remarks}”</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
