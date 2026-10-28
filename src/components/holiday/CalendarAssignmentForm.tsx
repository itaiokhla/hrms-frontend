"use client";

import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { calendarsApi, HolidayApiError, type Calendar, type CriteriaAssignment } from "@/lib/holiday/api";

interface Option {
  id: number;
  name: string;
  code?: string;
}

function items<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  const value = (body as { items?: T[] } | null)?.items;
  return Array.isArray(value) ? value : [];
}

function toggle(values: number[], id: number): number[] {
  return values.includes(id) ? values.filter((v) => v !== id) : [...values, id];
}

const FIELD_OF_CODE: Record<string, string> = {
  REASON_REQUIRED: "reason",
  BACKDATE_LIMIT: "effective_from",
  CALENDAR_ASSIGNMENT_CONFLICT: "priority",
  INVALID_PRIORITY: "priority",
  INVALID_CRITERIA: "criteria",
  INVALID_RANGE: "effective_to",
};

/**
 * Modal `calendar-assignment` (04-holiday/01 §4.3, §4.4; 09-ui-ux/02 §18 Assignments tab). Two kinds:
 * - **Branch** — the branch's effective-dated link (`PUT /branches/{id}/calendar-link`); earlier dates keep their calendar.
 * - **Group of people** — a criteria row (`/holiday-calendar-assignments`): branches, departments, shifts or hire dates,
 *   a priority (lower wins; equal priorities may not overlap) and a date range.
 * A backdated change needs the publish permission and a reason (the server decides; the form shows its answer).
 */
