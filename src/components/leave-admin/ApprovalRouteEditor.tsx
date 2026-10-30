"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, GitBranch, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Card, MotionSafe, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { leaveAdminApi } from "@/lib/leave/adminApi";
import type { ApproverType, RouteStep, RouteStepWrite, Sensitivity, StepCondition } from "@/lib/leave/adminTypes";

import { ChipToggleGroup, ErrorNotice, useLeaveTypes, useOrgOptions } from "./shared";

const APPROVERS: [ApproverType, string][] = [
  ["primary_manager", "Reporting manager"],
  ["skip_level_manager", "Manager's manager"],
  ["department_head", "Department head"],
  ["role", "Anyone with a role"],
];

export interface StepDraft {
  approver_type: ApproverType;
  role_id: string;
  min_days: string;
  sla_hours: string;
  leave_type_codes: string[];
  min_units: string;
  max_units: string;
  legal_entity_ids: number[];
  sensitivity: "" | Sensitivity;
}

export function stepToDraft(step?: RouteStep): StepDraft {
  const c = step?.condition ?? {};
  return {
    approver_type: step?.approver_type ?? "primary_manager",
    role_id: step?.role_id ? String(step.role_id) : "",
    min_days: step?.min_days ? String(step.min_days) : "",
    sla_hours: step?.sla_hours ? String(step.sla_hours) : "",
    leave_type_codes: c.leave_type_codes ?? [],
    min_units: c.min_units != null ? String(c.min_units) : "",
    max_units: c.max_units != null ? String(c.max_units) : "",
    legal_entity_ids: c.legal_entity_ids ?? [],
    sensitivity: c.sensitivity ?? "",
  };
}

const DEC = /^\d+(\.\d{1,2})?$/;

/** Step drafts → the `PUT /leaves/approval-route` steps, or the first problem. */
export function draftsToSteps(drafts: StepDraft[]): { ok: true; steps: RouteStepWrite[] } | { ok: false; error: string } {
  const steps: RouteStepWrite[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const n = i + 1;
    if (d.approver_type === "role" && !d.role_id) return { ok: false, error: `Step ${n}: choose the role.` };
    const int = (text: string, min: number, max: number) => /^\d+$/.test(text) && Number(text) >= min && Number(text) <= max;
    if (d.min_days && !int(d.min_days, 1, 366)) return { ok: false, error: `Step ${n}: “only from” is 1–366 days.` };
    if (d.sla_hours && !int(d.sla_hours, 1, 720)) return { ok: false, error: `Step ${n}: the reminder is 1–720 hours.` };
    if (d.min_units && !DEC.test(d.min_units)) return { ok: false, error: `Step ${n}: the smallest request is a number.` };
    if (d.max_units && !DEC.test(d.max_units)) return { ok: false, error: `Step ${n}: the largest request is a number.` };
    if (d.min_units && d.max_units && Number(d.min_units) > Number(d.max_units)) return { ok: false, error: `Step ${n}: the smallest request is above the largest.` };
    const condition: StepCondition = {};
    if (d.leave_type_codes.length) condition.leave_type_codes = d.leave_type_codes;
    if (d.min_units) condition.min_units = d.min_units;
    if (d.max_units) condition.max_units = d.max_units;
    if (d.legal_entity_ids.length) condition.legal_entity_ids = d.legal_entity_ids;
    if (d.sensitivity) condition.sensitivity = d.sensitivity;
    steps.push({
      approver_type: d.approver_type,
      role_id: d.approver_type === "role" ? Number(d.role_id) : null,
      min_days: d.min_days ? Number(d.min_days) : null,
      sla_hours: d.sla_hours ? Number(d.sla_hours) : null,
      condition: Object.keys(condition).length ? condition : null,
    });
  }
  return { ok: true, steps };
}

/**
 * The company's leave approval route (03-leave/04; `GET/PUT /leaves/approval-route`): ordered steps, each optionally
 * limited by conditions (leave types, request size, legal entities, sensitivity) and with a reminder after N hours.
 */
