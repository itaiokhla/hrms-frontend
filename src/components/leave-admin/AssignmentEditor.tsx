"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus, Save, Trash2, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { EmployeePicker } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/field";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Badge, MotionSafe, Skeleton } from "@/components/ui/primitives";
import { fmtDate, todayISO } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { leaveAdminApi } from "@/lib/leave/adminApi";
import type { AssignmentCriteria, AssignmentRule } from "@/lib/leave/adminTypes";

import { ChipToggleGroup, ErrorNotice, useOrgOptions, type Option } from "./shared";

type IdDim = "legal_entity_ids" | "branch_ids" | "department_ids" | "grade_ids" | "designation_ids";

export interface RuleDraft {
  everyone: boolean;
  ids: Record<IdDim, number[]>;
  /** Free-text ids for dimensions whose options could not be loaded. */
  idText: Partial<Record<IdDim, string>>;
  employment_types: string;
  employees: { id: number; full_name: string }[];
  priority: string;
  effective_from: string;
  effective_to: string;
}

const DIMS: { key: IdDim; label: string; option: "entities" | "branches" | "departments" | "grades" | "designations" }[] = [
  { key: "legal_entity_ids", label: "Legal entities", option: "entities" },
  { key: "branch_ids", label: "Branches", option: "branches" },
  { key: "department_ids", label: "Departments", option: "departments" },
  { key: "grade_ids", label: "Grades", option: "grades" },
  { key: "designation_ids", label: "Designations", option: "designations" },
];

export function ruleToDraft(rule: AssignmentRule | null, today = todayISO()): RuleDraft {
  const c: AssignmentCriteria = rule?.criteria ?? { everyone: true };
  return {
    everyone: !rule || c.everyone === true,
    ids: {
      legal_entity_ids: c.legal_entity_ids ?? [],
      branch_ids: c.branch_ids ?? [],
      department_ids: c.department_ids ?? [],
      grade_ids: c.grade_ids ?? [],
      designation_ids: c.designation_ids ?? [],
    },
    idText: {},
    employment_types: (c.employment_types ?? []).join(", "),
    employees: (c.employee_ids ?? []).map((id) => ({ id, full_name: `Employee #${id}` })),
    priority: String(rule?.priority ?? 0),
    effective_from: rule?.effective_from ?? today,
    effective_to: rule?.effective_to ?? "",
  };
}

/** Rule drafts → the `PUT /plans/{id}/assignments` body, or the first problem found. */
export function draftsToRules(drafts: RuleDraft[]): { ok: true; rules: Omit<AssignmentRule, "id" | "status">[] } | { ok: false; error: string } {
  const rules: Omit<AssignmentRule, "id" | "status">[] = [];
  for (let index = 0; index < drafts.length; index++) {
    const d = drafts[index];
    const n = index + 1;
    if (!/^\d+$/.test(d.priority.trim()) || Number(d.priority) > 1000) return { ok: false, error: `Rule ${n}: the priority is a whole number from 0 to 1000.` };
    if (!d.effective_from) return { ok: false, error: `Rule ${n}: choose the date it starts.` };
    if (d.effective_to && d.effective_to < d.effective_from) return { ok: false, error: `Rule ${n}: the end date is before the start date.` };
    const criteria: AssignmentCriteria = {};
    if (d.everyone) {
      criteria.everyone = true;
    } else {
      for (const dim of DIMS) {
        const text = d.idText[dim.key]?.trim();
        if (text) {
          const parts = text.split(/[\s,]+/).filter(Boolean);
          if (parts.some((x) => !/^\d+$/.test(x))) return { ok: false, error: `Rule ${n}: ${dim.label.toLowerCase()} must be record ids.` };
          criteria[dim.key] = Array.from(new Set(parts.map(Number)));
        } else if (d.ids[dim.key].length) {
          criteria[dim.key] = d.ids[dim.key];
        }
      }
      const types = d.employment_types.split(/[\s,]+/).filter(Boolean);
      if (types.length) criteria.employment_types = Array.from(new Set(types));
      if (d.employees.length) criteria.employee_ids = d.employees.map((e) => e.id);
      if (!Object.keys(criteria).length) return { ok: false, error: `Rule ${n}: choose who it covers, or “Everyone”.` };
    }
    rules.push({ criteria, priority: Number(d.priority), effective_from: d.effective_from, effective_to: d.effective_to || null });
  }
  return { ok: true, rules };
}