export function CalendarAssignmentForm({
  calendar,
  today,
  assignment,
  defaultMode = "branch",
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  calendar: Calendar;
  today: string;
  assignment?: CriteriaAssignment;
  defaultMode?: "branch" | "criteria";
  onSaved: () => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [mode, setMode] = useState<"branch" | "criteria">(assignment ? "criteria" : defaultMode);
  const branches = useApi(() => api.get<unknown>("/branches").then((b) => items<Option>(b)), []);
  const departments = useApi(() => api.get<unknown>("/departments").then((b) => items<Option>(b)).catch(() => [] as Option[]), []);
  const shifts = useApi(() => api.get<unknown>("/shifts").then((b) => items<Option>(b)).catch(() => [] as Option[]), []);
  const criteria = (assignment?.criteria ?? {}) as Record<string, unknown>;
  const [branchId, setBranchId] = useState("");
  const [branchIds, setBranchIds] = useState<number[]>((criteria.branch_ids as number[]) ?? []);
  const [departmentIds, setDepartmentIds] = useState<number[]>((criteria.department_ids as number[]) ?? []);
  const [shiftIds, setShiftIds] = useState<number[]>((criteria.shift_ids as number[]) ?? []);
  const [hiredAfter, setHiredAfter] = useState<string>((criteria.hired_on_or_after as string) ?? "");
  const [priority, setPriority] = useState(String(assignment?.priority ?? 100));
  const [from, setFrom] = useState(assignment?.effective_from ?? today);
  const [to, setTo] = useState(assignment?.effective_to ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const backdated = from < today;
  const dirty = () => onDirtyChange?.(true);

  const criteriaBody = useMemo(() => {
    const out: Record<string, unknown> = {};
    if (branchIds.length) out.branch_ids = branchIds;
    if (departmentIds.length) out.department_ids = departmentIds;
    if (shiftIds.length) out.shift_ids = shiftIds;
    if (hiredAfter) out.hired_on_or_after = hiredAfter;
    return out;
  }, [branchIds, departmentIds, shiftIds, hiredAfter]);

  const save = async () => {
    setErrors({});
    setFormError(null);
    if (mode === "branch" && !branchId) return setErrors({ branch: "Choose a branch." });
    if (mode === "criteria" && !Object.keys(criteriaBody).length) return setErrors({ criteria: "Choose at least one group." });
    if (backdated && !reason.trim()) return setErrors({ reason: "Give a reason for a backdated change." });
    setSaving(true);
    try {
      if (mode === "branch") {
        await calendarsApi.setBranchLink(Number(branchId), {
          holiday_calendar_id: calendar.id,
          effective_from: from,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        });
        toast.success(`Branch linked to ${calendar.code} from ${from}`);
      } else if (assignment) {
        await calendarsApi.updateAssignment(
          assignment.id,
          { criteria: criteriaBody, priority: Number(priority), effective_from: from, effective_to: to || null, ...(reason.trim() ? { reason: reason.trim() } : {}) },
          assignment.row_version,
        );
        toast.success("Assignment saved");
      } else {
        await calendarsApi.createAssignment({
          calendar_id: calendar.id,
          criteria: criteriaBody,
          priority: Number(priority),
          effective_from: from,
          ...(to ? { effective_to: to } : {}),
          ...(calendar.legal_entity_id ? { legal_entity_id: calendar.legal_entity_id } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        });
        toast.success("Assignment saved");
      }
      onDirtyChange?.(false);
      onSaved();
    } catch (e) {
      if (e instanceof HolidayApiError && e.code && FIELD_OF_CODE[e.code]) setErrors({ [FIELD_OF_CODE[e.code]]: e.message });
      else setFormError(e instanceof Error ? e.message : "Saving failed.");
    } finally {
      setSaving(false);
    }
  };

  const chips = (label: string, options: Option[] | undefined, values: number[], set: (v: number[]) => void, testid: string) => (
    <fieldset className="space-y-1.5" data-testid={testid}>
      <legend className="text-[13px] font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {(options ?? []).map((o) => (
          <label key={o.id} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-2.5 py-1 text-xs">
            <input
              type="checkbox"
              checked={values.includes(o.id)}
              onChange={() => {
                set(toggle(values, o.id));
                dirty();
              }}
            />
            {o.name}
          </label>
        ))}
        {!options?.length && <span className="text-xs text-muted-foreground">None</span>}
      </div>
    </fieldset>
  );

  return (
    <div className="space-y-5" data-testid="calendar-assignment-form">
      {!assignment && (
        <Segmented
          label="Applies to"
          value={mode}
          options={[
            { value: "branch", label: "A branch" },
            { value: "criteria", label: "A group of people" },
          ]}
          onChange={(m) => setMode(m)}
        />
      )}
      {mode === "branch" ? (
        <Field label="Branch" required error={errors.branch} hint="Employees of the branch follow this calendar from the date below; earlier dates keep their calendar.">
          <Select
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              dirty();
            }}
            data-testid="assignment-branch"
          >
            <option value="">Choose a branch…</option>
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.code ? ` (${b.code})` : ""}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <div className="space-y-4">
          {errors.criteria && <Notice tone="danger" title={errors.criteria} />}
          {chips("Branches", branches.data, branchIds, setBranchIds, "criteria-branches")}
          {chips("Departments", departments.data, departmentIds, setDepartmentIds, "criteria-departments")}
          {chips("Shifts", shifts.data, shiftIds, setShiftIds, "criteria-shifts")}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Joined on or after" hint="New joiners from this date (optional).">
              <Input type="date" value={hiredAfter} onChange={(e) => setHiredAfter(e.target.value)} />
            </Field>
            <Field label="Priority" required error={errors.priority} hint="1–999; the lowest number wins when rows overlap.">
              <Input type="number" min={1} max={999} value={priority} onChange={(e) => setPriority(e.target.value)} />
            </Field>
          </div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Effective from"
          required
          error={errors.effective_from}
          hint={backdated ? "Backdated: needs the publish permission and a reason." : "Earlier dates are not changed."}
        >
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="assignment-from" />
        </Field>
        {mode === "criteria" && (
          <Field label="Until" error={errors.effective_to} hint="Leave empty for no end.">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        )}
      </div>
      {(backdated || mode === "criteria") && (
        <Field label="Reason" required={backdated} error={errors.reason}>
          <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      {formError && <Notice tone="danger" title={formError} />}
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={saving} data-testid="assignment-save">
          {mode === "branch" ? "Link branch" : "Save assignment"}
        </Button>
      </div>
    </div>
  );
}
