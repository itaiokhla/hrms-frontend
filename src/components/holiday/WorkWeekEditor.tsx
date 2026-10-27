"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CalendarClock, ChevronDown, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { useDebounced } from "@/lib/hooks";
import {
  HolidayApiError,
  OCCURRENCES,
  WEEKDAY_NAMES,
  workWeeksApi,
  type Preview,
  type RestIssue,
  type Template,
  type WorkWeekDetail,
} from "@/lib/holiday/api";
import {
  addDays,
  codeFromName,
  defaultEditor,
  fromRules,
  localProblems,
  monthRange,
  resizeCycle,
  restCandidates,
  toRules,
  type CycleCell,
  type DayMode,
  type EditorRules,
} from "@/lib/holiday/workWeekRules";

import { WorkWeekPreview } from "./WorkWeekPreview";

export interface EntityOption {
  id: number;
  legal_name: string;
}

const MODES: { value: DayMode; label: string }[] = [
  { value: "WORKING", label: "Working" },
  { value: "HALF", label: "Half day off" },
  { value: "OFF", label: "Off" },
];
const NEXT_CELL: Record<CycleCell, CycleCell> = { W: "O", O: "F", F: "S", S: "W" };
const CELL_LABEL: Record<CycleCell, string> = { W: "Work", O: "Off", F: "½ AM off", S: "½ PM off" };
const FIELD_OF_CODE: Record<string, string> = {
  ORG_CODE_TAKEN: "code",
  ORG_CODE_INVALID: "code",
  ORG_NAME_INVALID: "name",
  REASON_REQUIRED: "reason",
  BACKDATE_LIMIT: "effective_from",
  ANCHOR_REQUIRED: "anchor",
  INVALID_CYCLE: "length",
};

