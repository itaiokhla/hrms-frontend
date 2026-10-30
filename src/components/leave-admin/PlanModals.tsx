"use client";

import { CheckCircle2, Hourglass, Play, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { EmployeePicker } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { LeaveAdminError, leaveAdminApi } from "@/lib/leave/adminApi";
import type { LeaveTypeV2, PlanDetail, PlanIssue, PlanVersion, SimulateEntry, SimulateResult } from "@/lib/leave/adminTypes";

import { ErrorNotice, LeaveSwatch, fmtUnits } from "./shared";

/* ------------------------------------------------------------------ activate */

const ACTIVATE_HELP: Record<string, string> = {
  SELF_DECISION_FORBIDDEN: "You requested this activation, so another leave administrator must confirm it.",
  PREVIEW_CHANGED: "The draft changed after the activation was requested. Request the activation again.",
  VERSION_NOT_DRAFT: "This version is already active or superseded. Reload the plan.",
  STEP_UP_REQUIRED: "Activation needs a fresh identity check. Confirm it's you and try again.",
};

/**
 * Activate (03-leave/01 §11.6): effective date, reason (required when back-dated), recalculation of approved future
 * leave. With `leave.plan.requires_second_person` the first person requests, a second confirms (`confirm: true`).
 */
export function ActivateModal({ open, onOpenChange, plan, version, secondPerson, myUserId, today, dirty, onDone, onIssues }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Pick<PlanDetail, "id" | "name">;
  version: PlanVersion;
  secondPerson: boolean;
  myUserId?: number | null;
  today: string;
  dirty: boolean;
  onDone: () => void;
  onIssues?: (issues: PlanIssue[]) => void;
}) {
  const pending = version.activation_request ?? null;
  const mine = !!pending && version.activation_requested_by_user_id != null && version.activation_requested_by_user_id === myUserId;
  const [effectiveFrom, setEffectiveFrom] = useState(version.effective_from);
  const [reason, setReason] = useState("");
  const [recalc, setRecalc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reasonError, setReasonError] = useState<string | undefined>();
  useEffect(() => {
    if (open) {
      setEffectiveFrom(version.effective_from);
      setReason("");
      setRecalc(false);
      setError(null);
      setReasonError(undefined);
    }
  }, [open, version.effective_from]);
  const backdated = !pending && effectiveFrom < today;

  const submit = async () => {
    if (backdated && reason.trim().length < 3) {
      setReasonError("A reason is required for a version effective in the past.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = pending
        ? { effective_from: pending.effective_from, reason: pending.reason, recalc_future_leave: pending.recalc_future_leave, confirm: true }
        : { effective_from: effectiveFrom, reason: reason.trim() || null, recalc_future_leave: recalc, confirm: false };
      const result = await leaveAdminApi.activate(plan.id, version.version, body);
      if ("status" in result && result.status === "AWAITING_SECOND_PERSON") {
        toast.success("Activation requested: a second leave administrator must confirm it.");
      } else {
        const r = result as PlanVersion & { message?: string; recalculated_requests?: number };
        toast.success(`Version ${version.version} is active. ${r.message ?? ""}${r.recalculated_requests ? ` ${r.recalculated_requests} request(s) recalculated.` : ""}`.trim());
      }
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError(e);
      if (e instanceof LeaveAdminError) {
        if (e.code === "REASON_REQUIRED") setReasonError(e.message);
        if (e.issues.length) onIssues?.(e.issues);
      }
    } finally {
      setBusy(false);
    }
  };

  const code = (error as { code?: string } | null)?.code;
  const label = pending ? "Confirm activation" : secondPerson ? "Request activation" : `Activate version ${version.version}`;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={pending ? `Confirm activation of version ${version.version}` : `Activate version ${version.version} of ${plan.name}`}
      description="An active version is immutable; later changes go into a new draft version."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} loading={busy} disabled={dirty || mine} data-testid="activate-submit">
            <ShieldCheck className="h-4 w-4" /> {label}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="activate-modal">
        {dirty && <Notice tone="warning" title="Save the draft first">Activation uses the saved draft, not unsaved edits.</Notice>}
        {pending ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-sm">
              <Hourglass className="h-4 w-4 text-info" aria-hidden />
              <span>
                Waiting for a second approver — requested by {version.activation_requested_by_user_id === myUserId ? "you" : `user #${version.activation_requested_by_user_id}`}.
              </span>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-muted-foreground">Effective from</dt><dd className="font-medium">{fmtDate(pending.effective_from)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Recalculate future leave</dt><dd className="font-medium">{pending.recalc_future_leave ? "Yes" : "No"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Reason</dt><dd className="font-medium">{pending.reason ?? "—"}</dd></div>
            </dl>
            {mine && <p className="text-sm text-muted-foreground" data-testid="activate-mine">You requested this activation; another leave administrator confirms it.</p>}
          </div>
        ) : (
          <>
            <Field label="Effective from" hint={backdated ? "This is in the past: give a reason." : "The first day the version applies."}>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} data-testid="activate-date" />
            </Field>
            <Field label={backdated ? "Reason" : "Reason (optional)"} required={backdated} error={reasonError}>
              <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => { setReason(e.target.value); setReasonError(undefined); }} data-testid="activate-reason" />
            </Field>
            <div className="flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Recalculate approved future leave</p>
                <p className="text-xs text-muted-foreground">Approved requests from the effective date are re-counted under the new rules.</p>
              </div>
              <Switch checked={recalc} onChange={setRecalc} label="Recalculate approved future leave" />
            </div>
            {secondPerson && (
              <Notice tone="info" title="A second administrator confirms">With “Second person activates leave plans” on, this only requests the activation.</Notice>
            )}
          </>
        )}
        {code && ACTIVATE_HELP[code] && <Notice tone="warning" title={ACTIVATE_HELP[code]} />}
        <ErrorNotice error={error} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ simulate */

