"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { useCan } from "@/components/access/Can";
import type { FormRenderProps } from "@/components/shared/FormHost";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { ShiftDetail } from "@/lib/types";

import { SHIFT_ERROR_TEXT, ShiftApiError, shiftFieldErrors, shiftsApi } from "./api";
import { ShiftChip } from "./ShiftChip";
import {
  BREAK_KINDS, BREAK_MODES, COLOR_TOKENS, SHIFT_KINDS, colorOf, crossesMidnight, defaultValues, emptyBreak, fmtMinutes,
  isClock, kindLabel, previewMinutes, todayIn, toVersionBody, validateShift, type ShiftFormValues, type ShiftSection,
} from "./shiftModel";

/* ------------------------------------------------------------------ lookups */

interface Named { id: number; name?: string; legal_name?: string; trade_name?: string | null; code?: string }

/** Branches and legal entities for the owner picker (best effort: no org:read → only "Whole company"). */
function useOwners(enabled: boolean) {
  const [entities, setEntities] = useState<Named[]>([]);
  const [branches, setBranches] = useState<Named[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api.get<Named[]>("/legal-entities").then((r) => live && setEntities(r)).catch(() => undefined);
    api.get<Named[]>("/branches").then((r) => live && setBranches(r)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [enabled]);
  return { entities, branches };
}

/** The refusal above the form: the code's plain wording, else the server message. */
export function ShiftErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const code = error instanceof ShiftApiError ? error.code : undefined;
  const message = (code && SHIFT_ERROR_TEXT[code]) || (error instanceof Error ? error.message : "Something went wrong.");
  return (
    <div role="alert" className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm" data-code={code}>
      <p className="font-medium text-danger">{message}</p>
      {error instanceof ShiftApiError && error.issues.length > 1 && (
        <ul className="mt-1 list-disc ps-5 text-muted-foreground">
          {error.issues.map((i, n) => <li key={n}>{i.message ?? i.code}</li>)}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ fields */

const groupTitle = "border-b border-border pb-1 text-sm font-semibold";

/**
 * The fields of `ShiftForm` (03-shifts/01 §17.3), controlled. `section` picks the groups: create = Basics + Times +
 * Breaks + Advanced + Effective from; catalogue = Basics only (code and kind read-only); version = everything but
 * Basics, plus "Temporary — ends on". Kind-dependent: FIXED start/end (+1 chip, 24-hour duty confirmation),
 * FLEXIBLE band + core + expected work, OPEN expected work only, SPLIT 2–4 blocks.
 */
export function ShiftFields({ values, onChange, errors, section, owners }: {
  values: ShiftFormValues;
  onChange: (next: ShiftFormValues) => void;
  errors: Record<string, string>;
  section: ShiftSection;
  owners?: { entities: Named[]; branches: Named[] };
}) {
  const set = <K extends keyof ShiftFormValues>(key: K, value: ShiftFormValues[K]) => onChange({ ...values, [key]: value });
  const { kind } = values;
  const timed = kind !== "OPEN";
  const sameTimes = isClock(values.start_time) && isClock(values.end_time) && values.start_time === values.end_time;
  const nextDay = timed && isClock(values.start_time) && isClock(values.end_time) && !sameTimes && crossesMidnight(values.start_time, values.end_time);
  const minutes = previewMinutes(values);

  return (
    <div className="space-y-6">
      {section !== "version" && (
        <fieldset className="space-y-4">
          <legend className={groupTitle}>Basics</legend>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            {section === "create" ? (
              <Field label="Code" required error={errors.code} hint="Short code shown on rosters, e.g. GEN, A, N12.">
                <Input value={values.code} maxLength={20} autoCapitalize="characters" dir="ltr"
                  onChange={(e) => set("code", e.target.value.toUpperCase())} />
              </Field>
            ) : (
              <div className="space-y-1.5 text-sm">
                <p className="text-[13px] font-medium">Code</p>
                <ShiftChip code={values.code} color={values.color_token} />
              </div>
            )}
            <Field label="Name" required error={errors.name}>
              <Input value={values.name} maxLength={100} onChange={(e) => set("name", e.target.value)} />
            </Field>
          </div>
          {section === "create" ? (
            <div>
              <Segmented label="Kind" value={kind} onChange={(v) => set("kind", v)}
                options={SHIFT_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
              <p className="mt-1 text-xs text-muted-foreground">{SHIFT_KINDS.find((k) => k.value === kind)?.help}</p>
            </div>
          ) : (
            <p className="text-sm"><span className="text-muted-foreground">Kind: </span>{kindLabel(kind)}
              <span className="ms-2 text-xs text-muted-foreground">To change the kind, create a new shift.</span></p>
          )}
          <div>
            <p id="shift-colour-label" className="text-[13px] font-medium">Colour</p>
            <div role="radiogroup" aria-labelledby="shift-colour-label" className="mt-1.5 flex flex-wrap gap-1.5">
              {COLOR_TOKENS.map((token, i) => (
                <button key={token} type="button" role="radio" aria-checked={values.color_token === token} aria-label={`Colour ${i + 1}`}
                  onClick={() => set("color_token", token)}
                  className={cn("inline-flex h-9 min-w-9 items-center gap-1 rounded-lg border px-2 text-xs font-medium",
                    values.color_token === token ? "border-foreground ring-2 ring-primary/40" : "border-border")}>
                  <span aria-hidden className="h-3 w-3 rounded-full" style={{ backgroundColor: colorOf(token) }} />
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
          {section === "create" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Owner" hint="Who can use this shift.">
                <Select value={values.owner} onChange={(e) => onChange({ ...values, owner: e.target.value as ShiftFormValues["owner"], legal_entity_id: "", branch_id: "" })}>
                  <option value="COMPANY">Whole company</option>
                  <option value="ENTITY">A legal entity</option>
                  <option value="BRANCH">A branch</option>
                </Select>
              </Field>
              {values.owner === "ENTITY" && (
                <Field label="Legal entity" required error={errors.legal_entity_id}>
                  <Select value={values.legal_entity_id} onChange={(e) => set("legal_entity_id", e.target.value)}>
                    <option value="">Choose…</option>
                    {owners?.entities.map((o) => <option key={o.id} value={o.id}>{o.trade_name || o.legal_name || o.code}</option>)}
                  </Select>
                </Field>
              )}
              {values.owner === "BRANCH" && (
                <Field label="Branch" required error={errors.branch_id}>
                  <Select value={values.branch_id} onChange={(e) => set("branch_id", e.target.value)}>
                    <option value="">Choose…</option>
                    {owners?.branches.map((o) => <option key={o.id} value={o.id}>{o.name ?? o.code}</option>)}
                  </Select>
                </Field>
              )}
            </div>
          )}
          <Field label="Description">
            <Textarea rows={2} maxLength={500} value={values.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
        </fieldset>
      )}

      {section !== "catalogue" && (
        <>
          <fieldset className="space-y-4">
            <legend className={groupTitle}>{section === "create" ? "Times (version 1)" : "Times"}</legend>
            {kind === "FIXED" || kind === "FLEXIBLE" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={kind === "FLEXIBLE" ? "Band starts" : "Start"} required error={errors.start_time}>
                  <Input type="time" value={values.start_time} onChange={(e) => set("start_time", e.target.value)} />
                </Field>
                <Field label={kind === "FLEXIBLE" ? "Band ends" : "End"} required error={errors.end_time}
                  hint={nextDay ? <span data-testid="next-day-chip" className="font-medium text-foreground">+1 next day</span> : undefined}>
                  <Input type="time" value={values.end_time} onChange={(e) => set("end_time", e.target.value)} />
                </Field>
              </div>
            ) : null}
            {kind === "FIXED" && sameTimes && (
              <div className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={values.long_duty}
                    onChange={(e) => set("long_duty", e.target.checked)} aria-describedby={errors.long_duty ? "long-duty-error" : undefined} />
                  <span>This is a 24-hour duty</span>
                </label>
                {errors.long_duty && <p id="long-duty-error" role="alert" className="mt-1 text-xs font-medium text-danger">{errors.long_duty}</p>}
              </div>
            )}
            {kind === "FLEXIBLE" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Core starts" error={errors.core_start_time} hint="Everyone works the core hours.">
                  <Input type="time" value={values.core_start_time} onChange={(e) => set("core_start_time", e.target.value)} />
                </Field>
                <Field label="Core ends">
                  <Input type="time" value={values.core_end_time} onChange={(e) => set("core_end_time", e.target.value)} />
                </Field>
              </div>
            )}
            {(kind === "FLEXIBLE" || kind === "OPEN") && (
              <Field label="Expected work (h:mm)" required={kind === "OPEN"} error={errors.expected} hint="Hours to work per day, e.g. 8:00.">
                <Input inputMode="decimal" dir="ltr" className="sm:w-40" value={values.expected} onChange={(e) => set("expected", e.target.value)} />
              </Field>
            )}
            {kind === "SPLIT" && (
              <div className="space-y-2">
                <p className="text-[13px] font-medium">Blocks</p>
                {values.segments.map((s, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <Field label={`Block ${i + 1} type`} className="w-36">
                      <Select value={s.kind} onChange={(e) => set("segments", values.segments.map((x, j) => (j === i ? { ...x, kind: e.target.value as "WORK" | "ON_CALL" } : x)))}>
                        <option value="WORK">Work</option>
                        <option value="ON_CALL">On call</option>
                      </Select>
                    </Field>
                    <Field label={`Block ${i + 1} start`} className="w-32">
                      <Input type="time" value={s.start} onChange={(e) => set("segments", values.segments.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                    </Field>
                    <Field label={`Block ${i + 1} end`} className="w-32">
                      <Input type="time" value={s.end} onChange={(e) => set("segments", values.segments.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                    </Field>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove block ${i + 1}`} disabled={values.segments.length <= 2}
                      onClick={() => set("segments", values.segments.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                ))}
                {errors.segments && <p role="alert" className="text-xs font-medium text-danger">{errors.segments}</p>}
                {values.segments.length < 4 && (
                  <Button type="button" variant="secondary" size="sm" onClick={() => set("segments", [...values.segments, { kind: "WORK", start: "", end: "" }])}>
                    <Plus className="h-4 w-4" aria-hidden /> Add block
                  </Button>
                )}
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className={groupTitle}>Breaks</legend>
            {values.breaks.length === 0 && <p className="text-sm text-muted-foreground">No breaks.</p>}
            {values.breaks.map((b, i) => {
              const update = (patch: Partial<typeof b>) => set("breaks", values.breaks.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="space-y-2 rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label={`Break ${i + 1} type`} className="w-32">
                      <Select value={b.kind} onChange={(e) => update({ kind: e.target.value as typeof b.kind })}>
                        {BREAK_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                      </Select>
                    </Field>
                    <Field label={`Break ${i + 1} timing`} className="w-52">
                      <Select value={b.mode} onChange={(e) => update({ mode: e.target.value as typeof b.mode })}>
                        {BREAK_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </Select>
                    </Field>
                    <Field label={`Break ${i + 1} minutes`} className="w-28">
                      <Input inputMode="numeric" value={b.minutes} onChange={(e) => update({ minutes: e.target.value })} />
                    </Field>
                    <label className="flex min-h-10 items-center gap-2 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-primary" checked={b.paid} onChange={(e) => update({ paid: e.target.checked })} />
                      Paid
                    </label>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove break ${i + 1}`}
                      onClick={() => set("breaks", values.breaks.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                  {b.mode === "FIXED_WINDOW" && (
                    <div className="flex flex-wrap gap-2">
                      <Field label={`Break ${i + 1} from`} className="w-32"><Input type="time" value={b.start} onChange={(e) => update({ start: e.target.value })} /></Field>
                      <Field label={`Break ${i + 1} to`} className="w-32"><Input type="time" value={b.end} onChange={(e) => update({ end: e.target.value })} /></Field>
                    </div>
                  )}
                  {b.mode === "FLOATING_WINDOW" && (
                    <div className="flex flex-wrap gap-2">
                      <Field label={`Break ${i + 1} window from`} className="w-40"><Input type="time" value={b.window_start} onChange={(e) => update({ window_start: e.target.value })} /></Field>
                      <Field label={`Break ${i + 1} window to`} className="w-40"><Input type="time" value={b.window_end} onChange={(e) => update({ window_end: e.target.value })} /></Field>
                    </div>
                  )}
                  {b.mode === "AUTO_DEDUCT" && (
                    <Field label={`Break ${i + 1} deduct after (minutes worked)`} className="w-64">
                      <Input inputMode="numeric" value={b.auto_deduct_after_minutes} onChange={(e) => update({ auto_deduct_after_minutes: e.target.value })} />
                    </Field>
                  )}
                  {errors[`breaks.${i}`] && <p role="alert" className="text-xs font-medium text-danger">{errors[`breaks.${i}`]}</p>}
                </div>
              );
            })}
            {values.breaks.length < 4 && (
              <Button type="button" variant="secondary" size="sm" onClick={() => set("breaks", [...values.breaks, emptyBreak()])}>
                <Plus className="h-4 w-4" aria-hidden /> Add break
              </Button>
            )}
            <p className="text-xs text-muted-foreground">Paid must match how payroll pays this break.</p>
          </fieldset>

          <details className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-sm font-semibold">Advanced</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Grace in (minutes)" error={errors.grace_in_minutes} hint="Empty: the attendance rules apply.">
                <Input inputMode="numeric" value={values.grace_in_minutes} onChange={(e) => set("grace_in_minutes", e.target.value)} />
              </Field>
              <Field label="Grace out (minutes)" error={errors.grace_out_minutes}>
                <Input inputMode="numeric" value={values.grace_out_minutes} onChange={(e) => set("grace_out_minutes", e.target.value)} />
              </Field>
              <Field label="Early punch window (minutes)" error={errors.early_in_window_minutes} hint="How early a punch still belongs to this shift.">
                <Input inputMode="numeric" value={values.early_in_window_minutes} onChange={(e) => set("early_in_window_minutes", e.target.value)} />
              </Field>
              <Field label="Late punch window (minutes)" error={errors.late_out_window_minutes}>
                <Input inputMode="numeric" value={values.late_out_window_minutes} onChange={(e) => set("late_out_window_minutes", e.target.value)} />
              </Field>
              {timed && (
                <>
                  <Field label="Half-day split" error={errors.half_split_time} hint="Empty: halves split at the break.">
                    <Input type="time" value={values.half_split_time} onChange={(e) => set("half_split_time", e.target.value)} />
                  </Field>
                  <Field label="Client time zone" hint="For shifts set by a client's clock, e.g. America/New_York.">
                    <Input dir="ltr" value={values.anchor_timezone} onChange={(e) => set("anchor_timezone", e.target.value)} />
                  </Field>
                </>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={values.safety_critical} onChange={(e) => set("safety_critical", e.target.checked)} />
                Safety critical
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={values.outdoor} onChange={(e) => set("outdoor", e.target.checked)} />
                Outdoor work
              </label>
            </div>
          </details>

          <fieldset className="space-y-4">
            <legend className={groupTitle}>Dates</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Effective from" required error={errors.effective_from}>
                <Input type="date" value={values.effective_from} onChange={(e) => set("effective_from", e.target.value)} />
              </Field>
              {section === "version" && (
                <div className="space-y-2">
                  <label className="flex min-h-10 items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-primary" checked={values.temporary}
                      onChange={(e) => set("temporary", e.target.checked)} />
                    Temporary change
                  </label>
                  {values.temporary && (
                    <Field label="Temporary — ends on" required error={errors.effective_to}>
                      <Input type="date" value={values.effective_to} onChange={(e) => set("effective_to", e.target.value)} />
                    </Field>
                  )}
                </div>
              )}
            </div>
            <Field label="Reason" error={errors.reason} hint="Needed when the date is in the past.">
              <Textarea rows={2} maxLength={500} value={values.reason} onChange={(e) => set("reason", e.target.value)} />
            </Field>
          </fieldset>

          <section aria-label="Preview" className="rounded-xl border border-border bg-surface-muted/50 p-3 text-sm" data-testid="shift-preview">
            <p className="font-medium">Preview</p>
            <p className="mt-1 text-muted-foreground">
              {timed && isClock(values.start_time) && isClock(values.end_time) && kind !== "SPLIT"
                ? `${kind === "FLEXIBLE" ? "Band" : "Work"} ${values.start_time}–${values.end_time}${nextDay || sameTimes ? " next day" : ""} · `
                : ""}
              {minutes.gross !== null ? `gross ${fmtMinutes(minutes.gross)} · ` : ""}
              {minutes.unpaid ? `unpaid breaks ${minutes.unpaid} min · ` : ""}
              {`scheduled ${minutes.net !== null ? fmtMinutes(minutes.net) : "from the standard hours"}`}
            </p>
          </section>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ form */

function catalogueValues(shift: ShiftDetail, today: string): ShiftFormValues {
  return { ...defaultValues(today), code: shift.code, name: shift.name, kind: shift.kind, color_token: shift.color_token,
    description: shift.description ?? "" };
}

/**
 * `ShiftForm` on `FormHost` (X 04 §4): create (`?modal=shift`, POST /shifts with version 1) or catalogue edit (Sheet
 * `mode=edit` / page twin, PATCH /shifts/{id} with If-Match). Times change through the version Modal, never here.
 */
export function ShiftForm({ formId, mode, idempotencyKey, setDirty, setSubmitting, onSuccess, shift }: Pick<FormRenderProps,
  "formId" | "mode" | "idempotencyKey" | "setDirty" | "setSubmitting" | "onSuccess"> & { shift?: ShiftDetail | null }) {
  const { me } = useCan();
  const today = useMemo(() => todayIn(me?.company?.timezone), [me?.company?.timezone]);
  const section: ShiftSection = mode === "create" ? "create" : "catalogue";
  const initial = useMemo(() => (shift && mode === "edit" ? catalogueValues(shift, today) : defaultValues(today)), [shift, mode, today]);
  const [values, setValues] = useState<ShiftFormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const owners = useOwners(section === "create" && values.owner !== "COMPANY");
  const first = useRef(true);

  useEffect(() => setValues(initial), [initial]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setDirty(JSON.stringify(values) !== JSON.stringify(initial));
  }, [values, initial, setDirty]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = validateShift(values, section, today);
    setErrors(next);
    setError(null);
    if (Object.keys(next).length) return;
    setSubmitting(true);
    try {
      if (section === "create") {
        const created = await shiftsApi.create({
          code: values.code, name: values.name.trim(), kind: values.kind, color_token: values.color_token,
          legal_entity_id: values.owner === "ENTITY" && values.legal_entity_id ? Number(values.legal_entity_id) : null,
          branch_id: values.owner === "BRANCH" && values.branch_id ? Number(values.branch_id) : null,
          description: values.description.trim() || null, version: toVersionBody(values, "create"),
        }, idempotencyKey);
        onSuccess({ id: created.id });
      } else if (shift) {
        await shiftsApi.update(shift.id, { name: values.name.trim(), color_token: values.color_token,
          description: values.description.trim() || null }, shift.row_version);
        onSuccess({ id: shift.id });
      }
    } catch (err) {
      setError(err);
      setErrors(shiftFieldErrors(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form id={formId} onSubmit={submit} noValidate className="space-y-4" data-testid="shift-form">
      <p className="text-xs text-muted-foreground">Fields marked * are required.</p>
      <ShiftErrorNotice error={error} />
      <ShiftFields values={values} onChange={setValues} errors={errors} section={section} owners={owners} />
    </form>
  );
}
