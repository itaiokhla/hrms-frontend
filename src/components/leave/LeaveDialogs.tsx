"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { CHANGE_LABEL, datesBetween, errorIssues, leaveApi, leaveErrorMessage } from "@/lib/leave/api";
import { emitLeaveChanged } from "@/lib/leave/events";
import type { ChangeKind, EndPortion, LeaveChange, LeaveDetail, LeaveIssue, StartPortion } from "@/lib/leave/types";

import { IssueList } from "./LeaveBits";

/**
 * A decision that may need words: reject / return need a reason, approve takes an optional note. The dialog stays
 * open with the server's message when the call fails.
 */
export function DecisionDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  required,
  confirmLabel,
  tone = "primary",
  onConfirm,
  testId = "decision-dialog",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  required?: boolean;
  confirmLabel: string;
  tone?: "primary" | "danger" | "success";
  onConfirm: (text: string) => Promise<void>;
  testId?: string;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setText("");
      setError(null);
    }
  }, [open]);
  const go = async () => {
    if (required && !text.trim()) {
      setError("Please write a reason.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(text.trim());
      onOpenChange(false);
    } catch (e) {
      setError(leaveErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant={tone === "danger" ? "danger" : tone === "success" ? "success" : "primary"} loading={busy} onClick={() => void go()} data-testid={`${testId}-confirm`}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label={label} required={required} error={error ?? undefined}>
        <Textarea value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} autoFocus data-testid={`${testId}-text`} />
      </Field>
    </Modal>
  );
}

/** A readable line for a change request. */
export function describeChange(change: Pick<LeaveChange, "kind" | "proposed">): string {
  const p = change.proposed ?? {};
  const dates = Array.isArray(p.dates) ? (p.dates as string[]) : [];
  switch (change.kind) {
    case "CANCEL":
      return "Cancel the whole leave";
    case "PARTIAL_CANCEL":
      return `Cancel ${dates.length} day${dates.length === 1 ? "" : "s"}: ${dates.map((d) => fmtDate(d, "d MMM")).join(", ")}`;
    case "MODIFY":
      return `New dates: ${fmtDate(String(p.start_date ?? ""), "d MMM")} – ${fmtDate(String(p.end_date ?? ""), "d MMM yyyy")}`;
    case "CONVERT":
      return `Change the type to ${String(p.leave_type ?? "")}`;
    case "RECALL":
      return `Back to work from ${fmtDate(String(p.from_date ?? ""))}`;
    default:
      return CHANGE_LABEL[change.kind] ?? change.kind;
  }
}

/**
 * Change approved leave (SPINE §5.2): cancel all of it, cancel some days, move the dates or change the type. Only
 * CANCEL works before the tenant's leave v2 cut-over; the server decides whether the change needs approval.
 */
export function ChangeDialog({
  leave,
  open,
  onOpenChange,
  v2Enabled,
  halfDayEnabled,
  onDone,
}: {
  leave: LeaveDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  v2Enabled: boolean;
  halfDayEnabled: boolean;
  onDone: (change: LeaveChange) => void;
}) {
  const kinds: ChangeKind[] = v2Enabled ? ["CANCEL", "PARTIAL_CANCEL", "MODIFY", "CONVERT"] : ["CANCEL"];
  const [kind, setKind] = useState<ChangeKind>("CANCEL");
  const [picked, setPicked] = useState<string[]>([]);
  const [start, setStart] = useState(leave.start_date);
  const [end, setEnd] = useState(leave.end_date);
  const [startPortion, setStartPortion] = useState<StartPortion>("FULL");
  const [endPortion, setEndPortion] = useState<EndPortion>("FULL");
  const [newType, setNewType] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<LeaveIssue[]>([]);
  const { data: types } = useApi(() => leaveApi.types(), [], { enabled: open && kind === "CONVERT" });

  useEffect(() => {
    if (!open) return;
    setKind("CANCEL");
    setPicked([]);
    setStart(leave.start_date);
    setEnd(leave.end_date);
    setStartPortion("FULL");
    setEndPortion("FULL");
    setNewType("");
    setReason("");
    setError(null);
    setIssues([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leave.id]);

  const leaveDates = useMemo(
    () => (leave.days.length ? leave.days.map((d) => d.date) : datesBetween(leave.start_date, leave.end_date)),
    [leave],
  );
  const typeOptions = (types ?? []).filter((t) => t.is_active && t.code !== leave.leave_type);

  const proposed = (): Record<string, unknown> | null => {
    if (kind === "CANCEL") return {};
    if (kind === "PARTIAL_CANCEL") return picked.length ? { dates: [...picked].sort() } : null;
    if (kind === "MODIFY") {
      if (!start || !end || start > end) return null;
      return { start_date: start, end_date: end, start_portion: startPortion, end_portion: endPortion };
    }
    if (kind === "CONVERT") return newType ? { leave_type: newType } : null;
    return null;
  };

  const go = async () => {
    const body = proposed();
    if (!body) {
      setError(kind === "PARTIAL_CANCEL" ? "Pick the days to cancel." : kind === "CONVERT" ? "Choose the new leave type." : "Choose valid dates.");
      return;
    }
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      const change = await leaveApi.requestChange(leave.id, { kind, proposed: body, reason: reason.trim() || null });
      toast.success(change.status === "APPROVED" ? "Change applied" : "Change requested. Waiting for approval.");
      emitLeaveChanged();
      onDone(change);
      onOpenChange(false);
    } catch (e) {
      setError(leaveErrorMessage(e));
      setIssues(errorIssues(e).filter((i) => i.severity === "ERROR"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title="Change this leave"
      description={`${leave.leave_type_name}, ${fmtDate(leave.start_date)} – ${fmtDate(leave.end_date)}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
          <Button variant={kind === "CANCEL" || kind === "PARTIAL_CANCEL" ? "danger" : "primary"} loading={busy} onClick={() => void go()} data-testid="change-submit">
            {kind === "CANCEL" ? "Cancel leave" : "Request change"}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="change-dialog">
        <Segmented<ChangeKind> label="What do you want to change?" value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k, label: CHANGE_LABEL[k] }))} />
        {!v2Enabled && <p className="text-xs text-muted-foreground">Cancelling some days, moving dates or changing the type becomes available when your company switches to the new leave rules.</p>}

        {kind === "PARTIAL_CANCEL" && (
          <fieldset className="space-y-2" data-testid="change-dates">
            <legend className="text-[13px] font-medium">Days to cancel</legend>
            <div className="flex flex-wrap gap-2">
              {leaveDates.map((d) => {
                const on = picked.includes(d);
                return (
                  <label key={d} className={cn("cursor-pointer rounded-xl border px-3 py-1.5 text-sm transition-colors", on ? "border-danger/40 bg-danger-soft text-danger" : "border-border hover:bg-muted")}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, d] : p.filter((x) => x !== d)))} />
                    {fmtDate(d, "EEE d MMM")}
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {kind === "MODIFY" && (
          <div className="space-y-3" data-testid="change-modify">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="New start">
                <Input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} />
              </Field>
              <Field label="New end">
                <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
              </Field>
            </div>
            {halfDayEnabled && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="First day">
                  <Select value={startPortion} onChange={(e) => setStartPortion(e.target.value as StartPortion)}>
                    <option value="FULL">Full day</option>
                    <option value="SECOND_HALF">Second half</option>
                  </Select>
                </Field>
                <Field label="Last day">
                  <Select value={endPortion} onChange={(e) => setEndPortion(e.target.value as EndPortion)}>
                    <option value="FULL">Full day</option>
                    <option value="FIRST_HALF">First half</option>
                  </Select>
                </Field>
              </div>
            )}
          </div>
        )}

        {kind === "CONVERT" && (
          <Field label="New leave type" required>
            <Select value={newType} onChange={(e) => setNewType(e.target.value)} data-testid="change-type">
              <option value="">{types ? "Choose a type" : "Loading…"}</option>
              {typeOptions.map((t) => (
                <option key={t.code} value={t.code}>{t.display_name || t.name}</option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Reason" hint="Optional unless your approver asks for one.">
          <Textarea value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} data-testid="change-reason" />
        </Field>

        {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <IssueList issues={issues} testId="change-issues" />
      </div>
    </Modal>
  );
}
