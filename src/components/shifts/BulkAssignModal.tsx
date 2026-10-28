"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { BULK_MAX_ITEMS } from "@/components/shared/BulkBar";
import { EmployeePicker } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { Segmented } from "@/components/ui/segmented";
import { fmtDate } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/payroll/api";
import { useModalRoute } from "@/lib/useModalRoute";

import { ShiftApiError, shiftsApi, type BulkAssignBody, type BulkAssignResult } from "./api";
import { RuleImpact, useShiftOptions } from "./AssignmentRuleForm";
import { ShiftErrorNotice } from "./ShiftForm";
import { addDays, todayIn } from "./shiftModel";

type Step = "who" | "what" | "review" | "result";
const STEPS: { value: Step; label: string }[] = [
  { value: "who", label: "Who" }, { value: "what", label: "What and when" }, { value: "review", label: "Review" }, { value: "result", label: "Result" },
];

interface Person { id: number; full_name: string }

/**
 * Bulk assign (§13, §17.5; `?modal=shift-bulk&shift={id}`): Who (up to 100 people) → What and when (shift, dates,
 * apply as rule — priority 1000, reversible — or as each person's placement shift) → Review (dry run, refusals with
 * "Remove refused and continue") → Result (per-person outcome and the created rule).
 */
export function BulkAssignModal({ initialPeople = [], onDone }: { initialPeople?: Person[]; onDone?: () => void }) {
  const { me } = useCan();
  const today = useMemo(() => todayIn(me?.company?.timezone), [me?.company?.timezone]);
  const [dirty, setDirty] = useState(false);
  const route = useModalRoute("shift-bulk", { keys: ["shift"], dirty });
  const shifts = useShiftOptions();
  const [step, setStep] = useState<Step>("who");
  const [people, setPeople] = useState<Person[]>(initialPeople);
  const [shiftId, setShiftId] = useState("");
  const [from, setFrom] = useState(addDays(today, 1));
  const [to, setTo] = useState("");
  const [applyAs, setApplyAs] = useState<"RULE" | "PLACEMENT">("RULE");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<BulkAssignResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const open = route.open;
  const preset = route.param("shift");

  useEffect(() => {
    if (!open) return;
    setStep("who");
    setPeople(initialPeople);
    setShiftId(preset ?? "");
    setFrom(addDays(today, 1));
    setTo("");
    setApplyAs("RULE");
    setReason("");
    setErrors({});
    setError(null);
    setResult(null);
    setKey(newIdempotencyKey());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset, today]);
  useEffect(() => setDirty(open && step !== "result" && people.length > 0), [open, step, people.length]);

  if (!open) return null;
  const name = (id: number) => people.find((p) => p.id === id)?.full_name ?? `Employee #${id}`;
  const shiftCode = (id: number | null | undefined) => (id ? shifts.byId.get(id)?.code ?? `#${id}` : "no shift");
  const body = (dry: boolean): BulkAssignBody => ({
    employee_ids: people.map((p) => p.id), shift_id: Number(shiftId), effective_from: from, effective_to: to || null,
    apply_as: applyAs, reason: reason.trim() || null, dry_run: dry,
  });
  const refused = error instanceof ShiftApiError && error.code === "NOT_ELIGIBLE"
    ? ((error.details?.refused as { employee_id: number; reason: string }[] | undefined) ?? []) : [];

  const runReview = async () => {
    const e: Record<string, string> = {};
    if (!shiftId) e.shift_id = "Choose the shift.";
    if (!from) e.from = "Choose the start date.";
    else if (from < today && !reason.trim()) e.reason = "Give a reason for a start date in the past.";
    if (to && from && to < from) e.to = "The end date is before the start date.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setStep("review");
    setResult(null);
    setError(null);
    try {
      setResult(await shiftsApi.bulkAssign(body(true)));
    } catch (err) {
      setError(err);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const done = await shiftsApi.bulkAssign(body(false), key);
      setResult(done);
      setStep("result");
      setDirty(false);
      toast.success("Shift assigned.");
      onDone?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <>
      {step === "who" && <><Button variant="secondary" onClick={() => void route.close()}>Cancel</Button>
        <Button disabled={!people.length} onClick={() => setStep("what")}>Next</Button></>}
      {step === "what" && <><Button variant="secondary" onClick={() => setStep("who")}>Back</Button>
        <Button onClick={() => void runReview()}>Review</Button></>}
      {step === "review" && <><Button variant="secondary" onClick={() => setStep("what")}>Back</Button>
        <Button onClick={() => void apply()} loading={busy} disabled={!result}>Assign shift</Button></>}
      {step === "result" && <Button onClick={() => void route.close()}>Done</Button>}
    </>
  );

  return (
    <Modal open onOpenChange={route.onOpenChange} size="xl" title="Assign a shift to people"
      description={`Step ${STEPS.findIndex((s) => s.value === step) + 1} of 4 · ${STEPS.find((s) => s.value === step)?.label}`} footer={footer}>
      <div className="space-y-4" data-testid="bulk-assign">
        {step === "who" && (
          <>
            <Field label="Add people" hint={`Up to ${BULK_MAX_ITEMS} people.`}>
              <EmployeePicker value={null} excludeIds={people.map((p) => p.id)}
                onChange={(p) => p && people.length < BULK_MAX_ITEMS && setPeople([...people, { id: p.id, full_name: p.full_name }])} />
            </Field>
            <p className="text-sm" aria-live="polite">{people.length} selected</p>
            <ul className="flex flex-wrap gap-1.5">
              {people.map((p) => (
                <li key={p.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
                  {p.full_name}
                  <button type="button" aria-label={`Remove ${p.full_name}`} onClick={() => setPeople(people.filter((x) => x.id !== p.id))}>
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {step === "what" && (
          <>
            <Field label="Shift" required error={errors.shift_id}>
              <Select value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
                <option value="">Choose a shift…</option>
                {shifts.items.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="From" required error={errors.from}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="To (optional)" error={errors.to}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            </div>
            <Segmented label="Apply as" value={applyAs} onChange={setApplyAs}
              options={[{ value: "RULE", label: "A rule (can be ended later)" }, { value: "PLACEMENT", label: "Their usual shift" }]} />
            <Field label="Reason" error={errors.reason} hint="Needed when the start date is in the past.">
              <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </>
        )}
        {(step === "review" || step === "result") && (
          <>
            <ShiftErrorNotice error={error} />
            {refused.length > 0 && (
              <div className="space-y-2 text-sm">
                <ul className="list-disc ps-5">{refused.map((r) => <li key={r.employee_id}>{name(r.employee_id)}: the shift belongs to another unit</li>)}</ul>
                <Button variant="secondary" size="sm" onClick={() => {
                  setPeople(people.filter((p) => !refused.some((r) => r.employee_id === p.id)));
                  setError(null);
                  setStep("what");
                }}>Remove refused and continue</Button>
              </div>
            )}
            {!result && !error && <p className="text-sm text-muted-foreground" aria-busy="true">Checking…</p>}
            {result && "items" in result && result.dry_run && (
              <RuleImpact preview={result} shiftCode={(id) => shiftCode(id)} personName={name} />
            )}
            {result && result.apply_as === "PLACEMENT" && (
              <ul className="space-y-1 text-sm" data-testid="bulk-results">
                {result.results.map((r) => (
                  <li key={r.employee_id}>
                    {name(r.employee_id)}: {r.status === "ok" ? (r.unchanged ? "already on this shift" : result.dry_run ? `${shiftCode(r.before_shift_id)} → ${shiftCode(Number(shiftId))}` : "assigned") : `not assigned (${(r.reason ?? r.status).replace(/_/g, " ").toLowerCase()})`}
                  </li>
                ))}
              </ul>
            )}
            {result && result.apply_as === "RULE" && !result.dry_run && "rule" in result && (
              <p className="text-sm" data-testid="bulk-rule">
                Created rule <Link className="font-medium text-primary hover:underline" href={`/attendance/shift-rules/${result.rule.id}`}>{result.rule.name}</Link>
                {" "}for {result.results.length} people from {fmtDate(result.rule.effective_from)}.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