export function ApprovalRouteEditor({ canWrite }: { canWrite: boolean }) {
  const route = useApi(() => leaveAdminApi.route(), []);
  const types = useLeaveTypes(false);
  const org = useOrgOptions();
  const roles = useApi(() => api.get<{ id: number; name: string }[]>("/roles").catch(() => []), []);
  const [drafts, setDrafts] = useState<StepDraft[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (route.data) {
      setDrafts(route.data.map(stepToDraft));
      setDirty(false);
    }
  }, [route.data]);

  const update = (i: number, patch: Partial<StepDraft>) => {
    setDrafts((all) => (all ?? []).map((d, j) => (j === i ? { ...d, ...patch } : d)));
    setDirty(true);
    setProblem(null);
  };
  const move = (i: number, by: number) => {
    setDrafts((all) => {
      const next = [...(all ?? [])];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item);
      return next;
    });
    setDirty(true);
  };
  const save = async () => {
    if (!drafts) return;
    const built = draftsToSteps(drafts);
    if (!built.ok) return setProblem(built.error);
    setBusy(true);
    setError(null);
    try {
      const saved = await leaveAdminApi.saveRoute(built.steps);
      setDrafts(saved.map(stepToDraft));
      setDirty(false);
      toast.success(saved.length ? `Approval route saved (${saved.length} step(s))` : "Approval route cleared");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (route.error && !route.data) return <Card><ErrorState message={route.error.message} onRetry={() => void route.reload()} /></Card>;
  if (!drafts) return <Skeleton className="h-64 rounded-2xl" />;

  return (
    <Card className="space-y-4 p-4 sm:p-5" data-testid="approval-route">
      <p className="text-sm text-muted-foreground">
        Requests go through the steps in order. A step with conditions applies only to requests that match all of them;
        steps that do not apply are skipped. With no steps, the company administrators approve.
      </p>
      {!canWrite && <Notice tone="info" title="Read-only">The approval route is company-wide: changing it needs company-wide leave configuration access.</Notice>}
      {drafts.length === 0 && <EmptyState icon={<GitBranch />} title="No approval steps" description="Add the reporting manager as the first step for the usual route." className="py-8" />}
      <MotionSafe>
        <AnimatePresence initial={false}>
          {drafts.map((d, i) => (
            <motion.fieldset key={i} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
              disabled={!canWrite} className="space-y-4 rounded-2xl border border-border p-4" data-testid={`route-step-${i}`}>
              <legend className="flex items-center gap-2 px-1 text-sm font-semibold">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">{i + 1}</span> Step {i + 1}
              </legend>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Approver" className="w-56">
                  <Select value={d.approver_type} onChange={(e) => update(i, { approver_type: e.target.value as ApproverType, role_id: "" })} data-testid={`route-approver-${i}`}>
                    {APPROVERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </Field>
                {d.approver_type === "role" && (
                  <Field label="Role" className="w-56">
                    <Select value={d.role_id} onChange={(e) => update(i, { role_id: e.target.value })}>
                      <option value="">Choose a role</option>
                      {(roles.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </Select>
                  </Field>
                )}
                <Field label="Only from (days)" className="w-36" hint="Blank = every request">
                  <Input inputMode="numeric" value={d.min_days} onChange={(e) => update(i, { min_days: e.target.value })} />
                </Field>
                <Field label="Remind after (hours)" className="w-40" hint="Blank = company default">
                  <Input inputMode="numeric" value={d.sla_hours} onChange={(e) => update(i, { sla_hours: e.target.value })} />
                </Field>
                <span className="flex-1" />
                {canWrite && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" aria-label={`Move step ${i + 1} down`} disabled={i === drafts.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                    <Button variant="danger-ghost" size="icon" aria-label={`Remove step ${i + 1}`} onClick={() => { setDrafts(drafts.filter((_, j) => j !== i)); setDirty(true); }}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                )}
              </div>
              <details className="rounded-xl border border-border/70 bg-surface-muted/30 p-3" open={d.leave_type_codes.length + d.legal_entity_ids.length > 0 || !!d.min_units || !!d.max_units || !!d.sensitivity}>
                <summary className="cursor-pointer text-sm font-medium">Conditions</summary>
                <div className="mt-3 space-y-3">
                  <ChipToggleGroup label="Only these leave types (none = all)" value={d.leave_type_codes} disabled={!canWrite}
                    options={(types.data ?? []).map((t) => ({ value: t.code, label: t.name }))} onChange={(codes) => update(i, { leave_type_codes: codes })} />
                  <ChipToggleGroup label="Only these legal entities (none = all)" value={d.legal_entity_ids} disabled={!canWrite}
                    options={org.entities.map((o) => ({ value: o.id, label: o.label }))} onChange={(ids) => update(i, { legal_entity_ids: ids })} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Requests of at least (units)"><Input inputMode="decimal" value={d.min_units} onChange={(e) => update(i, { min_units: e.target.value })} /></Field>
                    <Field label="Requests of at most (units)"><Input inputMode="decimal" value={d.max_units} onChange={(e) => update(i, { max_units: e.target.value })} /></Field>
                    <Field label="Sensitivity">
                      <Select value={d.sensitivity} onChange={(e) => update(i, { sensitivity: e.target.value as StepDraft["sensitivity"] })}>
                        <option value="">Any</option>
                        <option value="STANDARD">Standard leave only</option>
                        <option value="SENSITIVE">Sensitive leave only</option>
                      </Select>
                    </Field>
                  </div>
                </div>
              </details>
            </motion.fieldset>
          ))}
        </AnimatePresence>
      </MotionSafe>
      {problem && <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm">{problem}</p>}
      <ErrorNotice error={error} />
      {canWrite && (
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" disabled={drafts.length >= 10} onClick={() => { setDrafts([...drafts, stepToDraft()]); setDirty(true); }} data-testid="route-add">
            <Plus className="h-4 w-4" /> Add step
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!dirty} data-testid="route-save"><Save className="h-4 w-4" /> Save route</Button>
        </div>
      )}
    </Card>
  );
}
