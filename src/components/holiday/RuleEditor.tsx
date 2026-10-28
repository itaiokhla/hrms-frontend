"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import {
  CATEGORY_LABEL,
  HolidayApiError,
  MONTHS,
  OBSERVED_LABEL,
  RULE_KIND_LABEL,
  WEEKDAYS,
  yearsApi,
  type Calendar,
  type HolidayCategory,
  type HolidayRule,
  type HolidayType,
  type ObservedRule,
  type RulePreview,
  type RuleKind,
  type RuleSaveResult,
  type RuleWrite,
} from "@/lib/holiday/api";

import { RulePreviewList } from "./RulePreviewList";

const NTH = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: 5, label: "5th" },
  { value: -1, label: "last" },
];
const DIRECTIONS = [
  { value: "ON_OR_AFTER", label: "on or after" },
  { value: "AFTER", label: "after" },
  { value: "ON_OR_BEFORE", label: "on or before" },
  { value: "BEFORE", label: "before" },
];

export interface RuleForm {
  name: string;
  kind: RuleKind;
  month: number;
  day: number;
  weekday: number;
  nth: number;
  direction: string;
  offset: number;
  missing: "SKIP" | "LAST_DAY_OF_MONTH" | "NEXT_DAY";
  tradition: "WESTERN" | "ORTHODOX";
  expectedMonth: number | "";
  hint: string;
  date: string;
  lasts: number;
  rangeMin: number;
  rangeMax: number;
  holidayType: HolidayType;
  category: HolidayCategory;
  observed: ObservedRule;
  trigger: number[];
  coincides: boolean;
  fromYear: number;
  untilYear: number | "";
  source: "MANUAL" | "GOVT_NOTICE";
  legalRef: string;
  issuedOn: string;
}

export function defaultRuleForm(today: string, weekend: number[]): RuleForm {
  return {
    name: "",
    kind: "FIXED_DATE",
    month: 1,
    day: 1,
    weekday: 0,
    nth: 1,
    direction: "BEFORE",
    offset: 0,
    missing: "SKIP",
    tradition: "WESTERN",
    expectedMonth: "",
    hint: "",
    date: today,
    lasts: 1,
    rangeMin: 1,
    rangeMax: 1,
    holidayType: "COMPANY",
    category: "OTHER",
    observed: "NONE",
    trigger: [...weekend],
    coincides: false,
    fromYear: Number(today.slice(0, 4)),
    untilYear: "",
    source: "MANUAL",
    legalRef: "",
    issuedOn: "",
  };
}

/** A stored rule as form state (edit mode). */
export function fromRule(rule: HolidayRule, today: string, weekend: number[]): RuleForm {
  const p = rule.params as Record<string, unknown>;
  const base = defaultRuleForm(today, weekend);
  const range = rule.duration_range ?? [rule.duration_days, rule.duration_days];
  return {
    ...base,
    name: rule.name,
    kind: rule.kind,
    month: Number(p.month ?? base.month),
    day: Number(p.day ?? base.day),
    weekday: Number(p.weekday ?? base.weekday),
    nth: Number(p.nth ?? base.nth),
    direction: String(p.direction ?? base.direction),
    offset: Number(p.offset_days ?? 0),
    missing: (p.missing_date as RuleForm["missing"]) ?? "SKIP",
    tradition: (p.tradition as RuleForm["tradition"]) ?? "WESTERN",
    expectedMonth: p.expected_month ? Number(p.expected_month) : "",
    hint: String(p.hint ?? ""),
    date: String(p.date ?? today),
    lasts: rule.duration_days,
    rangeMin: range[0],
    rangeMax: range[1],
    holidayType: rule.holiday_type,
    category: rule.category,
    observed: rule.observed_rule,
    trigger: rule.applies_on ?? [...weekend],
    coincides: Boolean(p.observe_if_coincides),
    fromYear: rule.valid_from_year ?? base.fromYear,
    untilYear: rule.valid_to_year ?? "",
    source: rule.source === "GOVT_NOTICE" ? "GOVT_NOTICE" : "MANUAL",
    legalRef: rule.legal_ref ?? "",
    issuedOn: rule.issued_on ?? "",
  };
}

