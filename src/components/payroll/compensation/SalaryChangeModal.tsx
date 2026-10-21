"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { Segmented } from "@/components/branding/fields";
import { DiffView } from "@/components/payroll/DiffView";
import { MoneyText } from "@/components/payroll/MoneyText";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { compareDecimalStrings } from "@/lib/money";
import { percentChange } from "@/lib/payroll/labels";
import { isConflict, newIdempotencyKey, PayrollApiError } from "@/lib/payroll/api";

import { compensationApi } from "./api";
import { BreakdownTable, type Period } from "./BreakdownTable";
import { decimalFromInput, moneyFromInput, payBasisLabel, REASON_LABEL, todayIso } from "./format";
import { GradePosition } from "./GradePosition";
import { ConflictBanner, ErrorSummary } from "./shared";
import { ASSIGNMENT_REASONS, type AssignmentReason, type CompareResult, type EmployeeCompensation, type OverrideValue, type SalaryStructure, type StructureVersion } from "./types";

export type SalaryChangeMode = "assign" | "revise";

/**
 * "Assign salary" (?modal=assign-salary&employee=) and "Revise salary" (?modal=revise&employee=)
 * (3.8 §6): structure, amount, overrides within the line bounds, effective date, reason and approval
 * note, with a live breakdown (and the before/after diff and grade-range position for a revision) from
 * POST /payroll/employees/{id}/compensation/preview. Saving submits the change for approval; nothing
 * is paid until it is approved. Full page: /payroll/compensation/{employeeId}.
 */
export const SALARY_MODAL: Record<SalaryChangeMode, string> = { assign: "assign-salary", revise: "revise" };

