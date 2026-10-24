"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { isDecimalString, parseMoneyInput } from "@/lib/money";
import { newIdempotencyKey } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { lookupsApi, wageInputsApi, type WageInputBody, type WageInputPatchBody } from "./api";
import { ConflictBanner, EmployeeField, ErrorSummary, fieldErrors, isNotFound } from "./shared";
import type { ComponentOption, WageInput } from "./types";

/** One-time component kinds a wage input usually carries (3.8 §5.5): bonus, commission, adjustment, deduction. */
export const ONE_TIME_HINT = "Bonus, commission, adjustment or deduction";

function monthBounds(today = new Date()): { start: string; end: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(y, m + 1, 0).getDate();
  return { start: `${y}-${pad(m + 1)}-01`, end: `${y}-${pad(m + 1)}-${pad(last)}` };
}

interface FormState {
  employeeId: number | null;
  component: string;
  mode: "amount" | "units" | "measure";
  amount: string;
  currency: string;
  units: string;
  rate: string;
  periodStart: string;
  periodEnd: string;
  reason: string;
  externalRef: string;
  recurring: boolean;
  until: string;
}

function initialState(currency: string, existing?: WageInput | null): FormState {
  const month = monthBounds();
  if (existing) {
    return {
      employeeId: existing.employee_id,
      component: existing.component_code,
      mode: existing.source === "INCENTIVE_PLAN" ? "measure" : existing.amount ? "amount" : "units",
      amount: existing.amount?.amount ?? "",
      currency: existing.amount?.currency ?? existing.currency ?? currency,
      units: existing.units ?? "",
      rate: existing.rate ?? "",
      periodStart: existing.target_period.start,
      periodEnd: existing.target_period.end,
      reason: existing.reason ?? "",
      externalRef: existing.external_ref ?? "",
      recurring: false,
      until: "",
    };
  }
  return {
    employeeId: null,
    component: "",
    mode: "amount",
    amount: "",
    currency,
    units: "",
    rate: "",
    periodStart: month.start,
    periodEnd: month.end,
    reason: "",
    externalRef: "",
    recurring: false,
    until: "",
  };
}

export interface WageInputModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this draft input (`?modal=wage-input&id=`); omitted to add a new one. */
  inputId?: string | null;
  /** Prefill (from an employee sheet in a run). */
  employeeId?: number | null;
  onSaved?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Add / edit wage input (3.8 §6, `md`): component, amount or units, period, reason; approval note.
 * Only drafts are editable (the API returns 409 NOT_DRAFT otherwise). Amounts are exact decimal
 * strings; the toast never repeats the amount (3.8 §12).
 */