/** Form state -> request body (02 §3.4: only the keys of the chosen kind are sent). */
export function toRuleWrite(f: RuleForm, weekend: number[]): RuleWrite {
  const params: Record<string, unknown> = {};
  switch (f.kind) {
    case "FIXED_DATE":
      Object.assign(params, { month: f.month, day: f.day });
      if (f.offset) params.offset_days = f.offset;
      if (f.month === 2 && f.day === 29 && f.missing !== "SKIP") params.missing_date = f.missing;
      break;
    case "NTH_WEEKDAY":
      Object.assign(params, { month: f.month, weekday: f.weekday, nth: f.nth });
      if (f.offset) params.offset_days = f.offset;
      break;
    case "WEEKDAY_RELATIVE":
      Object.assign(params, { month: f.month, day: f.day, weekday: f.weekday, direction: f.direction });
      break;
    case "EASTER_OFFSET":
      Object.assign(params, { offset_days: f.offset, tradition: f.tradition });
      break;
    case "ANNUAL_CONFIRM":
      if (f.expectedMonth) params.expected_month = f.expectedMonth;
      if (f.hint.trim()) params.hint = f.hint.trim();
      break;
    case "ONE_OFF":
      params.date = f.date;
      break;
  }
  if (f.coincides) params.observe_if_coincides = true;
  const sameAsWeekend = [...f.trigger].sort().join() === [...weekend].sort().join();
  const oneOffYear = f.kind === "ONE_OFF" ? Number(f.date.slice(0, 4)) : null;
  return {
    name: f.name.trim(),
    kind: f.kind,
    params,
    holiday_type: f.holidayType,
    category: f.category,
    portion: "FULL",
    duration_days: f.kind === "ANNUAL_CONFIRM" ? f.rangeMin : f.lasts,
    duration_range: f.kind === "ANNUAL_CONFIRM" ? [f.rangeMin, f.rangeMax] : null,
    observed_rule: f.observed,
    applies_on: f.observed === "NONE" || sameAsWeekend ? null : [...f.trigger].sort(),
    valid_from_year: oneOffYear ?? f.fromYear,
    valid_to_year: oneOffYear ?? (f.untilYear === "" ? null : f.untilYear),
    source: f.source,
    legal_ref: f.legalRef.trim() || null,
    issued_on: f.issuedOn || null,
  };
}

/** API field paths -> form fields (RULE_INVALID details). */
function fieldOf(path: string | null | undefined): string {
  if (!path) return "form";
  const key = path.replace(/^params\./, "");
  const map: Record<string, string> = {
    month: "month",
    day: "day",
    weekday: "weekday",
    nth: "nth",
    offset_days: "offset",
    date: "date",
    duration_days: "lasts",
    duration_range: "range",
    applies_on: "trigger",
    valid_from_year: "fromYear",
    valid_to_year: "untilYear",
    name: "name",
    portion: "form",
  };
  return map[key] ?? "form";
}

