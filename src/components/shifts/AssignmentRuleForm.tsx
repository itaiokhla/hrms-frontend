"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { useCan } from "@/components/access/Can";
import type { FormRenderProps } from "@/components/shared/FormHost";
import { EmployeePicker } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Shift, ShiftRule, ShiftRuleCriteria } from "@/lib/types";

import { shiftFieldErrors, shiftsApi, type RuleBody, type RulePreview } from "./api";
import { ShiftChip } from "./ShiftChip";
import { ShiftErrorNotice } from "./ShiftForm";
import { CRITERIA_DIMENSIONS, PRIORITY_BANDS, criteriaChips, priorityBand, todayIn, type CriteriaDimension } from "./shiftModel";

interface Option { id: number; label: string }

/** Active shifts for pickers and code lookups (one page of 200, the catalogue size of a tenant). */
export function useShiftOptions(status: "ACTIVE" | "ALL" = "ACTIVE") {
  const { data } = useApi(() => shiftsApi.list({ status, limit: 200, sort: "code" }), [status]);
  const items = useMemo(() => data?.items ?? [], [data]);
  const byId = useMemo(() => new Map(items.map((s) => [s.id, s])), [items]);
  return { items, byId };
}

/** Branch / entity / department names for the criteria builder and chips (best effort). */
export function useOrgOptions(enabled = true) {
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = (key: string, url: string, label: (r: Record<string, unknown>) => string) =>
      api.get<Record<string, unknown>[]>(url)
        .then((rows) => live && setOptions((o) => ({ ...o, [key]: rows.map((r) => ({ id: Number(r.id), label: label(r) })) })))
        .catch(() => undefined);
    void load("branch_ids", "/branches", (r) => String(r.name ?? r.code));
    void load("legal_entity_ids", "/legal-entities", (r) => String(r.trade_name || r.legal_name || r.code));
    void load("department_ids", "/departments", (r) => String(r.name));
    return () => {
      live = false;
    };
  }, [enabled]);
  const name = (dimension: string, id: number | string) => options[dimension]?.find((o) => o.id === Number(id))?.label;
  return { options, name };
}

function dimensionOf(criteria: ShiftRuleCriteria | undefined): CriteriaDimension {
  for (const d of CRITERIA_DIMENSIONS) {
    if (d.value !== "everyone" && (criteria?.[d.value]?.length ?? 0) > 0) return d.value;
  }
  return "everyone";
}

interface RuleValues {
  name: string;
  shift_id: string;
  dimension: CriteriaDimension;
  ids: number[];
  employees: { id: number; full_name: string }[];
  priority: string;
  effective_from: string;
  effective_to: string;
  reason: string;
  active: boolean;
}

function toCriteria(v: RuleValues): ShiftRuleCriteria {
  if (v.dimension === "everyone") return { everyone: true };
  if (v.dimension === "employee_ids") return { employee_ids: v.employees.map((e) => e.id) };
  return { [v.dimension]: v.ids } as ShiftRuleCriteria;
}

/** Read-only facts of a rule (Sheet view and page twin). */
export function RuleView({ rule, shift, name }: { rule: ShiftRule; shift?: Shift; name: (d: string, id: number | string) => string | undefined }) {
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-2">
      <div><dt className="text-xs text-muted-foreground">Shift</dt><dd className="mt-1">{shift ? <ShiftChip code={shift.code ?? shift.name} color={shift.color_token} /> : `#${rule.shift_id}`}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Priority</dt><dd className="mt-1">{rule.priority} · {priorityBand(rule.priority)}</dd></div>
      <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Who it covers</dt>
        <dd className="mt-1 flex flex-wrap gap-1.5">{criteriaChips(rule.criteria, name).map((c) => <span key={c} className="rounded-full border border-border px-2 py-0.5 text-xs">{c}</span>)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Effective</dt><dd className="mt-1">{fmtDate(rule.effective_from)} – {rule.effective_to ? fmtDate(rule.effective_to) : "open-ended"}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="mt-1">{rule.status === "ACTIVE" ? "Active" : "Paused"}</dd></div>
      {rule.reason && <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Reason</dt><dd className="mt-1">{rule.reason}</dd></div>}
    </dl>
  );
}

