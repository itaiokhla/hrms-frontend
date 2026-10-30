"use client";

import { AlertTriangle, CheckCircle2, Clock, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import type { ActionRequiredBlock } from "@/lib/agent-types";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

/**
 * A prepared action from the assistant (docs/leave_agent.md §13, §21). Renders typed server fields only, as plain
 * text. Confirm calls the deterministic confirm endpoint (never the model); the buttons are disabled while a request
 * is in flight, and the server's exactly-once handling covers anything that still slips through.
 */

const ACTION_TITLES: Record<string, string> = {
  "leave.apply": "Apply for leave",
  "leave.withdraw": "Withdraw leave request",
  "leave.cancel": "Cancel approved leave",
  "leave.approve": "Approve leave request",
  "leave.reject": "Reject leave request",
};

const CONFIRM_LABELS: Record<string, string> = {
  "leave.apply": "Confirm leave",
  "leave.withdraw": "Confirm withdrawal",
  "leave.cancel": "Confirm cancellation",
  "leave.approve": "Confirm approval",
  "leave.reject": "Confirm rejection",
};

/** Detail fields shown, in this order, with their labels. Anything else the server sends is not rendered. */
const DETAIL_FIELDS: [string, string][] = [
  ["employee_name", "Employee"],
  ["leave_type_name", "Leave type"],
  ["start_date", "From"],
  ["end_date", "To"],
  ["days", "Days"],
  ["current_status", "Current status"],
  ["reason", "Reason"],
  ["remarks", "Note to employee"],
  ["available_before", "Balance before"],
  ["available_after", "Balance after"],
  ["split_unpaid_days", "Unpaid days"],
];

const PORTIONS: Record<string, string> = { SECOND_HALF: "from the afternoon", FIRST_HALF: "until midday" };

function text(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return null; // objects and arrays are never rendered generically
}

function humanize(code: string): string {
  return code.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function isExpired(block: ActionRequiredBlock, now: number = Date.now()): boolean {
  if (block.status === "expired") return true;
  if (block.status !== "prepared") return false;
  const at = Date.parse(block.expires_at);
  return Number.isFinite(at) && at <= now;
}

export interface ActionCardProps {
  block: ActionRequiredBlock;
  onConfirm: (block: ActionRequiredBlock) => Promise<void>;
  onCancel: (block: ActionRequiredBlock) => Promise<void>;
}

export function ActionCard({ block, onConfirm, onCancel }: ActionCardProps) {
  const [pending, setPending] = useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(() => isExpired(block));
  const inFlight = useRef(false);

  useEffect(() => {
    setExpired(isExpired(block));
    if (block.status !== "prepared") return;
    const left = Date.parse(block.expires_at) - Date.now();
    if (!Number.isFinite(left) || left <= 0) return;
    const timer = setTimeout(() => setExpired(true), Math.min(left + 50, 2_147_000_000));
    return () => clearTimeout(timer);
  }, [block]);

  const run = async (kind: "confirm" | "cancel") => {
    if (inFlight.current) return; // a double click sends one request
    inFlight.current = true;
    setPending(kind);
    setError(null);
    try {
      await (kind === "confirm" ? onConfirm(block) : onCancel(block));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  };

  const details = block.details ?? {};
  const warnings = Array.isArray(details.warnings) ? details.warnings.filter((w): w is string => typeof w === "string") : [];
  const note = text(details.note);
  const portions = [text(details.start_portion), text(details.end_portion)]
    .map((p) => (p ? PORTIONS[p] : undefined))
    .filter((p): p is string => !!p);
  const confirmable = block.status === "prepared" && !expired && !!block.confirmation_token;
  const resultMessage = text(block.result?.message);

  return (
    <div
      className={cn(
        "mt-2 rounded-2xl border bg-surface p-4 shadow-card",
        confirmable ? "border-primary/40" : "border-border/80",
      )}
      data-testid="agent-action-card"
      data-status={expired && block.status === "prepared" ? "expired" : block.status}
      aria-label={ACTION_TITLES[block.action_type] ?? "Proposed action"}
      role="group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
            {ACTION_TITLES[block.action_type] ?? "Proposed action"}
          </p>
          <p className="mt-1 text-sm font-medium" data-testid="agent-action-summary">{block.summary}</p>
        </div>
        <StatusPill block={block} expired={expired} />
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {DETAIL_FIELDS.map(([key, label]) => {
          const value = text(details[key]);
          if (value === null) return null;
          return (
            <div key={key} className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">{label}:</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          );
        })}
      </dl>
      {portions.length > 0 && <p className="mt-1.5 text-xs text-muted-foreground">Half day: {portions.join(", ")}.</p>}
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
      {warnings.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label="Warnings">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      {block.status === "completed" && resultMessage && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-success" data-testid="agent-action-result">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          {resultMessage}
        </p>
      )}
      {block.status === "failed" && (
        <p className="mt-3 text-sm text-danger">
          Not completed{block.failure_code ? ` (${humanize(block.failure_code)})` : ""}. Nothing was changed.
        </p>
      )}
      {expired && block.status !== "completed" && block.status !== "cancelled" && block.status !== "failed" && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="agent-action-expired">
          <Clock className="h-4 w-4 shrink-0" aria-hidden />
          This proposal expired. Ask the assistant to prepare it again.
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {confirmable && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={block.action_type === "leave.reject" ? "danger" : "primary"}
            onClick={() => void run("confirm")}
            loading={pending === "confirm"}
            disabled={pending !== null}
          >
            <ShieldCheck className="h-4 w-4" aria-hidden />
            {CONFIRM_LABELS[block.action_type] ?? "Confirm"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void run("cancel")} loading={pending === "cancel"} disabled={pending !== null}>
            Cancel
          </Button>
          <span className="text-xs text-muted-foreground">
            Nothing changes until you confirm. Valid until {new Date(block.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
          </span>
        </div>
      )}
    </div>
  );
}

function StatusPill({ block, expired }: { block: ActionRequiredBlock; expired: boolean }) {
  if (block.status === "completed") return <Badge tone="success" dot>Done</Badge>;
  if (block.status === "cancelled") return <Badge tone="neutral" dot>Cancelled</Badge>;
  if (block.status === "failed") return (
    <Badge tone="danger">
      <XCircle className="h-3 w-3" aria-hidden />
      Not completed
    </Badge>
  );
  if (expired) return <Badge tone="neutral" dot>Expired</Badge>;
  return <Badge tone="warning" dot>Awaiting confirmation</Badge>;
}
