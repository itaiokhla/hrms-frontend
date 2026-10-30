"use client";

import { Lock, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { LeaveAdminError, leaveAdminApi } from "@/lib/leave/adminApi";
import {
  ABSENCE_CLASS_LABEL,
  CATEGORY_LABEL,
  KIND_LABEL,
  LEAVE_CATEGORIES,
  LEAVE_ICONS,
  type AbsenceClass,
  type LeaveCategory,
  type LeaveKind,
  type LeaveTypeV2,
  type LeaveTypeWrite,
  type Sensitivity,
} from "@/lib/leave/adminTypes";
import { LEAVE_COLOR_TOKENS, leaveColor } from "@/lib/leave/colors";

/** The twelve type colours (`leave-neutral` is reserved for masked leave). */
const TYPE_COLOR_TOKENS = LEAVE_COLOR_TOKENS.filter((t) => t !== "leave-neutral");

import { ErrorNotice, TypedConfirm } from "./shared";

export const TYPE_MODAL = "leave-type";

const CODE_RE = /^[a-z][a-z0-9_]*$/;
const ICON_RE = /^[a-z0-9-]+$/;

/** Category defaults of the server (`CATEGORY_DEFAULTS`): sensitivity and absence class. */
const CATEGORY_DEFAULTS: Record<LeaveCategory, [Sensitivity, AbsenceClass, string]> = {
  ANNUAL: ["STANDARD", "PLANNED", "sun"], CASUAL: ["STANDARD", "PLANNED", "coffee"],
  SICK: ["SENSITIVE", "PROTECTED", "heart-pulse"], PARENTAL: ["STANDARD", "STATUTORY", "baby"],
  BEREAVEMENT: ["SENSITIVE", "PROTECTED", "flower-2"], MARRIAGE: ["STANDARD", "PLANNED", "gem"],
  STUDY: ["STANDARD", "PLANNED", "graduation-cap"], CIVIC: ["STANDARD", "STATUTORY", "landmark"],
  SABBATICAL: ["STANDARD", "PLANNED", "plane"], COMP_OFF: ["STANDARD", "PLANNED", "rotate-ccw"],
  FLOATING: ["STANDARD", "PLANNED", "calendar-plus"], UNPAID: ["STANDARD", "UNPLANNED", "calendar-x"],
  OTHER: ["STANDARD", "PLANNED", "tag"],
};

export interface TypeForm {
  code: string;
  name: string;
  description: string;
  kind: LeaveKind | "";
  category: LeaveCategory;
  unit: "DAY" | "HOUR";
  sensitivity: Sensitivity;
  absence_class: AbsenceClass;
  counts_toward_absence_score: boolean;
  is_paid: boolean;
  is_unlimited: boolean;
  is_active: boolean;
  counts_non_working_days: boolean;
  allow_half_day: boolean;
  color_token: string;
  icon: string;
  display_order: string;
  annual_quota: string;
  translations: { locale: string; name: string }[];
}

export function formOf(type?: LeaveTypeV2 | null): TypeForm {
  return {
    code: type?.code ?? "",
    name: type?.name ?? "",
    description: type?.description ?? "",
    kind: type?.kind ?? "",
    category: type?.category ?? "OTHER",
    unit: type?.unit ?? "DAY",
    sensitivity: type?.sensitivity ?? "STANDARD",
    absence_class: type?.absence_class ?? "PLANNED",
    counts_toward_absence_score: type?.counts_toward_absence_score ?? false,
    is_paid: type?.is_paid ?? true,
    is_unlimited: type?.is_unlimited ?? false,
    is_active: type?.is_active ?? true,
    counts_non_working_days: type?.counts_non_working_days ?? false,
    allow_half_day: type?.allow_half_day ?? true,
    color_token: type?.color_token ?? "",
    icon: type?.icon ?? "",
    display_order: String(type?.display_order ?? 100),
    annual_quota: String(type?.annual_quota ?? 0),
    translations: Object.entries(type?.name_i18n ?? {}).map(([locale, name]) => ({ locale, name })),
  };
}

/** The `LeaveTypeWriteV2` body (every field; the server keeps nothing implicit on PUT). */
export function bodyOf(form: TypeForm, confirm?: { reason: string; code: string }): LeaveTypeWrite {
  const statutory = form.absence_class === "STATUTORY" || form.absence_class === "PROTECTED";
  return {
    code: form.code.trim(),
    name: form.name.trim(),
    description: form.description.trim() || null,
    kind: form.kind || null,
    category: form.category,
    unit: form.unit,
    sensitivity: form.sensitivity,
    absence_class: form.absence_class,
    counts_toward_absence_score: statutory ? false : form.counts_toward_absence_score,
    is_paid: form.category === "UNPAID" ? false : form.is_paid,
    is_unlimited: form.kind === "COMP_OFF" || form.kind === "EVENT" ? false : form.is_unlimited,
    is_active: form.is_active,
    counts_non_working_days: form.counts_non_working_days,
    allow_half_day: form.allow_half_day,
    color_token: form.color_token || null,
    icon: form.icon.trim() || null,
    display_order: Number(form.display_order),
    name_i18n: Object.fromEntries(form.translations.filter((t) => t.locale.trim() && t.name.trim()).map((t) => [t.locale.trim(), t.name.trim()])),
    annual_quota: Number(form.annual_quota),
    ...(confirm ? { reason: confirm.reason.trim(), confirm_code: confirm.code.trim() } : {}),
  };
}

export function validateTypeForm(form: TypeForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = "Enter a name.";
  else if (form.name.trim().length > 100) errors.name = "At most 100 characters.";
  const code = form.code.trim();
  if (code.length < 2 || code.length > 30 || !CODE_RE.test(code)) errors.code = "2–30 lower-case letters, digits or _, starting with a letter.";
  const order = Number(form.display_order);
  if (!/^\d+$/.test(form.display_order.trim()) || order > 10000) errors.display_order = "A whole number from 0 to 10,000.";
  const quota = Number(form.annual_quota);
  if (!/^\d+$/.test(form.annual_quota.trim()) || quota > 366) errors.annual_quota = "A whole number from 0 to 366.";
  if (form.icon.trim() && (!ICON_RE.test(form.icon.trim()) || form.icon.trim().length > 40)) errors.icon = "Lower-case letters, digits and dashes.";
  if (form.kind === "COMP_OFF" && form.category !== "COMP_OFF") errors.category = "A comp-off type has the Comp-off category.";
  if (form.kind === "FLOATING_HOLIDAY" && form.category !== "FLOATING") errors.category = "A floating-holiday type has the Floating holiday category.";
  if (form.kind === "EVENT" && form.unit === "HOUR") errors.unit = "Event leave is counted in days.";
  return errors;
}

const FIELD_OF_CODE: Record<string, string> = {
  LEAVE_TYPE_CODE_FROZEN: "code",
  CONFLICT: "code",
  HOURLY_DISABLED: "unit",
  CONFIRMATION_REQUIRED: "confirm",
};

/**
 * The `leave-type` form (03-leave/01 §11.3): every `LeaveTypeWriteV2` field, usage from `GET /leaves/v2/types/{id}`,
 * frozen fields (code, kind, unit, unlimited) once the type is in use, `If-Match: row_version` on save and a typed
 * confirmation when a sensitive type becomes standard.
 */
export function LeaveTypeEditor({
  typeId,
  canWrite = true,
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  typeId?: number | null;
  canWrite?: boolean;
  onSaved: (type: LeaveTypeV2) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [type, setType] = useState<LeaveTypeV2 | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(!!typeId);
  const [form, setForm] = useState<TypeForm>(() => formOf(null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [lowerReason, setLowerReason] = useState("");
  const [lowerCode, setLowerCode] = useState("");

  const load = async () => {
    if (!typeId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const fresh = await leaveAdminApi.type(typeId);
      setType(fresh);
      setForm(formOf(fresh));
      setError(null);
      onDirtyChange?.(false);
    } catch (e) {
      setLoadError(e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeId]);

  const inUse = !!type?.usage?.in_use;
  const lowering = type?.sensitivity === "SENSITIVE" && form.sensitivity === "STANDARD";
  const statutory = form.absence_class === "STATUTORY" || form.absence_class === "PROTECTED";
  const readOnly = !canWrite;

  const set = (patch: Partial<TypeForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors({});
    onDirtyChange?.(true);
  };
  const setKind = (kind: TypeForm["kind"]) => {
    const patch: Partial<TypeForm> = { kind };
    if (kind === "COMP_OFF") patch.category = "COMP_OFF";
    if (kind === "FLOATING_HOLIDAY") patch.category = "FLOATING";
    if (kind === "COMP_OFF" || kind === "EVENT") patch.is_unlimited = false;
    if (kind === "EVENT") patch.unit = "DAY";
    set(patch);
  };
  const setCategory = (category: LeaveCategory) => {
    const [sensitivity, absence, icon] = CATEGORY_DEFAULTS[category];
    const patch: Partial<TypeForm> = { category };
    if (!type) {
      patch.sensitivity = sensitivity;
      patch.absence_class = absence;
      if (!form.icon) patch.icon = icon;
      patch.counts_toward_absence_score = absence === "UNPLANNED";
    }
    if (category === "UNPAID") patch.is_paid = false;
    set(patch);
  };

  const usageText = useMemo(() => {
    const u = type?.usage;
    if (!u) return null;
    const parts = [
      u.leaves && `${u.leaves} request(s)`,
      u.ledger_rows && `${u.ledger_rows} ledger row(s)`,
      u.plans.length && `${u.plans.length} plan(s)`,
      u.events && `${u.events} event(s)`,
      u.claims && `${u.claims} comp-off claim(s)`,
      u.encashments && `${u.encashments} encashment(s)`,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Not used yet";
  }, [type]);

  const save = async () => {
    const found = validateTypeForm(form);
    if (lowering) {
      if (lowerReason.trim().length < 10) found.reason = "Give a reason of at least 10 characters.";
      if (lowerCode.trim() !== type?.code) found.confirm = `Type the code ${type?.code} exactly.`;
    }
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    setError(null);
    try {
      const body = bodyOf(form, lowering ? { reason: lowerReason, code: lowerCode } : undefined);
      const saved = type ? await leaveAdminApi.updateType(type.id, body, type.row_version) : await leaveAdminApi.createType(body);
      toast.success(`Leave type ${saved.name} saved`);
      onDirtyChange?.(false);
      onSaved(saved);
    } catch (e) {
      const code = e instanceof LeaveAdminError ? e.code : undefined;
      if (code && FIELD_OF_CODE[code] && code !== "CONFLICT") setErrors({ [FIELD_OF_CODE[code]]: (e as Error).message });
      else if (code === "CONFLICT" && /code/i.test((e as Error).message)) setErrors({ code: (e as Error).message });
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  if (typeId && loading && !type) return <Skeleton className="h-96 rounded-2xl" />;
  if (loadError && !type) return <ErrorNotice error={loadError} title="Couldn't load this leave type" />;

  const conflict = error instanceof LeaveAdminError && error.code === "ROW_VERSION_CONFLICT";
  const frozenHint = inUse ? `In use (${usageText}) — cannot change.` : undefined;
  const lock = (on: boolean) => (on ? <Lock className="ms-1 inline h-3 w-3 text-muted-foreground" aria-label="Locked" /> : null);

  return (
    <div className="space-y-5" data-testid="leave-type-form">
      {type && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-muted/50 px-3 py-2 text-xs" data-testid="type-usage">
          <Badge tone={inUse ? "warning" : "neutral"} dot>{inUse ? "In use" : "Not in use"}</Badge>
          <span className="text-muted-foreground">{usageText}</span>
          {type.usage?.pending_requests ? <span className="text-muted-foreground">· {type.usage.pending_requests} pending</span> : null}
          {type.usage?.employees_with_balance ? <span className="text-muted-foreground">· {type.usage.employees_with_balance} people hold a balance</span> : null}
          {!!type.usage?.plans.length && (
            <span className="text-muted-foreground">· Plans: {type.usage.plans.map((p) => p.name).join(", ")}</span>
          )}
        </div>
      )}
      {inUse && (
        <Notice tone="info" title="Code, kind, unit and “unlimited” are locked">
          This type has history. To change them, create a new type and move the plans to it; deactivate this one instead of deleting it.
        </Notice>
      )}
      {conflict && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
          <span>Someone changed this type. Reload to see their changes.</span>
          <Button size="sm" variant="secondary" onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Reload</Button>
        </div>
      )}

      <fieldset disabled={readOnly} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={errors.name}>
            <Input value={form.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} data-testid="type-name" />
          </Field>
          <Field label="Code" required error={errors.code} hint={frozenHint ?? "Lower-case, e.g. earned or sick_leave."}>
            <Input
              value={form.code}
              maxLength={30}
              disabled={inUse}
              className="font-mono"
              onChange={(e) => set({ code: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
              data-testid="type-code"
            />
          </Field>
          <Field label="Kind" hint={inUse ? "Locked: in use." : "Comp-off, floating holiday and event types behave differently."} error={errors.kind}>
            <Select value={form.kind} disabled={inUse} onChange={(e) => setKind(e.target.value as TypeForm["kind"])} data-testid="type-kind">
              {Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Category" error={errors.category} hint={type && form.category !== type.category ? "Reports will reclassify this type's history." : undefined}>
            <Select value={form.category} disabled={form.kind === "COMP_OFF" || form.kind === "FLOATING_HOLIDAY"}
              onChange={(e) => setCategory(e.target.value as LeaveCategory)} data-testid="type-category">
              {LEAVE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Segmented label="Unit" value={form.unit} disabled={inUse || form.kind === "EVENT" || readOnly}
              options={[{ value: "DAY", label: "Days" }, { value: "HOUR", label: "Hours" }]} onChange={(unit) => set({ unit })} />
            <p className={cn("mt-1 text-xs", errors.unit ? "font-medium text-danger" : "text-muted-foreground")}>
              {errors.unit ?? (inUse ? "Locked: in use." : "Hours need “Hourly leave” turned on in Leave settings.")}
            </p>
          </div>
          <div>
            <Segmented label="Default counting" value={form.counts_non_working_days ? "CAL" : "WORK"} disabled={readOnly}
              options={[{ value: "WORK", label: "Working days" }, { value: "CAL", label: "Calendar days" }]}
              onChange={(v) => set({ counts_non_working_days: v === "CAL" })} />
            <p className="mt-1 text-xs text-muted-foreground">Plans can override the counting basis per type.</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ToggleRow label={<>Unlimited{lock(inUse)}</>} hint={inUse ? "Locked: in use." : "No balance is kept (e.g. unpaid leave)."}
            checked={form.is_unlimited} disabled={inUse || form.kind === "COMP_OFF" || form.kind === "EVENT"} onChange={(v) => set({ is_unlimited: v })} testId="type-unlimited" />
          <ToggleRow label="Paid" hint={form.category === "UNPAID" ? "Unpaid leave is never paid." : "Display only: pay comes from Payroll › Leave pay."}
            checked={form.category === "UNPAID" ? false : form.is_paid} disabled={form.category === "UNPAID"} onChange={(v) => set({ is_paid: v })} />
          <ToggleRow label="Half days allowed" hint="Requests may start or end with half a day." checked={form.allow_half_day} onChange={(v) => set({ allow_half_day: v })} />
          <ToggleRow label="Active" hint="Inactive types cannot be requested; balances stay." checked={form.is_active} onChange={(v) => set({ is_active: v })} testId="type-active" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Segmented label="Privacy" value={form.sensitivity} disabled={readOnly}
              options={[{ value: "STANDARD", label: "Standard" }, { value: "SENSITIVE", label: "Sensitive" }]} onChange={(sensitivity) => set({ sensitivity })} />
            <p className="mt-1 text-xs text-muted-foreground">Colleagues see sensitive leave only as “Away”; reports suppress small groups.</p>
          </div>
          <Field label="Absence class">
            <Select value={form.absence_class} onChange={(e) => set({ absence_class: e.target.value as AbsenceClass })} data-testid="type-absence-class">
              {(Object.keys(ABSENCE_CLASS_LABEL) as AbsenceClass[]).map((c) => <option key={c} value={c}>{ABSENCE_CLASS_LABEL[c]}</option>)}
            </Select>
          </Field>
          <ToggleRow label="Counts toward absence score" hint={statutory ? "Statutory and protected leave never counts." : "Used by Bradford-style absence scores."}
            checked={statutory ? false : form.counts_toward_absence_score} disabled={statutory} onChange={(v) => set({ counts_toward_absence_score: v })} />
        </div>

        {lowering && (
          <div className="space-y-3 rounded-2xl border border-warning/40 bg-warning-soft/60 p-4" data-testid="lower-sensitivity">
            <p className="text-sm font-medium">Making a sensitive type standard shows its future requests to colleagues by name.</p>
            <Field label="Reason" required error={errors.reason} hint="At least 10 characters; kept in the audit trail.">
              <Textarea rows={2} maxLength={500} value={lowerReason} onChange={(e) => { setLowerReason(e.target.value); setErrors({}); }} data-testid="lower-reason" />
            </Field>
            <TypedConfirm expected={type?.code ?? ""} value={lowerCode} onChange={(v) => { setLowerCode(v); setErrors({}); }} caseSensitive testId="lower-confirm" />
            {errors.confirm && <p className="text-xs font-medium text-danger" role="alert">{errors.confirm}</p>}
          </div>
        )}

        <fieldset className="space-y-1.5">
          <legend className="text-[13px] font-medium">Colour</legend>
          <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
            {TYPE_COLOR_TOKENS.map((token, i) => (
              <button key={token} type="button" role="radio" aria-checked={form.color_token === token} aria-label={`Colour ${i + 1}`}
                onClick={() => set({ color_token: token })}
                className={cn("h-7 w-7 rounded-full border-2 transition-transform hover:scale-110", form.color_token === token ? "border-foreground ring-2 ring-primary/40" : "border-transparent")}
                style={{ backgroundColor: leaveColor(token) }} />
            ))}
          </div>
          {!form.color_token && <p className="text-xs text-muted-foreground">None chosen: the next free colour is used.</p>}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Icon" error={errors.icon} hint="Blank = the category's icon.">
            <Select value={LEAVE_ICONS.includes(form.icon as (typeof LEAVE_ICONS)[number]) || !form.icon ? form.icon : "__custom"}
              onChange={(e) => set({ icon: e.target.value === "__custom" ? form.icon : e.target.value })}>
              <option value="">Category default</option>
              {LEAVE_ICONS.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
              {form.icon && !LEAVE_ICONS.includes(form.icon as (typeof LEAVE_ICONS)[number]) && <option value="__custom">{form.icon}</option>}
            </Select>
          </Field>
          <Field label="Display order" error={errors.display_order} hint="Lower first (0–10,000).">
            <Input inputMode="numeric" value={form.display_order} onChange={(e) => set({ display_order: e.target.value })} data-testid="type-order" />
          </Field>
          <Field label="Legacy yearly quota" error={errors.annual_quota} hint="Used while the company is on legacy leave and for the Default plan.">
            <Input inputMode="numeric" value={form.annual_quota} onChange={(e) => set({ annual_quota: e.target.value })} />
          </Field>
        </div>

        <Field label="Description">
          <Textarea rows={2} maxLength={2000} value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium">Translated names</legend>
          {form.translations.map((t, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field label="Locale" className="w-28">
                <Input value={t.locale} maxLength={20} placeholder="hi-IN" onChange={(e) => set({ translations: form.translations.map((x, j) => (j === i ? { ...x, locale: e.target.value } : x)) })} />
              </Field>
              <Field label="Name" className="flex-1">
                <Input value={t.name} maxLength={100} onChange={(e) => set({ translations: form.translations.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              </Field>
              <Button variant="danger-ghost" size="icon" aria-label={`Remove translation ${i + 1}`} onClick={() => set({ translations: form.translations.filter((_, j) => j !== i) })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => set({ translations: [...form.translations, { locale: "", name: "" }] })}>
            <Plus className="h-4 w-4" /> Add translation
          </Button>
        </fieldset>
      </fieldset>

      {!conflict && <ErrorNotice error={error} />}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        {canWrite && (
          <Button onClick={() => void save()} loading={saving} data-testid="type-save">
            {type ? "Save" : "Create leave type"}
          </Button>
        )}
      </div>
    </div>
  );
}

function ToggleRow({ label, hint, checked, disabled, onChange, testId }: {
  label: ReactNode;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2.5" data-testid={testId}>
      <div className="min-w-0">
        <p id={id} className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} aria-labelledby={id} />
    </div>
  );
}