/** Readable chips of a rule's criteria. */
export function criteriaChips(c: AssignmentCriteria, name: (dim: IdDim, id: number) => string): string[] {
  if (c.everyone) return ["Everyone"];
  const out: string[] = [];
  DIMS.forEach((dim) => (c[dim.key] ?? []).forEach((id) => out.push(name(dim.key, id))));
  (c.employment_types ?? []).forEach((t) => out.push(`Type ${t}`));
  if (c.employee_ids?.length) out.push(`${c.employee_ids.length} named employee(s)`);
  return out;
}

/**
 * Who the plan covers (03-leave/01 §6): rules with criteria, priority and effective dates. Every condition of a rule
 * must match; across plans the higher priority wins and equal overlapping priorities are refused as ambiguous.
 */
export function AssignmentEditor({ planId, readOnly, onSaved }: { planId: number; readOnly: boolean; onSaved?: () => void }) {
  const current = useApi(() => leaveAdminApi.assignments(planId), [planId]);
  const org = useOrgOptions();
  const [drafts, setDrafts] = useState<RuleDraft[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (current.data) {
      setDrafts(current.data.rules.map((r) => ruleToDraft(r)));
      setDirty(false);
    }
  }, [current.data]);

  const update = (index: number, patch: Partial<RuleDraft>) => {
    setDrafts((all) => (all ?? []).map((d, i) => (i === index ? { ...d, ...patch } : d)));
    setDirty(true);
    setProblem(null);
  };
  const optionsOf = (dim: (typeof DIMS)[number]): Option[] => org[dim.option];

  const save = async () => {
    if (!drafts) return;
    const built = draftsToRules(drafts);
    if (!built.ok) return setProblem(built.error);
    setBusy(true);
    setError(null);
    try {
      const saved = await leaveAdminApi.putAssignments(planId, built.rules);
      setDrafts(saved.rules.map((r) => ruleToDraft(r)));
      setDirty(false);
      toast.success("Assignment rules saved");
      onSaved?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (current.error && !current.data) return <ErrorState message={current.error.message} onRetry={() => void current.reload()} />;
  if (!drafts) return <Skeleton className="h-48 rounded-2xl" />;

  return (
    <div className="space-y-4" data-testid="assignment-editor">
      <p className="text-sm text-muted-foreground">
        Every condition of a rule must match. When several plans match an employee, the higher priority wins; equal
        priorities that could cover the same person are refused as ambiguous. A low-priority “Everyone” rule is a good catch-all.
      </p>
      {drafts.length === 0 && (
        <EmptyState icon={<Users />} title="This plan covers nobody yet" description="Add a rule to say who it applies to." className="py-8" />
      )}
      <MotionSafe>
        <AnimatePresence initial={false}>
          {drafts.map((d, index) => (
            <motion.fieldset
              key={index}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-4 rounded-2xl border border-border p-4"
              disabled={readOnly}
              data-testid={`assignment-rule-${index}`}
            >
              <legend className="px-1 text-sm font-semibold">Rule {index + 1}</legend>
              <div className="flex flex-wrap items-end gap-3">
                <label className="inline-flex min-h-[40px] items-center gap-2 text-sm font-medium">
                  <Switch checked={d.everyone} onChange={(v) => update(index, { everyone: v })} label="Everyone" />
                  Everyone
                </label>
                <Field label="Priority" className="w-28" hint="0–1000">
                  <Input inputMode="numeric" value={d.priority} onChange={(e) => update(index, { priority: e.target.value })} data-testid={`assignment-priority-${index}`} />
                </Field>
                <Field label="From" className="w-44">
                  <Input type="date" value={d.effective_from} onChange={(e) => update(index, { effective_from: e.target.value })} />
                </Field>
                <Field label="Until (optional)" className="w-44">
                  <Input type="date" value={d.effective_to} onChange={(e) => update(index, { effective_to: e.target.value })} />
                </Field>
                <span className="flex-1" />
                {!readOnly && (
                  <Button variant="danger-ghost" size="icon" aria-label={`Remove rule ${index + 1}`}
                    onClick={() => { setDrafts((all) => (all ?? []).filter((_, i) => i !== index)); setDirty(true); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {!d.everyone && (
                <div className="space-y-4">
                  {DIMS.map((dim) => {
                    const options = optionsOf(dim);
                    return options.length ? (
                      <ChipToggleGroup key={dim.key} label={dim.label} value={d.ids[dim.key]} disabled={readOnly}
                        options={options.map((o) => ({ value: o.id, label: o.label }))}
                        onChange={(ids) => update(index, { ids: { ...d.ids, [dim.key]: ids } })} />
                    ) : (
                      <Field key={dim.key} label={`${dim.label} (ids)`} hint="Comma-separated record ids; the list could not be loaded.">
                        <Input dir="ltr" value={d.idText[dim.key] ?? d.ids[dim.key].join(", ")}
                          onChange={(e) => update(index, { idText: { ...d.idText, [dim.key]: e.target.value } })} />
                      </Field>
                    );
                  })}
                  {org.employmentTypes.length ? (
                    <ChipToggleGroup label="Employment types" disabled={readOnly}
                      value={d.employment_types.split(/[\s,]+/).filter(Boolean)}
                      options={org.employmentTypes.map((o) => ({ value: o.code ?? o.label, label: o.label }))}
                      onChange={(codes) => update(index, { employment_types: codes.join(", ") })} />
                  ) : (
                    <Field label="Employment types" hint="Codes, comma-separated">
                      <Input dir="ltr" value={d.employment_types} onChange={(e) => update(index, { employment_types: e.target.value })} />
                    </Field>
                  )}
                  <div className="space-y-1.5">
                    <p className="text-[13px] font-medium">Named employees</p>
                    <div className="flex flex-wrap gap-1.5">
                      {d.employees.map((e) => (
                        <span key={e.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs">
                          {e.full_name}
                          {!readOnly && (
                            <button type="button" aria-label={`Remove ${e.full_name}`} onClick={() => update(index, { employees: d.employees.filter((x) => x.id !== e.id) })}>
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                    {!readOnly && (
                      <div className="max-w-sm">
                        <EmployeePicker value={null} placeholder="Add an employee…" excludeIds={d.employees.map((e) => e.id)}
                          onChange={(picked) => picked && update(index, { employees: [...d.employees, { id: picked.id, full_name: picked.full_name }] })} />
                      </div>
                    )}
                  </div>
                </div>
              )}
              {d.everyone && <Badge tone="primary">Covers everyone{d.effective_to ? ` until ${fmtDate(d.effective_to)}` : ""}</Badge>}
            </motion.fieldset>
          ))}
        </AnimatePresence>
      </MotionSafe>
      {problem && <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm">{problem}</p>}
      <ErrorNotice error={error} />
      {!readOnly && (
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" onClick={() => { setDrafts((all) => [...(all ?? []), { ...ruleToDraft(null), everyone: (all ?? []).length === 0 }]); setDirty(true); }}
            data-testid="assignment-add">
            <Plus className="h-4 w-4" /> Add rule
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!dirty} data-testid="assignment-save">
            <Save className="h-4 w-4" /> Save rules
          </Button>
        </div>
      )}
    </div>
  );
}

export type { IdDim };