export function SalaryChangeModal({ mode, onSaved }: { mode: SalaryChangeMode; onSaved?: () => void }) {
  const [touched, setTouched] = useState(false);
  const route = useModalRoute(SALARY_MODAL[mode], { keys: ["employee"], dirty: touched });
  const employeeParam = route.param("employee");
  const [picked, setPicked] = useState<PickedEmployee | null>(null);
  const employeeId = employeeParam ? Number.parseInt(employeeParam, 10) : picked?.id ?? null;
  const [context, setContext] = useState<EmployeeCompensation | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [structures, setStructures] = useState<SalaryStructure[] | null>(null);
  const [structureId, setStructureId] = useState<number | null>(null);
  const [structure, setStructure] = useState<SalaryStructure | null>(null);
  const [amount, setAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [reason, setReason] = useState<AssignmentReason>(mode === "assign" ? "HIRE" : "REVISION");
  const [note, setNote] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<CompareResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [period, setPeriod] = useState<Period>("monthly");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);

  // Reset when the modal opens for another employee.
  useEffect(() => {
    if (!route.open) return;
    setContext(null);
    setContextError(null);
    setPreview(null);
    setFieldErrors({});
    setServerError(null);
    setConflict(null);
    setOverrides({});
    setNote("");
    setTouched(false);
    setKey(newIdempotencyKey());
    setEffectiveFrom(todayIso());
    if (!employeeId) return;
    compensationApi
      .employeeCompensation(employeeId)
      .then((c) => {
        setContext(c);
        if (c.current) {
          setStructureId(c.current.structure.id);
          setAmount(c.current.pay_basis_amount.amount);
          if (mode === "assign" && c.current) setReason("REVISION");
        } else if (mode === "assign") setReason("HIRE");
      })
      .catch((e) => setContextError(errorMessage(e)));
  }, [route.open, employeeId, mode]);

  useEffect(() => {
    if (!route.open || structures) return;
    compensationApi
      .listStructures()
      .then((list) => setStructures(list.filter((s) => s.active_version)))
      .catch(() => setStructures([]));
  }, [route.open, structures]);

  useEffect(() => {
    if (!structureId) {
      setStructure(null);
      return;
    }
    let cancelled = false;
    compensationApi
      .getStructure(structureId)
      .then((s) => !cancelled && setStructure(s))
      .catch((e) => !cancelled && setPreviewError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [structureId]);

  const version: StructureVersion | undefined = structure?.versions?.find((v) => v.status === "ACTIVE");
  const currency = structure?.currency ?? context?.current?.currency ?? context?.pay_group?.currency ?? "INR";
  const overridable = (version?.lines ?? []).filter((l) => l.overridable);
  const parsed = amount.trim() ? moneyFromInput(amount, currency) : { money: null, error: null };

  const overrideBody = useMemo(() => {
    const out: Record<string, OverrideValue> = {};
    for (const line of overridable) {
      const raw = overrides[line.component];
      if (!raw?.trim()) continue;
      const v = decimalFromInput(raw);
      if (v.value) out[line.component] = line.method === "PERCENT_OF" ? { percent: v.value } : { amount: v.value };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(overrides), version?.id]);

  const overrideErrors: Record<string, string> = {};
  for (const line of overridable) {
    const raw = overrides[line.component];
    if (!raw?.trim()) continue;
    const v = decimalFromInput(raw);
    if (v.error) overrideErrors[line.component] = v.error;
    else if (v.value && line.override_min && compareDecimalStrings(v.value, line.override_min) < 0) overrideErrors[line.component] = `At least ${line.override_min}.`;
    else if (v.value && line.override_max && compareDecimalStrings(v.value, line.override_max) > 0) overrideErrors[line.component] = `At most ${line.override_max}.`;
  }

  // Live breakdown.
  useEffect(() => {
    if (!route.open || !employeeId || !version || !parsed.money || !effectiveFrom || Object.keys(overrideErrors).length) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setPreviewing(true);
      compensationApi
        .previewChange(employeeId, { pay_basis_amount: parsed.money!, effective_from: effectiveFrom, template_version_id: version.id, overrides: overrideBody }, controller.signal)
        .then((r) => {
          setPreview(r);
          setPreviewError(null);
        })
        .catch((e) => !controller.signal.aborted && setPreviewError(errorMessage(e)))
        .finally(() => !controller.signal.aborted && setPreviewing(false));
    }, 450);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.open, employeeId, version?.id, parsed.money?.amount, effectiveFrom, overrideBody]);

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!employeeId) errs.employee = "Choose an employee.";
    if (!version) errs.structure = "Choose a published structure.";
    if (!parsed.money) errs.amount = parsed.error ?? "Enter an amount.";
    if (!effectiveFrom) errs.effective_from = "Choose the date it starts.";
    for (const [c, m] of Object.entries(overrideErrors)) errs[`override:${c}`] = `${c}: ${m}`;
    setFieldErrors(errs);
    setServerError(null);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await compensationApi.assign(employeeId!, { template_version_id: version!.id, pay_basis_amount: parsed.money!, effective_from: effectiveFrom, reason, overrides: Object.keys(overrideBody).length ? overrideBody : undefined, note: note.trim() || undefined, submit: true }, key);
      toast.success(mode === "assign" ? "Salary sent for approval. Payroll uses it once it is approved." : "Revision sent for approval. The current salary stays until it is approved.");
      setTouched(false);
      onSaved?.();
      await route.close();
    } catch (e) {
      setKey(newIdempotencyKey());
      if (isConflict(e)) setConflict(errorMessage(e));
      else if (e instanceof PayrollApiError) {
        const detail = (e.detail && typeof e.detail === "object" ? e.detail : {}) as { field?: string; minimum_pay_basis?: { amount: string; currency: string }; reasons?: string[] };
        if (e.code === "BALANCING_NEGATIVE") setFieldErrors({ amount: e.message });
        else if (detail.field === "pay_basis_amount") setFieldErrors({ amount: e.message });
        else if (detail.field === "effective_to" || detail.field === "effective_from") setFieldErrors({ effective_from: e.message });
        else setServerError(e.message);
      } else setServerError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const title = mode === "assign" ? "Assign salary" : "Revise salary";
  const before = preview?.before;
  const isRevision = !!context?.current;
  const change = preview?.pay_basis.change_pct ? percentChange(preview.pay_basis.change_pct) : null;

  return (
    <Modal
      open={route.open}
      onOpenChange={route.onOpenChange}
      title={
        <span className="flex flex-wrap items-center gap-3">
          {title}
          {employeeId && (
            <Link href={`/payroll/compensation/${employeeId}`} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-normal text-primary hover:underline sm:min-h-0">
              Open full page <ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
            </Link>
          )}
        </span>
      }
      description={context ? `${context.employee.name} · ${context.employee.employee_code}${context.legal_entity ? ` · ${context.legal_entity.name}` : ""}` : "Nothing changes until the salary is approved."}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => void route.close()}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={!!contextError}>
            Submit for approval
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onChange={() => setTouched(true)}
      >
        {conflict && <ConflictBanner message={conflict} onReload={() => route.onOpenChange(false)} />}
        <ErrorSummary errors={[...Object.values(fieldErrors), ...(serverError ? [serverError] : [])]} />
        {contextError && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
            {contextError}
          </p>
        )}
        {!employeeParam && (
          <Field label="Employee" required error={fieldErrors.employee}>
            <EmployeePicker value={picked} onChange={setPicked} />
          </Field>
        )}
        {isRevision && context?.current && (
          <p className="rounded-xl bg-surface-muted px-3 py-2 text-sm">
            Current: {context.current.structure.name} v{context.current.structure.version} · <MoneyText money={context.current.pay_basis_amount} /> from {context.current.effective_from}
          </p>
        )}
        {context && context.pending.length > 0 && <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">A salary change for this employee is already waiting for approval; a second one can&apos;t be submitted until it is decided.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Structure" required error={fieldErrors.structure} hint={structures && !structures.length ? "No published structures yet. Publish one under Salary structures." : undefined}>
            <Select value={structureId ?? ""} onChange={(e) => setStructureId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Choose…</option>
              {(structures ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (v{s.active_version})
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`${payBasisLabel(structure?.type)} (${currency})`} required error={fieldErrors.amount ?? (amount.trim() ? parsed.error ?? undefined : undefined)}>
            <Input dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Effective from" required error={fieldErrors.effective_from}>
            <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </Field>
          <Field label="Reason" required>
            <Select value={reason} onChange={(e) => setReason(e.target.value as AssignmentReason)}>
              {ASSIGNMENT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REASON_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {overridable.length > 0 && (
          <fieldset className="space-y-3 rounded-2xl border border-border p-3">
            <legend className="px-1 text-[13px] font-medium">Overrides for this employee (optional)</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {overridable.map((line) => (
                <Field
                  key={line.component}
                  label={`${line.component}${line.method === "PERCENT_OF" ? " (%)" : ""}`}
                  error={overrideErrors[line.component]}
                  hint={line.override_min || line.override_max ? `Between ${line.override_min ?? "any"} and ${line.override_max ?? "any"}.` : "Empty: the structure's value."}
                >
                  <Input dir="ltr" inputMode="decimal" value={overrides[line.component] ?? ""} onChange={(e) => setOverrides((o) => ({ ...o, [line.component]: e.target.value }))} />
                </Field>
              ))}
            </div>
          </fieldset>
        )}
        <Field label="Note for the approver">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <section aria-label="Breakdown preview" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h3 className="text-sm font-semibold">{isRevision ? "Before and after" : "Breakdown"}</h3>
            <Segmented<Period>
              label="Show"
              value={period}
              onChange={setPeriod}
              options={[
                { value: "monthly", label: "Monthly" },
                { value: "annual", label: "Annual" },
              ]}
            />
          </div>
          {previewError && (
            <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
              {previewError}
            </p>
          )}
          {previewing && !preview && <Skeleton className="h-40 w-full" />}
          {!preview && !previewing && !previewError && <p className="text-sm text-muted-foreground">Choose a structure and an amount to see the breakdown.</p>}
          {preview && (
            <div className="space-y-4" aria-busy={previewing || undefined}>
              {before && (
                <>
                  <p className="text-sm">
                    Pay basis <MoneyText money={preview.pay_basis.before} /> → <MoneyText money={preview.pay_basis.after} emphasis />
                    {change && (
                      <span className={change.direction === "up" ? "ms-2 text-success" : change.direction === "down" ? "ms-2 text-danger" : "ms-2"} aria-label={change.spoken}>
                        {change.text}
                      </span>
                    )}
                  </p>
                  <DiffView
                    caption="Salary before and after"
                    rows={preview.lines.map((l) => {
                      const b = period === "monthly" ? l.before_monthly : l.before_annual;
                      const a = period === "monthly" ? l.after_monthly : l.after_annual;
                      return { key: l.component, label: l.component, before: b ? <MoneyText money={b} /> : null, after: a ? <MoneyText money={a} /> : null, kind: !b ? "added" : !a ? "removed" : b.amount === a.amount ? "unchanged" : "changed" };
                    })}
                  />
                </>
              )}
              {!before && <BreakdownTable breakdown={preview.after} period={period} caption="New salary breakdown" />}
              <GradePosition range={preview.grade_range} />
            </div>
          )}
        </section>
      </form>
    </Modal>
  );
}

export function SalaryChangeSkeleton() {
  return <Skeleton className="h-64 w-full" />;
}