function Radio({ name, value, checked, label, onChange }: { name: string; value: string; checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

/**
 * Modal `holiday-rule` (04-holiday/02 §3.8): how a holiday repeats, with a live preview of the next years (400 ms
 * after the last change, `POST /rules/preview`). Save stays enabled (DR-24): pressing it validates and puts server
 * errors next to their fields; it reads "Checking…" while the preview of the last change is loading.
 */
export function RuleEditor({
  calendar,
  today,
  rule,
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  calendar: Pick<Calendar, "id" | "code" | "name" | "effective_weekend">;
  today: string;
  rule?: HolidayRule;
  onSaved: (result: RuleSaveResult) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const weekend = calendar.effective_weekend;
  const [form, setForm] = useState<RuleForm>(() => (rule ? fromRule(rule, today, weekend) : defaultRuleForm(today, weekend)));
  const [years, setYears] = useState(5);
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);
  const set = (patch: Partial<RuleForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    onDirtyChange?.(true);
  };
  const body = useMemo(() => toRuleWrite(form, weekend), [form, weekend]);
  const fromYear = Math.max(Number(today.slice(0, 4)), body.valid_from_year ?? 0);

  useEffect(() => {
    if (!body.name) {
      setPreview(null);
      return;
    }
    const mine = ++seq.current;
    setPreviewing(true);
    const timer = setTimeout(() => {
      yearsApi
        .previewRule({ calendar_id: calendar.id, rule_id: rule?.id, rule: body, years, from_year: fromYear })
        .then((p) => {
          if (seq.current !== mine) return;
          setPreview(p);
          setPreviewError(null);
        })
        .catch((e) => {
          if (seq.current !== mine) return;
          setPreview(null);
          setPreviewError(e instanceof Error ? e.message : "Preview failed.");
        })
        .finally(() => seq.current === mine && setPreviewing(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [body, years, fromYear, calendar.id, rule?.id]);

  const save = async () => {
    setErrors({});
    if (!body.name) return setErrors({ name: "Enter a name." });
    setSaving(true);
    try {
      const result = rule ? await yearsApi.updateRule(rule.id, body, rule.row_version) : await yearsApi.createRule(calendar.id, body);
      const drafts = result.draft_changes
        .map((d) => `${d.year} draft: ${d.counts.inserted ?? 0} added, ${d.counts.updated ?? 0} changed`)
        .join(" · ");
      toast.success(`Rule saved${drafts ? ` · ${drafts}` : ""}`);
      onDirtyChange?.(false);
      onSaved(result);
    } catch (e) {
      if (e instanceof HolidayApiError) {
        const details = Array.isArray(e.details) ? (e.details as { field?: string; message: string }[]) : [];
        const mapped: Record<string, string> = {};
        details.forEach((d) => {
          mapped[fieldOf(d.field)] ??= d.message;
        });
        if (!details.length) mapped.form = e.message;
        setErrors(mapped);
      } else {
        setErrors({ form: e instanceof Error ? e.message : "Saving failed." });
      }
    } finally {
      setSaving(false);
    }
  };

  const monthSelect = (
    <Field label="Month" required error={errors.month}>
      <Select value={form.month} onChange={(e) => set({ month: Number(e.target.value) })}>
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </Select>
    </Field>
  );
  const daySelect = (
    <Field label="Day" required error={errors.day}>
      <Select value={form.day} onChange={(e) => set({ day: Number(e.target.value) })}>
        {Array.from({ length: 31 }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            {i + 1}
          </option>
        ))}
      </Select>
    </Field>
  );
  const weekdaySelect = (
    <Field label="Weekday" required error={errors.weekday}>
      <Select value={form.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
        {WEEKDAYS.map((d, i) => (
          <option key={d} value={i}>
            {d}
          </option>
        ))}
      </Select>
    </Field>
  );
  const offsetInput = (label: string, limit: number) => (
    <Field label={label} error={errors.offset} hint={`${-limit} to ${limit}`}>
      <Input type="number" min={-limit} max={limit} value={form.offset} onChange={(e) => set({ offset: Number(e.target.value) || 0 })} />
    </Field>
  );

  return (
    <div className="space-y-5" data-testid="rule-editor">
      <p className="text-xs text-muted-foreground">
        Calendar <span className="font-mono font-semibold">{calendar.code}</span> · {calendar.name} · Weekend {weekend.map((d) => WEEKDAYS[d]).join(", ")}
      </p>
      <Field label="Name" required error={errors.name}>
        <Input value={form.name} maxLength={150} onChange={(e) => set({ name: e.target.value })} data-testid="rule-name" />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium">Repeats</legend>
        <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="Repeats">
          {(Object.keys(RULE_KIND_LABEL) as RuleKind[]).map((k) => (
            <Radio key={k} name="rule-kind" value={k} checked={form.kind === k} label={RULE_KIND_LABEL[k]} onChange={() => set({ kind: k, offset: 0 })} />
          ))}
        </div>
      </fieldset>
      <div className="rounded-2xl border border-border bg-surface-muted/40 p-3" data-testid={`kind-${form.kind}`}>
        {form.kind === "FIXED_DATE" && (
          <div className="grid gap-3 sm:grid-cols-3">
            {monthSelect}
            {daySelect}
            {offsetInput("Shift by (days)", 31)}
            {form.month === 2 && form.day === 29 && (
              <Field label="If 29 Feb does not exist">
                <Select value={form.missing} onChange={(e) => set({ missing: e.target.value as RuleForm["missing"] })}>
                  <option value="SKIP">Skip that year</option>
                  <option value="LAST_DAY_OF_MONTH">Use 28 Feb</option>
                  <option value="NEXT_DAY">Use 1 Mar</option>
                </Select>
              </Field>
            )}
          </div>
        )}
        {form.kind === "NTH_WEEKDAY" && (
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Which">
              <Select value={form.nth} onChange={(e) => set({ nth: Number(e.target.value) })}>
                {NTH.map((n) => (
                  <option key={n.value} value={n.value}>
                    {n.label}
                  </option>
                ))}
              </Select>
            </Field>
            {weekdaySelect}
            {monthSelect}
            {offsetInput("Shift by (days)", 31)}
          </div>
        )}
        {form.kind === "WEEKDAY_RELATIVE" && (
          <div className="grid gap-3 sm:grid-cols-4">
            {weekdaySelect}
            <Field label="Direction">
              <Select value={form.direction} onChange={(e) => set({ direction: e.target.value })}>
                {DIRECTIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
            {daySelect}
            {monthSelect}
          </div>
        )}
        {form.kind === "EASTER_OFFSET" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {offsetInput("Days from Easter Sunday", 70)}
            <Field label="Tradition">
              <Select value={form.tradition} onChange={(e) => set({ tradition: e.target.value as RuleForm["tradition"] })}>
                <option value="WESTERN">Western</option>
                <option value="ORTHODOX">Orthodox</option>
              </Select>
            </Field>
          </div>
        )}
        {form.kind === "ANNUAL_CONFIRM" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Usually in" hint="Optional; the date is set each year.">
              <Select value={form.expectedMonth} onChange={(e) => set({ expectedMonth: e.target.value ? Number(e.target.value) : "" })}>
                <option value="">Any month</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="How is the date announced?" hint="Up to 200 characters.">
              <Input value={form.hint} maxLength={200} onChange={(e) => set({ hint: e.target.value })} />
            </Field>
            <Field label="Lasts at least (days)" error={errors.range}>
              <Input type="number" min={1} max={31} value={form.rangeMin} onChange={(e) => set({ rangeMin: Number(e.target.value) || 1 })} />
            </Field>
            <Field label="Lasts at most (days)">
              <Input type="number" min={1} max={31} value={form.rangeMax} onChange={(e) => set({ rangeMax: Number(e.target.value) || 1 })} />
            </Field>
          </div>
        )}
        {form.kind === "ONE_OFF" && (
          <Field label="Date" required error={errors.date} hint="Only in its own year.">
            <Input type="date" min={today} value={form.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {form.kind !== "ANNUAL_CONFIRM" && (
          <Field label="Lasts (days)" error={errors.lasts}>
            <Input type="number" min={1} max={31} value={form.lasts} onChange={(e) => set({ lasts: Number(e.target.value) || 1 })} />
          </Field>
        )}
        <Field label="Type" required>
          <Select value={form.holidayType} onChange={(e) => set({ holidayType: e.target.value as HolidayType })}>
            <option value="PUBLIC">Public</option>
            <option value="COMPANY">Company</option>
            <option value="OPTIONAL">Optional</option>
          </Select>
        </Field>
        <Field label="Category">
          <Select value={form.category} onChange={(e) => set({ category: e.target.value as HolidayCategory })}>
            {(Object.keys(CATEGORY_LABEL) as HolidayCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Falls on a weekend" hint="Full-day holidays only; half days arrive later.">
          <Select value={form.observed} onChange={(e) => set({ observed: e.target.value as ObservedRule })} data-testid="rule-observed">
            {(Object.keys(OBSERVED_LABEL) as ObservedRule[]).map((o) => (
              <option key={o} value={o}>
                {OBSERVED_LABEL[o]}
              </option>
            ))}
          </Select>
        </Field>
        {form.observed !== "NONE" && (
          <fieldset className="space-y-1">
            <legend className="text-[13px] font-medium">Trigger days</legend>
            <div className="flex gap-1.5">
              {weekend.map((d) => (
                <label key={d} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs">
                  <input
                    type="checkbox"
                    checked={form.trigger.includes(d)}
                    onChange={() => set({ trigger: form.trigger.includes(d) ? form.trigger.filter((x) => x !== d) : [...form.trigger, d] })}
                  />
                  {WEEKDAYS[d]}
                </label>
              ))}
            </div>
            {errors.trigger && <p className="text-xs font-medium text-danger">{errors.trigger}</p>}
          </fieldset>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.coincides} onChange={(e) => set({ coincides: e.target.checked })} />
        Also move if another holiday is on the same day
      </label>
      {form.kind !== "ONE_OFF" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From year" required error={errors.fromYear}>
            <Input type="number" min={2000} max={2100} value={form.fromYear} onChange={(e) => set({ fromYear: Number(e.target.value) || form.fromYear })} />
          </Field>
          <Field label="Until year" hint="Empty = open." error={errors.untilYear}>
            <Input
              type="number"
              min={2000}
              max={2100}
              value={form.untilYear}
              onChange={(e) => set({ untilYear: e.target.value ? Number(e.target.value) : "" })}
            />
          </Field>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Source">
          <Select value={form.source} onChange={(e) => set({ source: e.target.value as RuleForm["source"] })}>
            <option value="MANUAL">Manual</option>
            <option value="GOVT_NOTICE">Government notice</option>
          </Select>
        </Field>
        <Field label="Legal reference">
          <Input value={form.legalRef} maxLength={100} onChange={(e) => set({ legalRef: e.target.value })} />
        </Field>
        <Field label="Issued on">
          <Input type="date" value={form.issuedOn} onChange={(e) => set({ issuedOn: e.target.value })} />
        </Field>
      </div>
      <section className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Preview</p>
          <Select aria-label="Preview years" className="w-28" value={years} onChange={(e) => setYears(Number(e.target.value))}>
            {[1, 3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n} year{n > 1 ? "s" : ""}
              </option>
            ))}
          </Select>
        </div>
        {!body.name && <p className="text-sm text-muted-foreground">Name the holiday to see its dates.</p>}
        <RulePreviewList preview={preview} loading={previewing} error={previewError} />
        <p className="text-xs text-muted-foreground">Saving updates draft years. Published years are not changed; you review them separately.</p>
      </section>
      {errors.form && <Notice tone="danger" title={errors.form} />}
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={saving} data-testid="rule-save">
          {previewing && !saving ? "Checking…" : "Save rule"}
        </Button>
      </div>
    </div>
  );
}
