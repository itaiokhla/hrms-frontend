"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/primitives";
import { useApi } from "@/lib/hooks";
import type { PolicyTypeMeta } from "@/lib/settings.generated";

import { fmtDay, grainNotice, localTodayISO } from "./model";
import { buildFields, draftFields, errorField, type FieldDraft } from "./policyFields";
import { PolicyFieldsForm } from "./PolicyFieldsForm";
import { policiesApi } from "./settingsApi";
import type { AssignmentCriteria, AssignmentRule, PolicyDetail, PolicyVersion, ScopeOptions } from "./types";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

/**
 * "Add policy" / "Edit" (3.8 §6, `?modal=policy&type=` / `&policy=`): saves a DRAFT version.
 * Drafts never change pay; activating a version is a separate, dated step.
 */
export function PolicyModal({
  open,
  onClose,
  type,
  policyId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  type: PolicyTypeMeta;
  policyId: number | null;
  onSaved: () => void;
}) {
  const editing = policyId !== null;
  const detail = useApi(() => policiesApi.get(policyId as number), [policyId], { enabled: open && editing });
  const policy = detail.data && detail.data.id === policyId ? detail.data : undefined;
  const draftVersion: PolicyVersion | undefined = policy?.versions?.filter((v) => v.status === "DRAFT").sort((a, b) => b.version - a.version)[0];
  const baseVersion = draftVersion ?? policy?.active_version ?? policy?.versions?.[policy.versions.length - 1];

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(localTodayISO());
  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setFormError(null);
    if (!editing) {
      setName("");
      setDescription("");
      setEffectiveFrom(localTodayISO());
      setDrafts(draftFields(type.fields, null));
    } else if (policy) {
      setName(policy.name);
      setDescription(policy.description ?? "");
      setEffectiveFrom(draftVersion?.effective_from ?? localTodayISO());
      setDrafts(draftFields(type.fields, baseVersion?.fields));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, policy?.id, draftVersion?.version, type.code]);

  const save = async () => {
    const built = buildFields(type.fields, drafts);
    if (!built.ok) {
      setErrors(built.errors);
      setFormError("Some fields need attention.");
      return;
    }
    if (!editing && !name.trim()) {
      setErrors({ __name: "Give the policy a name." });
      return;
    }
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      if (!editing) {
        await policiesApi.create({ type: type.code, name: name.trim(), description: description.trim() || null, fields: built.value, effective_from: effectiveFrom });
        toast.success("Policy saved as a draft. Activate it when it's ready.");
      } else if (draftVersion) {
        await policiesApi.updateVersion(policyId as number, draftVersion.version, { fields: built.value, effective_from: effectiveFrom });
        toast.success(`Draft version ${draftVersion.version} saved`);
      } else {
        const created = await policiesApi.createVersion(policyId as number, { fields: built.value, effective_from: effectiveFrom });
        toast.success(`Draft version ${created.version} saved. Activate it when it's ready.`);
      }
      onSaved();
      onClose();
    } catch (error) {
      const field = errorField(error);
      if (field && type.fields.some((f) => f.name === field)) setErrors({ [field]: messageOf(error) });
      setFormError(messageOf(error));
    } finally {
      setSaving(false);
    }
  };

  const title = editing ? `Edit ${policy?.name ?? "policy"}` : `Add ${type.label.toLowerCase()}`;
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={
        editing
          ? draftVersion
            ? `You're editing draft version ${draftVersion.version}. Pay doesn't change until a version is activated.`
            : "Saving creates a new draft version. The active version stays in force until you activate the draft."
          : "New policies start as a draft and change nobody's pay until activated."
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="policy-form" loading={saving} disabled={editing && !policy}>
            Save draft
          </Button>
        </>
      }
    >
      {editing && detail.error ? (
        <ErrorState message={detail.error.message} onRetry={detail.reload} />
      ) : editing && !policy ? (
        <div className="space-y-3">
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : (
        <form
          id="policy-form"
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          noValidate
        >
          {formError && (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-foreground">
              {formError}
            </p>
          )}
          {!editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required error={errors.__name}>
                <Input value={name} maxLength={150} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Description">
                <Textarea value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} className="min-h-[40px]" />
              </Field>
            </div>
          )}
          <Field label="Effective from" hint={`${grainNotice(type.grain, effectiveFrom)} once activated.`}>
            <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="max-w-[12rem]" />
          </Field>
          <PolicyFieldsForm fields={type.fields} drafts={drafts} onChange={(n, v) => setDrafts((d) => ({ ...d, [n]: v }))} errors={errors} />
        </form>
      )}
    </Modal>
  );
}