function toggle(values: number[], value: number): number[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

/**
 * The `work-week` form (LH 04-holiday/03 §5.10; 09-ui-ux/02 §19): create mode (template, code, name, owner) or
 * version mode ("Change from a date…": effective from, reason when backdated). The preview panel calls
 * `POST /work-weeks/preview` 500 ms after every change and shows the month grid, the impact and weekly-rest warnings.
 * One component serves the modal and its full-page twin (same-form rule).
 */
export function WorkWeekEditor({
  mode,
  pattern,
  templates,
  entities,
  today,
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  mode: "create" | "version";
  pattern?: WorkWeekDetail;
  templates: Template[];
  entities: EntityOption[];
  /** The owner's local today (server); the default effective date and cycle anchor. */
  today: string;
  onSaved: (pattern: WorkWeekDetail) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const localToday = pattern?.local_today ?? today;
  const [editor, setEditor] = useState<EditorRules>(() => (pattern ? fromRules(pattern.rules, localToday) : defaultEditor(localToday)));
  const [template, setTemplate] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [owner, setOwner] = useState<string>(entities.length === 1 ? String(entities[0].id) : "");
  const [effectiveFrom, setEffectiveFrom] = useState(localToday);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [showRest, setShowRest] = useState(false);
  const [month, setMonth] = useState(() => (mode === "version" ? effectiveFrom : localToday).slice(0, 7));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<RestIssue[]>([]);
  const dirtyRef = useRef(false);

  const rules = useMemo(() => toRules(editor), [editor]);
  const problems = localProblems(editor);
  const halfDaysEnabled = preview?.half_day_offs_enabled ?? false;
  const backdated = mode === "version" && effectiveFrom < localToday;
  const scheduled = mode === "version" && effectiveFrom > localToday;
  const markDirty = () => {
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      onDirtyChange?.(true);
    }
  };
  const update = (next: EditorRules) => {
    setEditor(next);
    setAcknowledged(false);
    markDirty();
  };

  // ---- live preview (debounced 500 ms, §5.7)
  const request = useDebounced(
    JSON.stringify({ rules, month, effectiveFrom, owner, problems: problems.length }),
    500,
  );
  useEffect(() => {
    if (problems.length) return;
    const { from, to } = monthRange(month);
    let cancelled = false;
    setPreviewing(true);
    workWeeksApi
      .preview({
        rules,
        from,
        to,
        ...(mode === "version" && pattern ? { pattern_id: pattern.id, effective_from: effectiveFrom } : {}),
        ...(mode === "create" && owner ? { legal_entity_id: Number(owner) } : {}),
      })
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        setPreviewError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPreviewError(e instanceof Error ? e.message : "The preview could not be loaded.");
      })
      .finally(() => !cancelled && setPreviewing(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const warnings: RestIssue[] = [...(preview?.rest_check.warnings ?? []), ...serverIssues.filter((i) => !i.verified)];
  const uniqueWarnings = warnings.filter((w, i) => warnings.findIndex((x) => x.message === w.message) === i);
  const violations = preview?.rest_check.violations ?? [];

  // ---- template, kind, weekdays, cycle
  const applyTemplate = (codeValue: string) => {
    setTemplate(codeValue);
    const t = templates.find((x) => x.code === codeValue);
    if (!t) return;
    update(fromRules(t.rules, localToday));
    if (!name) {
      setName(t.name);
      if (!codeTouched) setCode(codeFromName(t.name));
    }
  };
  const setDay = (index: number, patch: Partial<EditorRules["weekdays"][number]>) =>
    update({ ...editor, weekdays: editor.weekdays.map((d, i) => (i === index ? { ...d, ...patch } : d)) });

  // ---- save
  const save = async () => {
    setErrors({});
    setFormError(null);
    if (problems.length) {
      setFormError(problems[0]);
      return;
    }
    const nextErrors: Record<string, string> = {};
    if (mode === "create" && !name.trim()) nextErrors.name = "Enter a name.";
    if (backdated && !reason.trim()) nextErrors.reason = "Give a reason for a backdated change.";
    if (uniqueWarnings.length && !acknowledged) nextErrors.acknowledge = "Review the weekly-rest warnings and tick the box.";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setSaving(true);
    try {
      if (mode === "create") {
        const created = await workWeeksApi.create({
          name: name.trim(),
          ...(code.trim() ? { code: code.trim() } : {}),
          ...(owner ? { legal_entity_id: Number(owner) } : {}),
          ...(template ? { template_code: template } : {}),
          rules,
          acknowledge_warnings: acknowledged,
        });
        toast.success(`Work week ${created.name} saved`);
        dirtyRef.current = false;
        onDirtyChange?.(false);
        onSaved(created);
      } else if (pattern) {
        const result = await workWeeksApi.addVersion(
          pattern.id,
          { rules, effective_from: effectiveFrom, ...(reason.trim() ? { reason: reason.trim() } : {}), acknowledge_warnings: acknowledged },
          pattern.row_version,
        );
        const recount = result.recount?.changed ? ` · ${result.recount.changed} leave day(s) recounted` : "";
        toast.success(
          scheduled ? `Change scheduled from ${effectiveFrom}${recount}` : `Version ${result.version?.version} saved${recount}`,
        );
        dirtyRef.current = false;
        onDirtyChange?.(false);
        onSaved(result.pattern);
      }
    } catch (e) {
      if (e instanceof HolidayApiError) {
        if (e.issues.length) setServerIssues(e.issues as RestIssue[]);
        const field = e.code ? FIELD_OF_CODE[e.code] : undefined;
        if (field) setErrors({ [field]: e.message });
        else setFormError(e.code === "ROW_VERSION_CONFLICT" ? "This work week changed since you opened it. Reload and try again." : e.message);
      } else {
        setFormError(e instanceof Error ? e.message : "Saving failed.");
      }
    } finally {
      setSaving(false);
    }
  };

  const impact = preview?.impact;
  const primaryLabel = mode === "create" ? "Save pattern" : scheduled ? "Schedule change" : "Save as new version";

  return (
    <div className="space-y-5" data-testid="work-week-editor">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {/* ------------------------------------------------ form */}
        <div className="space-y-5">
          {mode === "create" && (
            <>
              <Field label="Start from template" hint="Copies the rules; later template changes do not touch your pattern.">
                <Select value={template} onChange={(e) => applyTemplate(e.target.value)} data-testid="template-select">
                  <option value="">Blank (Monday to Friday)</option>
                  {templates.map((t) => (
                    <option key={t.code} value={t.code} disabled={!t.available}>
                      {t.name} — {t.typical_use}
                      {t.available ? "" : " (after half-day offs are enabled)"}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" required error={errors.name}>
                  <Input
                    value={name}
                    maxLength={100}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (!codeTouched) setCode(codeFromName(e.target.value));
                      markDirty();
                    }}
                  />
                </Field>
                <Field label="Code" required hint="Upper case; fixed once the pattern is in use." error={errors.code}>
                  <Input
                    value={code}
                    maxLength={30}
                    onChange={(e) => {
                      setCode(e.target.value.toUpperCase());
                      setCodeTouched(true);
                      markDirty();
                    }}
                  />
                </Field>
              </div>
              <Field label="Owner" hint="Tenant-wide patterns can be used by every entity; an entity's pattern only inside it.">
                <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
                  <option value="">Tenant-wide</option>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.legal_name}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}

          <Segmented
            label="Kind"
            value={editor.kind}
            options={[
              { value: "WEEKLY", label: "Weekly" },
              { value: "CYCLE", label: "Rotating cycle" },
            ]}
            onChange={(kind) => update({ ...editor, kind })}
          />

          <AnimatePresence mode="wait" initial={false}>
            {editor.kind === "WEEKLY" ? (
              <motion.div key="weekly" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-2">
                {editor.weekdays.map((day, index) => (
                  <div
                    key={WEEKDAY_NAMES[index]}
                    className="rounded-2xl border border-border bg-surface-muted/40 px-3 py-2.5"
                    data-testid={`weekday-${index}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="w-24 text-sm font-medium">{WEEKDAY_NAMES[index]}</span>
                      <div role="radiogroup" aria-label={`${WEEKDAY_NAMES[index]}`} className="inline-flex gap-1 rounded-xl border border-border bg-surface p-0.5">
                        {MODES.map((m) => {
                          const disabled = m.value === "HALF" && !halfDaysEnabled && day.mode !== "HALF";
                          return (
                            <button
                              key={m.value}
                              type="button"
                              role="radio"
                              aria-checked={day.mode === m.value}
                              disabled={disabled}
                              title={disabled ? "Available after half-day weekly offs are enabled" : undefined}
                              onClick={() => setDay(index, { mode: m.value, ...(m.value === "OFF" ? { extraOff: [] } : {}) })}
                              className={cn(
                                "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                                day.mode === m.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {m.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {day.mode !== "OFF" && (
                      <fieldset className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <legend className="sr-only">Also off on these {WEEKDAY_NAMES[index]}s of the month</legend>
                        <span className="text-muted-foreground">Also off on:</span>
                        {OCCURRENCES.map((o) => (
                          <label key={o.value} className="inline-flex items-center gap-1">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                              aria-label={`${o.label} ${WEEKDAY_NAMES[index]} off`}
                              checked={day.extraOff.includes(o.value)}
                              disabled={day.mode === "HALF" && day.halfNth.includes(o.value)}
                              onChange={() => setDay(index, { extraOff: toggle(day.extraOff, o.value) })}
                            />
                            {o.label}
                          </label>
                        ))}
                      </fieldset>
                    )}
                    {day.mode === "HALF" && (
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                        <Select
                          aria-label={`${WEEKDAY_NAMES[index]} half`}
                          className="h-8 w-40 text-xs"
                          value={day.portion}
                          onChange={(e) => setDay(index, { portion: e.target.value as "FIRST_HALF" | "SECOND_HALF" })}
                        >
                          <option value="FIRST_HALF">Morning off</option>
                          <option value="SECOND_HALF">Afternoon off</option>
                        </Select>
                        <span className="text-muted-foreground">Only on:</span>
                        {OCCURRENCES.map((o) => (
                          <label key={o.value} className="inline-flex items-center gap-1">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5"
                              checked={day.halfNth.includes(o.value)}
                              disabled={day.extraOff.includes(o.value)}
                              onChange={() => setDay(index, { halfNth: toggle(day.halfNth, o.value) })}
                            />
                            {o.label}
                          </label>
                        ))}
                        <span className="text-muted-foreground">(none = every week)</span>
                      </div>
                    )}
                  </div>
                ))}
                {!halfDaysEnabled && (
                  <p className="text-xs text-muted-foreground">Half-day offs: available after half-day weekly offs are enabled.</p>
                )}
              </motion.div>
            ) : (
              <motion.div key="cycle" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Cycle length (days)" required hint="2–56 days" error={errors.length}>
                    <Input
                      type="number"
                      min={2}
                      max={56}
                      value={editor.cycle.length}
                      onChange={(e) => update({ ...editor, cycle: resizeCycle(editor.cycle, Math.min(56, Math.max(0, Number(e.target.value) || 0))) })}
                    />
                  </Field>
                  <Field label="Anchor date (cycle day 1)" required hint="Never moves; a new parity is a new version." error={errors.anchor}>
                    <Input type="date" value={editor.cycle.anchor} onChange={(e) => update({ ...editor, cycle: { ...editor.cycle, anchor: e.target.value } })} />
                  </Field>
                </div>
                <div>
                  <p className="mb-1.5 text-[13px] font-medium">Cycle days (click to change: work → off → ½ AM → ½ PM)</p>
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                    {editor.cycle.cells.slice(0, editor.cycle.length).map((cell, i) => (
                      <button
                        key={i}
                        type="button"
                        data-testid={`cycle-day-${i + 1}`}
                        aria-label={`Day ${i + 1}, ${addDays(editor.cycle.anchor, i)}: ${CELL_LABEL[cell]}`}
                        onClick={() => {
                          let next = NEXT_CELL[cell];
                          if (!halfDaysEnabled && (next === "F" || next === "S")) next = "W";
                          const cells = [...editor.cycle.cells];
                          cells[i] = next;
                          update({ ...editor, cycle: { ...editor.cycle, cells } });
                        }}
                        className={cn(
                          "rounded-xl border px-1 py-1.5 text-center text-[11px] transition-colors",
                          cell === "O" && "border-primary/40 bg-primary-soft font-semibold text-primary",
                          (cell === "F" || cell === "S") && "border-warning/40 bg-warning-soft",
                          cell === "W" && "border-border bg-surface",
                        )}
                      >
                        <span className="block font-medium">Day {i + 1}</span>
                        <span className="block text-[10px] text-muted-foreground">{addDays(editor.cycle.anchor, i).slice(5)}</span>
                        <span className="block">{CELL_LABEL[cell]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="rounded-2xl border border-dashed border-border">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
              aria-expanded={showRest}
              onClick={() => setShowRest((v) => !v)}
            >
              Rest days (advanced)
              <ChevronDown className={cn("h-4 w-4 transition-transform", showRest && "rotate-180")} aria-hidden />
            </button>
            {showRest && (
              <div className="space-y-2 px-3 pb-3 text-xs">
                <p className="text-muted-foreground">
                  Only needed where a holiday on the rest day is treated differently from other days off (e.g. Singapore). None ticked = every
                  full off is a rest day.
                </p>
                <div className="flex flex-wrap gap-3">
                  {restCandidates(editor).map((value) => (
                    <label key={value} className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={!!editor.restDays?.includes(value)}
                        onChange={() => update({ ...editor, restDays: toggle(editor.restDays ?? [], value) })}
                      />
                      {editor.kind === "CYCLE" ? `Day ${value + 1}` : WEEKDAY_NAMES[value]}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {mode === "version" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Effective from"
                required
                error={errors.effective_from}
                hint={backdated ? "Backdated: needs the publish permission and a reason." : scheduled ? "Scheduled: applies from this date." : "Applies from today."}
              >
                <Input
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => {
                    setEffectiveFrom(e.target.value);
                    setMonth(e.target.value.slice(0, 7));
                    setAcknowledged(false);
                    markDirty();
                  }}
                />
              </Field>
              {backdated && (
                <Field label="Reason" required error={errors.reason}>
                  <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
              )}
            </div>
          )}
        </div>

        {/* ------------------------------------------------ preview */}
        <div className="space-y-3 lg:sticky lg:top-0 lg:self-start">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Preview
            {preview && <Badge tone="neutral">{preview.summary}</Badge>}
          </div>
          {problems.length ? (
            <Notice tone="warning" title={problems[0]} />
          ) : previewError ? (
            <Notice tone="danger" title={previewError} />
          ) : null}
          <WorkWeekPreview month={month} days={preview?.days} loading={previewing} onMonthChange={setMonth} />
          {preview?.issues.map((i) => <Notice key={i.code} tone="warning" title={i.message ?? i.code} />)}
          {mode === "version" && impact && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-2xl border border-border bg-surface-muted/40 p-3 text-xs"
              data-testid="work-week-impact"
            >
              <p className="flex items-center gap-1.5 font-semibold">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Impact from {preview?.effective_from}
              </p>
              <p className="mt-1 text-muted-foreground">
                {impact.employees_affected.count} employees · {impact.date_changes.working_to_off} dates become weekly offs ·{" "}
                {impact.date_changes.off_to_working} become working days
                {impact.leave_recount.requests
                  ? ` · ${impact.leave_recount.requests} approved leave request(s) recounted (${impact.leave_recount.units > 0 ? "+" : ""}${impact.leave_recount.units} days)`
                  : ""}
                {impact.pending_requests ? ` · ${impact.pending_requests} pending request(s) re-checked` : ""}
              </p>
              {impact.locked_periods.map((p) => (
                <p key={`${p.pay_group_id}-${p.period_start}`} className="mt-1 font-medium text-warning" data-testid="locked-period">
                  {p.pay_group ?? "Payroll"} {p.period_start} – {p.period_end} is {p.state === "FINALIZED" ? "finalized" : "input-locked"}: retro
                </p>
              ))}
              {preview?.no_change && <p className="mt-1 font-medium text-warning">These rules are already in effect on that date.</p>}
            </motion.div>
          )}
          {(uniqueWarnings.length > 0 || violations.length > 0) && (
            <div className="space-y-2 rounded-2xl border border-warning/40 bg-warning-soft p-3 text-xs" role="alert" data-testid="rest-warnings">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden /> Weekly rest
              </p>
              <ul className="list-disc space-y-0.5 pl-4">
                {[...violations, ...uniqueWarnings].map((w) => (
                  <li key={`${w.legal_entity_id}-${w.rule}-${w.start}`}>
                    {w.message}
                    {w.legal_entity ? ` (${w.legal_entity})` : ""}
                  </li>
                ))}
              </ul>
              {uniqueWarnings.length > 0 && (
                <label className="flex items-center gap-2 font-medium">
                  <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                  I have reviewed the warnings
                </label>
              )}
              {errors.acknowledge && <p className="font-medium text-danger">{errors.acknowledge}</p>}
            </div>
          )}
        </div>
      </div>

      {formError && <Notice tone="danger" title={formError} />}
      <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-2 border-t border-border bg-surface/95 px-1 pt-3 backdrop-blur">
        <span className="text-xs text-muted-foreground">{dirtyRef.current ? "Unsaved changes" : ""}</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} data-testid="work-week-save">
            {primaryLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