/** The simulate result (§12.7): people whose shift changes, dates, payroll states. */
export function RuleImpact({ preview, shiftCode, personName }: { preview: RulePreview; shiftCode: (id: number) => string; personName: (id: number) => string }) {
  return (
    <section className="space-y-1 rounded-xl border border-border bg-surface-muted/50 p-3 text-sm" data-testid="rule-impact" aria-live="polite">
      <p className="font-medium">{preview.employees_affected} employees change shift on {preview.dates_changed} days</p>
      <p className="text-muted-foreground">Open: {preview.dates_by_payroll_state.OPEN} · Locked for payroll: {preview.dates_by_payroll_state.INPUT_LOCKED} · Paid (final): {preview.dates_by_payroll_state.FINALIZED}</p>
      {preview.sample.length > 0 && (
        <ul className="list-disc ps-5 text-muted-foreground">
          {preview.sample.slice(0, 5).map((s) => (
            <li key={s.employee_id}>{personName(s.employee_id)} from {fmtDate(s.from)}: {s.before ? `${shiftCode(s.before.shift_id)} (${s.before.source.toLowerCase()})` : "no shift"} → {s.after ? `${shiftCode(s.after.shift_id)} (${s.after.source.toLowerCase()})` : "no shift"}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * `ShiftRuleForm` (§17.4; 09-ui-ux/03 §5.11) on `FormHost` (`?modal=shift-rule`): name, shift, **Who it covers**,
 * priority with band presets (higher wins), dates, reason (needed for a past start) and **Preview impact**. A rule in
 * force keeps its shift, people and priority: they change only through "Change from a date…" (`replaces_rule_id`).
 */
export function AssignmentRuleForm({ formId, mode, idempotencyKey, setDirty, setSubmitting, onSuccess, rule, defaultShiftId }:
  Pick<FormRenderProps, "formId" | "mode" | "idempotencyKey" | "setDirty" | "setSubmitting" | "onSuccess"> & {
    rule?: ShiftRule | null; defaultShiftId?: number | null }) {
  const { me } = useCan();
  const today = useMemo(() => todayIn(me?.company?.timezone), [me?.company?.timezone]);
  const shifts = useShiftOptions();
  const org = useOrgOptions();
  const editing = mode === "edit" && !!rule;
  const inForce = editing && rule!.effective_from <= today;
  const initial = useMemo<RuleValues>(() => ({
    name: rule?.name ?? "", shift_id: rule ? String(rule.shift_id) : defaultShiftId ? String(defaultShiftId) : "",
    dimension: dimensionOf(rule?.criteria), ids: (rule?.criteria?.[dimensionOf(rule?.criteria) as "branch_ids"] as number[] | undefined) ?? [],
    employees: (rule?.criteria?.employee_ids ?? []).map((id) => ({ id, full_name: `Employee #${id}` })),
    priority: String(rule?.priority ?? 500), effective_from: editing ? rule!.effective_from : today,
    effective_to: rule?.effective_to ?? "", reason: "", active: rule ? rule.status === "ACTIVE" : true,
  }), [rule, defaultShiftId, editing, today]);
  const [values, setValues] = useState(initial);
  const [replace, setReplace] = useState(false);
  const [replaceFrom, setReplaceFrom] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const first = useRef(true);
  useEffect(() => setValues(initial), [initial]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setDirty(JSON.stringify(values) !== JSON.stringify(initial) || replace);
    setPreview(null);
  }, [values, initial, replace, setDirty]);

  const set = <K extends keyof RuleValues>(key: K, value: RuleValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const locked = inForce && !replace;
  const from = replace ? replaceFrom : values.effective_from;

  const check = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!values.name.trim()) e.name = "Give the rule a name.";
    if (!values.shift_id) e.shift_id = "Choose the shift.";
    if (values.dimension === "employee_ids" && !values.employees.length) e.criteria = "Add at least one employee.";
    if (values.dimension !== "everyone" && values.dimension !== "employee_ids" && !values.ids.length) e.criteria = "Choose at least one.";
    if (!/^\d+$/.test(values.priority) || Number(values.priority) > 1_000_000) e.priority = "Enter a whole number from 0 to 1000000.";
    if (!from) e[replace ? "replace_from" : "effective_from"] = "Choose the start date.";
    else if (!editing || replace) {
      if (from < today && !values.reason.trim()) e.reason = "Give a reason for a start date in the past.";
      if (replace && rule && from <= rule.effective_from) e.replace_from = "Start after the current rule's start date.";
    }
    if (values.effective_to && from && values.effective_to < from) e.effective_to = "The end date is before the start date.";
    return e;
  };

  const createBody = (): RuleBody => ({
    name: values.name.trim(), shift_id: Number(values.shift_id), criteria: toCriteria(values), priority: Number(values.priority),
    effective_from: from, effective_to: values.effective_to || null, reason: values.reason.trim() || null,
    replaces_rule_id: replace && rule ? rule.id : null,
  });

  const runPreview = async () => {
    const e = check();
    setErrors(e);
    if (Object.keys(e).length) return;
    setPreviewing(true);
    setError(null);
    try {
      setPreview(await shiftsApi.simulateRule(createBody()));
    } catch (err) {
      setError(err);
      setErrors(shiftFieldErrors(err));
    } finally {
      setPreviewing(false);
    }
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e = check();
    setErrors(e);
    setError(null);
    if (Object.keys(e).length) return;
    setSubmitting(true);
    try {
      if (!editing || replace) {
        const created = await shiftsApi.createRule(createBody(), idempotencyKey);
        onSuccess({ id: created.id });
      } else {
        const patch = locked
          ? { name: values.name.trim(), effective_to: values.effective_to || null, status: values.active ? ("ACTIVE" as const) : ("INACTIVE" as const), reason: values.reason.trim() || null }
          : { name: values.name.trim(), shift_id: Number(values.shift_id), criteria: toCriteria(values), priority: Number(values.priority),
              effective_to: values.effective_to || null, status: values.active ? ("ACTIVE" as const) : ("INACTIVE" as const), reason: values.reason.trim() || null };
        await shiftsApi.updateRule(rule!.id, patch, rule!.row_version);
        onSuccess({ id: rule!.id });
      }
    } catch (err) {
      setError(err);
      setErrors(shiftFieldErrors(err));
    } finally {
      setSubmitting(false);
    }
  };

  const options = org.options[values.dimension] ?? [];
  const shiftCode = (id: number) => shifts.byId.get(id)?.code ?? `#${id}`;
  const personName = (id: number) => values.employees.find((e) => e.id === id)?.full_name ?? `Employee #${id}`;

  return (
    <form id={formId} onSubmit={submit} noValidate className="space-y-4" data-testid="shift-rule-form">
      <ShiftErrorNotice error={error} />
      <Field label="Name" required error={errors.name}>
        <Input value={values.name} maxLength={100} onChange={(e) => set("name", e.target.value)} />
      </Field>
      {inForce && (
        <div className="rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-sm">
          <p>This rule is in force. Its shift, people and priority change only from a date.</p>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            Change from a date…
          </label>
          {replace && (
            <Field label="New rule starts on" required error={errors.replace_from} className="mt-2 sm:w-56">
              <Input type="date" value={replaceFrom} onChange={(e) => setReplaceFrom(e.target.value)} />
            </Field>
          )}
        </div>
      )}
      {locked ? (
        <RuleView rule={rule!} shift={shifts.byId.get(rule!.shift_id)} name={org.name} />
      ) : (
        <>
          <Field label="Shift" required error={errors.shift_id}>
            <Select value={values.shift_id} onChange={(e) => set("shift_id", e.target.value)}>
              <option value="">Choose a shift…</option>
              {shifts.items.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            </Select>
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium">Who it covers</legend>
            <Select aria-label="Cover by" value={values.dimension}
              onChange={(e) => setValues((v) => ({ ...v, dimension: e.target.value as CriteriaDimension, ids: [] }))}>
              {CRITERIA_DIMENSIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </Select>
            {values.dimension === "employee_ids" ? (
              <div className="space-y-2">
                <EmployeePicker value={null} excludeIds={values.employees.map((e) => e.id)}
                  onChange={(p) => p && set("employees", [...values.employees, { id: p.id, full_name: p.full_name }])} />
                <ul className="flex flex-wrap gap-1.5">
                  {values.employees.map((p) => (
                    <li key={p.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
                      {p.full_name}
                      <button type="button" aria-label={`Remove ${p.full_name}`} onClick={() => set("employees", values.employees.filter((x) => x.id !== p.id))}>
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : values.dimension !== "everyone" ? (
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-border p-2 text-sm">
                {options.length === 0 && <p className="text-muted-foreground">Nothing to choose from.</p>}
                {options.map((o) => (
                  <label key={o.id} className="flex items-center gap-2">
                    <input type="checkbox" className="h-4 w-4 accent-primary" checked={values.ids.includes(o.id)}
                      onChange={(e) => set("ids", e.target.checked ? [...values.ids, o.id] : values.ids.filter((x) => x !== o.id))} />
                    {o.label}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Published rosters still win over this rule.</p>
            )}
            {errors.criteria && <p role="alert" className="text-xs font-medium text-danger">{errors.criteria}</p>}
          </fieldset>
          <div className="space-y-2">
            <Field label="Priority" required error={errors.priority} hint={`Higher number wins. ${/^\d+$/.test(values.priority) ? priorityBand(Number(values.priority)) : ""}`}>
              <Input inputMode="numeric" className="sm:w-40" value={values.priority} onChange={(e) => set("priority", e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Priority presets">
              {PRIORITY_BANDS.map((b) => (
                <button key={b.value} type="button" onClick={() => set("priority", String(b.value))} aria-pressed={values.priority === String(b.value)}
                  className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-surface-muted aria-pressed:border-primary aria-pressed:bg-primary-soft">
                  {b.label} {b.value}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {!editing && (
          <Field label="Effective from" required error={errors.effective_from}>
            <Input type="date" value={values.effective_from} onChange={(e) => set("effective_from", e.target.value)} />
          </Field>
        )}
        <Field label="Effective to (optional)" error={errors.effective_to}>
          <Input type="date" value={values.effective_to} onChange={(e) => set("effective_to", e.target.value)} />
        </Field>
      </div>
      {editing && !replace && (
        <div className="flex min-h-[44px] items-center justify-between gap-3 text-sm">
          <span id="rule-active">Active</span>
          <Switch checked={values.active} onChange={(v) => set("active", v)} aria-labelledby="rule-active" />
        </div>
      )}
      <Field label="Reason" error={errors.reason} hint="Needed when the start date is in the past.">
        <Textarea rows={2} maxLength={500} value={values.reason} onChange={(e) => set("reason", e.target.value)} />
      </Field>
      {(!editing || replace || !locked) && (
        <div className="space-y-2">
          <Button type="button" variant="secondary" onClick={() => void runPreview()} loading={previewing}>Preview impact</Button>
          {preview && <RuleImpact preview={preview} shiftCode={shiftCode} personName={personName} />}
        </div>
      )}
    </form>
  );
}