/** Activate a draft version from a date; back-dated activation needs a reason (server rule). */
export function ActivateModal({
  open,
  onClose,
  policy,
  version,
  type,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  policy: { id: number; name: string } | null;
  version: number | null;
  type: PolicyTypeMeta;
  onDone: () => void;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(localTodayISO());
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setEffectiveFrom(localTodayISO());
      setReason("");
      setError(null);
    }
  }, [open]);
  const past = effectiveFrom < localTodayISO();
  const submit = async () => {
    if (!policy || version === null) return;
    if (past && !reason.trim()) {
      setError("A reason is required for a version effective in the past.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await policiesApi.activate(policy.id, version, { effective_from: effectiveFrom, reason: reason.trim() || undefined });
      toast.success(result.message ? `Version ${version} activated. ${result.message}` : `Version ${version} activated`);
      onDone();
      onClose();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={`Activate version ${version ?? ""} of ${policy?.name ?? "this policy"}?`}
      description="The version it replaces ends the day before. Pay runs that are not finalized are marked for recalculation."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={submit}>
            Activate
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-foreground">
            {error}
          </p>
        )}
        <Field label="Effective from" hint={`${grainNotice(type.grain, effectiveFrom)}.`}>
          <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="max-w-[12rem]" />
        </Field>
        <Field label="Reason" required={past} hint={past ? `Back-dated to ${fmtDay(effectiveFrom)}: say why.` : "Recorded in the audit log."}>
          <Textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ assignment rules */

const ID_DIMENSIONS: { key: keyof AssignmentCriteria; label: string }[] = [
  { key: "department_ids", label: "Department ids" },
  { key: "grade_ids", label: "Grade ids" },
  { key: "designation_ids", label: "Designation ids" },
  { key: "employee_ids", label: "Employee ids" },
];

interface RuleDraft {
  everyone: boolean;
  legal_entity_ids: number[];
  branch_ids: number[];
  pay_group_ids: number[];
  ids: Record<string, string>;
  employment_types: string;
  priority: string;
  effective_from: string;
  effective_to: string;
}

function ruleToDraft(rule: AssignmentRule | null): RuleDraft {
  const c = rule?.criteria ?? { everyone: true };
  return {
    everyone: c.everyone === true || !rule,
    legal_entity_ids: c.legal_entity_ids ?? [],
    branch_ids: c.branch_ids ?? [],
    pay_group_ids: c.pay_group_ids ?? [],
    ids: Object.fromEntries(ID_DIMENSIONS.map((d) => [d.key, ((c[d.key] as number[] | undefined) ?? []).join(", ")])),
    employment_types: (c.employment_types ?? []).join(", "),
    priority: String(rule?.priority ?? 0),
    effective_from: rule?.effective_from ?? localTodayISO(),
    effective_to: rule?.effective_to ?? "",
  };
}

/** Rule drafts → API rules, or the first problem found. */
export function draftsToRules(drafts: RuleDraft[]): { ok: true; rules: Omit<AssignmentRule, "id" | "status">[] } | { ok: false; error: string } {
  const rules: Omit<AssignmentRule, "id" | "status">[] = [];
  for (let index = 0; index < drafts.length; index++) {
    const d = drafts[index];
    const n = index + 1;
    if (!/^\d+$/.test(d.priority.trim())) return { ok: false, error: `Rule ${n}: the priority must be a whole number.` };
    const criteria: AssignmentCriteria = {};
    if (!d.everyone) {
      if (d.legal_entity_ids.length) criteria.legal_entity_ids = d.legal_entity_ids;
      if (d.branch_ids.length) criteria.branch_ids = d.branch_ids;
      if (d.pay_group_ids.length) criteria.pay_group_ids = d.pay_group_ids;
      for (const dim of ID_DIMENSIONS) {
        const text = d.ids[dim.key as string]?.trim();
        if (!text) continue;
        const ids = text.split(/[\s,]+/).filter(Boolean);
        if (ids.some((x) => !/^\d+$/.test(x))) return { ok: false, error: `Rule ${n}: ${dim.label.toLowerCase()} must be numbers.` };
        (criteria as Record<string, number[]>)[dim.key as string] = ids.map(Number);
      }
      const types = d.employment_types.split(/[\s,]+/).filter(Boolean);
      if (types.length) criteria.employment_types = types;
      if (!Object.keys(criteria).length) return { ok: false, error: `Rule ${n}: choose who it covers, or "Everyone".` };
    } else {
      criteria.everyone = true;
    }
    if (d.effective_to && d.effective_to < d.effective_from) return { ok: false, error: `Rule ${n}: the end date is before the start date.` };
    rules.push({ criteria, priority: Number(d.priority), effective_from: d.effective_from || null, effective_to: d.effective_to || null });
  }
  return { ok: true, rules };
}

function Chips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: number; name: string }[];
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  if (!options.length) return null;
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.id} className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-border px-3 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={value.includes(o.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))}
            />
            {o.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Assignment rules (`?modal=rules&policy=`): who a policy covers and with which priority. The server
 * rejects ambiguous rule sets (two rules of the same priority covering one employee).
 */
export function AssignmentRulesModal({
  open,
  onClose,
  policy,
  scopeOptions,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  policy: Pick<PolicyDetail, "id" | "name"> | null;
  scopeOptions: ScopeOptions;
  onSaved: () => void;
}) {
  const current = useApi(() => policiesApi.assignments(policy!.id), [policy?.id], { enabled: open && !!policy });
  const [drafts, setDrafts] = useState<RuleDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loaded = current.data && current.data.policy_id === policy?.id ? current.data : undefined;
  useEffect(() => {
    if (open && loaded) setDrafts(loaded.rules.length ? loaded.rules.map(ruleToDraft) : [ruleToDraft(null)]);
    if (open) setError(null);
  }, [open, loaded]);
  const update = (index: number, patch: Partial<RuleDraft>) => setDrafts((all) => all.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  const entities = useMemo(() => scopeOptions.entities, [scopeOptions.entities]);

  const save = async () => {
    if (!policy) return;
    const built = draftsToRules(drafts);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await policiesApi.putAssignments(policy.id, built.rules);
      toast.success("Assignment rules saved");
      onSaved();
      onClose();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={`Who ${policy?.name ?? "this policy"} covers`}
      description="Every condition of a rule must match. When several policies match an employee, the higher priority wins; equal priorities are rejected as ambiguous."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!loaded} onClick={save}>
            Save rules
          </Button>
        </>
      }
    >
      {current.error ? (
        <ErrorState message={current.error.message} onRetry={current.reload} />
      ) : !loaded ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : (
        <div className="space-y-4">
          {error && (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-foreground">
              {error}
            </p>
          )}
          {drafts.map((d, index) => (
            <fieldset key={index} className="space-y-4 rounded-2xl border border-border p-4">
              <legend className="px-1 text-sm font-semibold">Rule {index + 1}</legend>
              <div className="flex flex-wrap items-end gap-3">
                <label className="inline-flex min-h-[40px] items-center gap-2 text-sm font-medium">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={d.everyone} onChange={(e) => update(index, { everyone: e.target.checked })} />
                  Everyone
                </label>
                <Field label="Priority" className="w-28">
                  <Input inputMode="numeric" value={d.priority} onChange={(e) => update(index, { priority: e.target.value })} />
                </Field>
                <Field label="From" className="w-44">
                  <Input type="date" value={d.effective_from} onChange={(e) => update(index, { effective_from: e.target.value })} />
                </Field>
                <Field label="Until (optional)" className="w-44">
                  <Input type="date" value={d.effective_to} onChange={(e) => update(index, { effective_to: e.target.value })} />
                </Field>
                <span className="flex-1" />
                {drafts.length > 1 && (
                  <Button variant="danger-ghost" size="icon" aria-label={`Remove rule ${index + 1}`} onClick={() => setDrafts((all) => all.filter((_, i) => i !== index))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {!d.everyone && (
                <div className="space-y-4">
                  <Chips label="Legal entities" options={entities} value={d.legal_entity_ids} onChange={(ids) => update(index, { legal_entity_ids: ids })} />
                  <Chips label="Branches" options={scopeOptions.branches} value={d.branch_ids} onChange={(ids) => update(index, { branch_ids: ids })} />
                  <Chips label="Pay groups" options={scopeOptions.payGroups} value={d.pay_group_ids} onChange={(ids) => update(index, { pay_group_ids: ids })} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    {ID_DIMENSIONS.map((dim) => (
                      <Field key={dim.key} label={dim.label} hint="Comma-separated">
                        <Input
                          dir="ltr"
                          value={d.ids[dim.key as string] ?? ""}
                          onChange={(e) => update(index, { ids: { ...d.ids, [dim.key as string]: e.target.value } })}
                        />
                      </Field>
                    ))}
                    <Field label="Employment types" hint="Codes, comma-separated">
                      <Input dir="ltr" value={d.employment_types} onChange={(e) => update(index, { employment_types: e.target.value })} />
                    </Field>
                  </div>
                </div>
              )}
            </fieldset>
          ))}
          <Button variant="secondary" onClick={() => setDrafts((all) => [...all, { ...ruleToDraft(null), everyone: false }])}>
            <Plus className="h-4 w-4" /> Add rule
          </Button>
        </div>
      )}
    </Modal>
  );
}