const STATUS_TONE: Record<SimulateEntry["status"], "success" | "warning" | "danger" | "info"> = {
  ELIGIBLE: "success",
  ELIGIBLE_VERIFY: "info",
  ACCRUE_ONLY: "warning",
  NOT_ELIGIBLE: "danger",
};
const STATUS_LABEL: Record<SimulateEntry["status"], string> = {
  ELIGIBLE: "Eligible",
  ELIGIBLE_VERIFY: "Verify",
  ACCRUE_ONLY: "Accrues only",
  NOT_ELIGIBLE: "Not eligible",
};

/** Simulate (03-leave/01 §10.1): what a version would give each employee on a date; never writes. */
export function SimulateModal({ open, onOpenChange, plan, versions, initialVersion, today, types }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Pick<PlanDetail, "id" | "name">;
  versions: PlanVersion[];
  initialVersion: number;
  today: string;
  types: LeaveTypeV2[];
}) {
  const [version, setVersion] = useState(initialVersion);
  const [on, setOn] = useState(today);
  const [people, setPeople] = useState<{ id: number; full_name: string }[]>([]);
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (open) {
      setVersion(initialVersion);
      setResult(null);
      setError(null);
    }
  }, [open, initialVersion]);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await leaveAdminApi.simulate({ policy_id: plan.id, version, on, employee_ids: people.length ? people.map((p) => p.id) : null }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const codes = result ? Array.from(new Set(result.employees.flatMap((e) => e.types.map((t) => t.leave_type_code)))) : [];
  const typeOf = (code: string) => types.find((t) => t.code === code);
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="xl" title={`Simulate ${plan.name}`}
      description="Eligibility and this year's entitlement per employee and type, as if the version applied. Nothing is saved."
      footer={<Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>}>
      <div className="space-y-4" data-testid="simulate-modal">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Version" className="w-40">
            <Select value={version} onChange={(e) => setVersion(Number(e.target.value))}>
              {versions.map((v) => <option key={v.version} value={v.version}>v{v.version} · {v.status.toLowerCase()}</option>)}
            </Select>
          </Field>
          <Field label="On" className="w-44">
            <Input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
          </Field>
          <div className="min-w-[16rem] flex-1">
            <p className="mb-1.5 text-[13px] font-medium">Employees (blank = everyone you can see, up to 200)</p>
            <EmployeePicker value={null} placeholder="Add an employee…" excludeIds={people.map((p) => p.id)}
              onChange={(picked) => picked && setPeople((all) => [...all, { id: picked.id, full_name: picked.full_name }])} />
          </div>
          <Button onClick={() => void run()} loading={busy} data-testid="simulate-run"><Play className="h-4 w-4" /> Run</Button>
        </div>
        {people.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {people.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs">
                {p.full_name}
                <button type="button" aria-label={`Remove ${p.full_name}`} onClick={() => setPeople((all) => all.filter((x) => x.id !== p.id))}><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        )}
        <ErrorNotice error={error} />
        {busy && !result && <Skeleton className="h-40 rounded-2xl" />}
        {result && (
          <>
            {result.truncated && <Notice tone="info" title="Showing the first 200 employees">Name employees to simulate specific people.</Notice>}
            {result.employees.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nobody to simulate in your scope.</p>
            ) : (
              <div className="scrollbar-thin max-h-[50vh] overflow-auto rounded-xl border border-border">
                <table className="w-full min-w-max text-sm" data-testid="simulate-table">
                  <caption className="sr-only">Simulation result on {fmtDate(result.date)}</caption>
                  <thead className="sticky top-0 bg-surface-muted text-left text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2">Employee</th>
                      {codes.map((code) => (
                        <th key={code} scope="col" className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><LeaveSwatch token={typeOf(code)?.color_token} />{typeOf(code)?.name ?? code}</span></th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.employees.map((emp) => (
                      <tr key={emp.employee_id} className="border-t border-border/70">
                        <th scope="row" className="px-3 py-2 text-left font-medium">{emp.name}</th>
                        {codes.map((code) => {
                          const entry = emp.types.find((t) => t.leave_type_code === code);
                          return (
                            <td key={code} className="px-3 py-2 align-top">
                              {entry ? (
                                <span className="space-y-0.5">
                                  <Badge tone={STATUS_TONE[entry.status]}>{STATUS_LABEL[entry.status]}</Badge>
                                  <span className={cn("block text-xs tabular-nums", entry.unlimited && "text-muted-foreground")}>
                                    {entry.unlimited ? "Unlimited" : `${fmtUnits(entry.this_cycle)} this year`}
                                  </span>
                                  {entry.available_from && <span className="block text-[11px] text-muted-foreground">from {fmtDate(entry.available_from)}</span>}
                                </span>
                              ) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ details */

export function PlanDetailsModal({ open, onOpenChange, plan, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Pick<PlanDetail, "id" | "name" | "description">;
  onSaved: () => void;
}) {
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (open) {
      setName(plan.name);
      setDescription(plan.description ?? "");
      setError(null);
    }
  }, [open, plan.name, plan.description]);
  const save = async () => {
    if (!name.trim()) return setError(new Error("Enter a name."));
    setBusy(true);
    try {
      await leaveAdminApi.patchPlan(plan.id, { name: name.trim(), description: description.trim() });
      toast.success("Plan details saved");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="sm" title="Plan details"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void save()} loading={busy}><CheckCircle2 className="h-4 w-4" /> Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required><Input value={name} maxLength={150} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description"><Textarea rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <ErrorNotice error={error} />
      </div>
    </Modal>
  );
}