export function WageInputModal({ open, onOpenChange, inputId, employeeId, onSaved, onDirtyChange }: WageInputModalProps) {
  const { me } = useCan();
  const companyCurrency = me?.company.currency ?? "INR";
  const editing = !!inputId;
  const [existing, setExisting] = useState<WageInput | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormState>(() => initialState(companyCurrency));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [components, setComponents] = useState<ComponentOption[] | null>(null);
  const idempotencyKey = useRef(newIdempotencyKey());
  const pristine = useRef<string>("");

  const canPickComponent = can(me, P.PAYROLL_SALARY_STRUCTURE_READ);

  useEffect(() => {
    if (!open) return;
    idempotencyKey.current = newIdempotencyKey();
    setErrors({});
    setServerError(null);
    if (editing) {
      setLoading(true);
      setLoadError(null);
      wageInputsApi
        .get(inputId!)
        .then((row) => {
          setExisting(row);
          const state = initialState(companyCurrency, row);
          setForm(state);
          pristine.current = JSON.stringify(state);
        })
        .catch((e) => setLoadError(e))
        .finally(() => setLoading(false));
    } else {
      setExisting(null);
      const state = { ...initialState(companyCurrency), employeeId: employeeId ?? null };
      setForm(state);
      pristine.current = JSON.stringify(state);
    }
  }, [open, inputId, editing, employeeId, companyCurrency]);

  useEffect(() => {
    if (!open || !canPickComponent || components) return;
    lookupsApi
      .components()
      .then((rows) => setComponents(rows.filter((c) => c.status !== "ARCHIVED")))
      .catch(() => setComponents([]));
  }, [open, canPickComponent, components]);

  const dirty = open && JSON.stringify(form) !== pristine.current;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: "" }));
  };

  const notDraft = editing && existing && existing.status !== "DRAFT";

  const validate = (): { ok: boolean; amount?: string } => {
    const next: Record<string, string> = {};
    let amount: string | undefined;
    if (!editing && !form.employeeId) next.employeeId = "Choose the employee.";
    if (!editing && !form.component.trim()) next.component = "Choose the pay component.";
    if (form.mode === "amount") {
      if (!/^[A-Z]{3}$/.test(form.currency)) next.currency = "Use a 3-letter currency code, for example INR.";
      else {
        const parsed = parseMoneyInput(form.amount, form.currency, { allowNegative: true });
        if (parsed.ok) amount = parsed.amount;
        else next.amount = parsed.message;
      }
    } else if (form.mode === "measure") {
      if (!isDecimalString(form.units.trim())) next.units = "Enter the measure as a number, for example 118.5.";
    } else {
      if (!isDecimalString(form.units.trim())) next.units = "Enter the units as a number, for example 8.5.";
      if (form.rate.trim() && !isDecimalString(form.rate.trim())) next.rate = "Enter the rate as a number, or leave it empty to use the component's rate.";
    }
    if (!editing) {
      if (!form.periodStart) next.periodStart = "Choose the period start.";
      if (!form.periodEnd) next.periodEnd = "Choose the period end.";
      if (form.periodStart && form.periodEnd && form.periodEnd < form.periodStart) next.periodEnd = "The period ends before it starts.";
      if (form.recurring && form.mode !== "measure" && !form.until) next.until = "Choose the last period this input repeats in.";
    }
    setErrors(next);
    return { ok: Object.values(next).every((m) => !m), amount };
  };

  const save = async (submit: boolean) => {
    const { ok, amount } = validate();
    if (!ok) return;
    setBusy(true);
    setServerError(null);
    try {
      if (editing && existing) {
        const body: WageInputPatchBody = { row_version: existing.row_version, reason: form.reason.trim() || null, external_ref: form.externalRef.trim() || null };
        if (form.mode === "amount") body.amount = { amount: amount!, currency: form.currency };
        else {
          body.units = form.units.trim();
          if (form.mode === "units" && form.rate.trim()) body.rate = form.rate.trim();
        }
        await wageInputsApi.update(existing.id, body);
        if (submit) await wageInputsApi.submit(existing.id);
        toast.success(submit ? "Input saved and sent for approval." : "Draft saved.");
      } else {
        const body: WageInputBody = {
          employee_id: form.employeeId!,
          component_code: form.component.trim().toUpperCase(),
          period_start: form.periodStart,
          period_end: form.periodEnd,
          submit,
        };
        if (form.mode === "amount") body.amount = { amount: amount!, currency: form.currency };
        else if (form.mode === "measure") body.measure = form.units.trim();
        else {
          body.units = form.units.trim();
          if (form.rate.trim()) body.rate = form.rate.trim();
        }
        if (form.reason.trim()) body.reason = form.reason.trim();
        if (form.externalRef.trim()) body.external_ref = form.externalRef.trim();
        if (form.recurring && form.mode !== "measure" && form.until) body.recurrence = { until: form.until };
        const result = await wageInputsApi.create(body, idempotencyKey.current);
        const n = result.items?.length ?? 1;
        const pending = result.items?.some((r) => r.status === "PENDING_APPROVAL");
        toast.success(
          `${n > 1 ? `${n} inputs` : "Input"} added${pending ? " — waiting for approval before the next pay run picks it up" : submit ? "" : " as a draft"}.`,
        );
      }
      pristine.current = JSON.stringify(form);
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      setServerError(e);
      setErrors(mapFields(fieldErrors(e)));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save(true);
  };

  const componentChoices = useMemo(() => components ?? [], [components]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={editing ? "Edit wage input" : "Add wage input"}
      description={editing ? "Only drafts can be changed. A submitted input is cancelled and entered again." : ONE_TIME_HINT}
      footer={
        <>
          {editing && existing && (
            <Link href={`/payroll/inputs/${existing.id}`} className="me-auto inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-primary hover:underline">
              Open full page <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
            </Link>
          )}
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="secondary" className="min-h-[44px]" disabled={busy || !!notDraft || !!loadError} onClick={() => void save(false)}>
            Save as draft
          </Button>
          <Button type="submit" form="wage-input-form" className="min-h-[44px]" loading={busy} disabled={!!notDraft || !!loadError}>
            Submit for approval
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      ) : loadError ? (
        <p role="alert" className="text-sm text-danger">
          {isNotFound(loadError) ? "This input was not found, or it is outside your scope." : (loadError as Error).message}
        </p>
      ) : (
        <form id="wage-input-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <ConflictBanner
            error={serverError}
            onReload={() => {
              if (editing) {
                setServerError(null);
                setLoading(true);
                wageInputsApi.get(inputId!).then((row) => {
                  setExisting(row);
                  const state = initialState(companyCurrency, row);
                  setForm(state);
                  pristine.current = JSON.stringify(state);
                }).finally(() => setLoading(false));
              }
            }}
          />
          <ErrorSummary error={serverError} fields={errors} />
          {notDraft && (
            <p role="status" className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
              This input is no longer a draft, so it can&apos;t be edited. Cancel it and add a new one if it is wrong.
            </p>
          )}
          {!editing && <EmployeeField value={form.employeeId} onChange={(v) => set("employeeId", v)} error={errors.employeeId} />}
          {editing && existing && (
            <p className="text-sm text-muted-foreground">
              Component <span className="font-medium text-foreground">{existing.component_code}</span> · period{" "}
              <bdi dir="ltr">{existing.target_period.start}</bdi> – <bdi dir="ltr">{existing.target_period.end}</bdi>
            </p>
          )}
          {!editing &&
            (canPickComponent && componentChoices.length > 0 ? (
              <Field label="Component" required error={errors.component} hint={ONE_TIME_HINT}>
                <Select value={form.component} onChange={(e) => set("component", e.target.value)}>
                  <option value="">Choose…</option>
                  {componentChoices.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Component code" required error={errors.component} hint={`${ONE_TIME_HINT}, for example BONUS`}>
                <Input value={form.component} maxLength={40} onChange={(e) => set("component", e.target.value.toUpperCase())} />
              </Field>
            ))}
          <fieldset className="space-y-3">
            <legend className="text-[13px] font-medium">Value</legend>
            <div role="radiogroup" aria-label="Value type" className="inline-flex rounded-xl border border-border p-1">
              {(["amount", "units", "measure"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={form.mode === m}
                  disabled={editing}
                  onClick={() => set("mode", m)}
                  className={`min-h-[40px] rounded-lg px-4 text-sm font-medium ${form.mode === m ? "bg-primary-soft text-foreground" : "text-muted-foreground"}`}
                >
                  {m === "amount" ? "Amount" : m === "units" ? "Units × rate" : "Incentive measure"}
                </button>
              ))}
            </div>
            {form.mode === "amount" ? (
              <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                <Field label="Amount" required error={errors.amount} hint="A deduction or recovery is entered as a negative amount.">
                  <Input inputMode="decimal" dir="ltr" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
                </Field>
                <Field label="Currency" required error={errors.currency}>
                  <Input dir="ltr" maxLength={3} value={form.currency} disabled={editing} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
                </Field>
              </div>
            ) : form.mode === "measure" ? (
              <Field
                label="Achievement measure"
                required
                error={errors.units}
                hint="In the unit of your incentive plan's targets. The plan's formula turns approved measures into the incentive; measures are always approved first."
              >
                <Input inputMode="decimal" dir="ltr" value={form.units} onChange={(e) => set("units", e.target.value)} />
              </Field>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Units" required error={errors.units} hint="Hours, days or pieces">
                  <Input inputMode="decimal" dir="ltr" value={form.units} onChange={(e) => set("units", e.target.value)} />
                </Field>
                <Field label="Rate per unit (optional)" error={errors.rate} hint="Empty uses the component's rate">
                  <Input inputMode="decimal" dir="ltr" value={form.rate} onChange={(e) => set("rate", e.target.value)} />
                </Field>
              </div>
            )}
          </fieldset>
          {!editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Period start" required error={errors.periodStart}>
                <Input type="date" value={form.periodStart} onChange={(e) => set("periodStart", e.target.value)} />
              </Field>
              <Field label="Period end" required error={errors.periodEnd}>
                <Input type="date" value={form.periodEnd} onChange={(e) => set("periodEnd", e.target.value)} />
              </Field>
            </div>
          )}
          <Field label="Reason" error={errors.reason} hint="Shown to approvers and kept in the audit trail.">
            <Textarea rows={2} maxLength={1000} value={form.reason} onChange={(e) => set("reason", e.target.value)} />
          </Field>
          <details className="rounded-xl border border-border px-3 py-2">
            <summary className="min-h-[36px] cursor-pointer text-sm font-medium">Advanced</summary>
            <div className="mt-3 space-y-3">
              <Field label="External reference" error={errors.externalRef} hint="Your own ID; a second input with the same reference is refused.">
                <Input maxLength={100} value={form.externalRef} onChange={(e) => set("externalRef", e.target.value)} />
              </Field>
              {!editing && form.mode !== "measure" && (
                <>
                  <div className="flex min-h-[44px] items-center justify-between gap-3">
                    <span id="wi-recurring" className="text-sm">
                      Repeat every period
                    </span>
                    <Switch checked={form.recurring} onChange={(v) => set("recurring", v)} aria-labelledby="wi-recurring" />
                  </div>
                  {form.recurring && (
                    <Field label="Repeat until" required error={errors.until} hint="Up to 24 periods.">
                      <Input type="date" value={form.until} onChange={(e) => set("until", e.target.value)} />
                    </Field>
                  )}
                </>
              )}
            </div>
          </details>
          <p className="text-xs text-muted-foreground">
            Submitted inputs may need approval (above your company&apos;s threshold). Only approved inputs are picked up by a pay run.
          </p>
        </form>
      )}
    </Modal>
  );
}

function mapFields(fields: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {
    employee_id: "employeeId",
    component_code: "component",
    period_start: "periodStart",
    period_end: "periodEnd",
    external_ref: "externalRef",
    recurrence: "until",
    measure: "units",
  };
  const out: Record<string, string> = {};
  Object.entries(fields).forEach(([k, v]) => {
    out[map[k] ?? k] = v;
  });
  return out;
}
