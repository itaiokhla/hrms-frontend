/**
 * Pure helpers of the shift screens (03-shifts/01 §2–§5, §12, §17): kinds and colour tokens, clock arithmetic
 * (crossing midnight, 24-hour duty), the ShiftForm values ↔ `VersionIn` body, client validation, version states,
 * priority bands and the anchor-zone conversion used by the explain view. No React here, so all of it is unit-tested.
 */

import { zonedIso } from "@/lib/timezone";
import type { ShiftBreakRule, ShiftKind, ShiftRuleCriteria, ShiftSegment, ShiftVersion } from "@/lib/types";

import type { VersionBody } from "./api";

/* ------------------------------------------------------------------ kinds and colours */

export const SHIFT_KINDS: { value: ShiftKind; label: string; help: string }[] = [
  { value: "FIXED", label: "Fixed", help: "Set start and end times." },
  { value: "FLEXIBLE", label: "Flexible", help: "A daily band with core hours; people choose when to work." },
  { value: "OPEN", label: "Open", help: "No clock times; only the hours to work." },
  { value: "SPLIT", label: "Split", help: "Two to four work blocks with unpaid gaps." },
];

export const kindLabel = (kind: string | null | undefined) => SHIFT_KINDS.find((k) => k.value === kind)?.label ?? kind ?? "—";

export const COLOR_TOKENS = Array.from({ length: 12 }, (_, i) => `shift-${i + 1}`);

/** Platform palette of the `shift-N` tokens (spine §11.8); every use also prints the shift code. */
export const SHIFT_COLORS: Record<string, string> = {
  "shift-1": "#2563eb", "shift-2": "#16a34a", "shift-3": "#d97706", "shift-4": "#dc2626",
  "shift-5": "#7c3aed", "shift-6": "#0891b2", "shift-7": "#db2777", "shift-8": "#65a30d",
  "shift-9": "#ea580c", "shift-10": "#4f46e5", "shift-11": "#0d9488", "shift-12": "#64748b",
};

export const colorOf = (token: string | null | undefined) => SHIFT_COLORS[token ?? ""] ?? SHIFT_COLORS["shift-1"];

export const BREAK_KINDS: { value: ShiftBreakRule["kind"]; label: string }[] = [
  { value: "LUNCH", label: "Lunch" }, { value: "REST", label: "Rest" },
  { value: "PERSONAL", label: "Personal" }, { value: "OTHER", label: "Other" },
];

export const BREAK_MODES: { value: ShiftBreakRule["mode"]; label: string }[] = [
  { value: "FIXED_WINDOW", label: "Fixed time" }, { value: "FLOATING_WINDOW", label: "Any time in a window" },
  { value: "PUNCHED", label: "Punched out and in" }, { value: "AUTO_DEDUCT", label: "Deducted automatically" },
];

/* ------------------------------------------------------------------ clock arithmetic */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isClock = (value: string | null | undefined): value is string => !!value && HHMM.test(value);

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes from start to end; an end at or before the start is the next day (start = end is a 24-hour duty). */
export function spanMinutes(start: string, end: string): number {
  const diff = toMinutes(end) - toMinutes(start);
  return diff > 0 ? diff : diff + 24 * 60;
}

/** The end falls on the next day (strictly earlier clock time, or a 24-hour duty). */
export const crossesMidnight = (start: string, end: string) => toMinutes(end) <= toMinutes(start);

/** Gross hours of a start–end pair with two decimals (BUG-AS-23: the legacy form sends this, never a silent null). */
export function durationHours(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!isClock(start) || !isClock(end)) return null;
  return Math.round((spanMinutes(start, end) / 60) * 100) / 100;
}

/** 480 → "8:00", 45 → "0:45". */
export function fmtMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "—";
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

/** "8:00" / "8" / "7.5" → minutes; null when it is not a duration. */
export function parseHours(text: string): number | null {
  const t = text.trim();
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 60);
}

/** "22:00–06:00 (+1)" for a version or mirror; OPEN shifts have no clock times. */
export function timesLabel(start: string | null | undefined, end: string | null | undefined, kind?: string | null): string {
  if (kind === "OPEN" || !start || !end) return "No set times";
  return `${start}–${end}${crossesMidnight(start, end) ? " (+1)" : ""}`;
}

/* ------------------------------------------------------------------ form values */

export interface BreakRow {
  kind: ShiftBreakRule["kind"];
  mode: ShiftBreakRule["mode"];
  minutes: string;
  paid: boolean;
  start: string;
  end: string;
  window_start: string;
  window_end: string;
  auto_deduct_after_minutes: string;
}

export interface SegmentRow {
  kind: ShiftSegment["kind"];
  start: string;
  end: string;
}

export interface ShiftFormValues {
  code: string;
  name: string;
  kind: ShiftKind;
  color_token: string;
  owner: "COMPANY" | "ENTITY" | "BRANCH";
  legal_entity_id: string;
  branch_id: string;
  description: string;
  start_time: string;
  end_time: string;
  /** start = end on a FIXED shift: "This is a 24-hour duty" (sets `long_duty`). */
  long_duty: boolean;
  core_start_time: string;
  core_end_time: string;
  /** Expected work as h:mm (FLEXIBLE / OPEN). */
  expected: string;
  segments: SegmentRow[];
  breaks: BreakRow[];
  half_split_time: string;
  grace_in_minutes: string;
  grace_out_minutes: string;
  early_in_window_minutes: string;
  late_out_window_minutes: string;
  anchor_timezone: string;
  safety_critical: boolean;
  outdoor: boolean;
  effective_from: string;
  /** Version only: "Temporary — ends on". */
  temporary: boolean;
  effective_to: string;
  reason: string;
}

export const emptyBreak = (): BreakRow => ({
  kind: "LUNCH", mode: "FIXED_WINDOW", minutes: "60", paid: false, start: "13:00", end: "14:00",
  window_start: "", window_end: "", auto_deduct_after_minutes: "",
});

export function defaultValues(today: string): ShiftFormValues {
  return {
    code: "", name: "", kind: "FIXED", color_token: "shift-1", owner: "COMPANY", legal_entity_id: "", branch_id: "",
    description: "", start_time: "09:00", end_time: "18:00", long_duty: false, core_start_time: "", core_end_time: "",
    expected: "8:00", segments: [{ kind: "WORK", start: "08:00", end: "12:00" }, { kind: "WORK", start: "16:00", end: "20:00" }],
    breaks: [], half_split_time: "", grace_in_minutes: "", grace_out_minutes: "", early_in_window_minutes: "120",
    late_out_window_minutes: "240", anchor_timezone: "", safety_critical: false, outdoor: false,
    effective_from: today, temporary: false, effective_to: "", reason: "",
  };
}

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v));

/** Pre-fill the version fields from an existing version (version Modal, "copy of v"). */
export function valuesFromVersion(base: ShiftFormValues, kind: ShiftKind, v: ShiftVersion | null | undefined): ShiftFormValues {
  if (!v) return { ...base, kind };
  return {
    ...base,
    kind,
    start_time: v.start_time ?? "",
    end_time: v.end_time ?? "",
    long_duty: !!v.long_duty,
    core_start_time: v.core_start_time ?? "",
    core_end_time: v.core_end_time ?? "",
    expected: v.expected_net_minutes ? fmtMinutes(v.expected_net_minutes) : base.expected,
    segments: kind === "SPLIT" && v.segments?.length ? v.segments.map((s) => ({ kind: s.kind, start: s.start, end: s.end })) : base.segments,
    breaks: (v.break_rules ?? []).map((b) => ({
      kind: b.kind, mode: b.mode, minutes: str(b.minutes), paid: !!b.paid, start: b.start ?? "", end: b.end ?? "",
      window_start: b.window_start ?? "", window_end: b.window_end ?? "", auto_deduct_after_minutes: str(b.auto_deduct_after_minutes),
    })),
    half_split_time: v.half_split_time ?? "",
    grace_in_minutes: str(v.grace_in_minutes),
    grace_out_minutes: str(v.grace_out_minutes),
    early_in_window_minutes: str(v.early_in_window_minutes ?? 120),
    late_out_window_minutes: str(v.late_out_window_minutes ?? 240),
    anchor_timezone: v.anchor_timezone ?? "",
    safety_critical: !!v.safety_critical,
    outdoor: !!v.outdoor,
  };
}

/** Which part of the form is on screen: create (catalogue + version 1), catalogue edit, or a new version. */
export type ShiftSection = "create" | "catalogue" | "version";

const CODE = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;
const intIn = (text: string, low: number, high: number) => /^\d+$/.test(text.trim()) && Number(text) >= low && Number(text) <= high;

/** Client checks before the server's (live validation; the server stays the authority). */
export function validateShift(values: ShiftFormValues, section: ShiftSection, today: string): Record<string, string> {
  const e: Record<string, string> = {};
  if (section !== "version") {
    if (section === "create" && !CODE.test(values.code)) e.code = "Use 1–20 capital letters, digits, - or _, starting with a letter or digit.";
    if (!values.name.trim()) e.name = "Give the shift a name.";
    else if (values.name.trim().length > 100) e.name = "Use at most 100 characters.";
    if (section === "create" && values.owner === "ENTITY" && !values.legal_entity_id) e.legal_entity_id = "Choose the legal entity.";
    if (section === "create" && values.owner === "BRANCH" && !values.branch_id) e.branch_id = "Choose the branch.";
  }
  if (section === "catalogue") return e;

  const { kind } = values;
  if (kind !== "OPEN") {
    if (!isClock(values.start_time)) e.start_time = "Enter the start time.";
    if (!isClock(values.end_time)) e.end_time = "Enter the end time.";
  }
  if (isClock(values.start_time) && isClock(values.end_time) && values.start_time === values.end_time) {
    if (kind === "FIXED" && !values.long_duty) e.long_duty = "Confirm that this is a 24-hour duty, or change the end time.";
    if (kind !== "FIXED" && kind !== "OPEN") e.end_time = "The end time can't equal the start time.";
  }
  if (kind === "FLEXIBLE") {
    const core = [values.core_start_time, values.core_end_time];
    if (core.some(Boolean) && !core.every(isClock)) e.core_start_time = "Give both core times, or neither.";
  }
  if (kind === "FLEXIBLE" || kind === "OPEN") {
    const minutes = values.expected.trim() ? parseHours(values.expected) : null;
    if (values.expected.trim() && (minutes === null || minutes < 1 || minutes > 1440)) e.expected = "Enter hours as 8:00 or 7.5 (up to 24 hours).";
    if (kind === "OPEN" && !values.expected.trim()) e.expected = "Enter the hours to work, e.g. 8:00.";
  }
  if (kind === "SPLIT") {
    const work = values.segments.filter((s) => s.kind === "WORK");
    if (values.segments.length < 2 || values.segments.length > 4 || work.length < 2) e.segments = "A split shift has 2 to 4 work blocks.";
    else if (values.segments.some((s) => !isClock(s.start) || !isClock(s.end))) e.segments = "Enter a start and end for every block.";
  }
  values.breaks.forEach((b, i) => {
    if (!intIn(b.minutes, 1, 240)) e[`breaks.${i}`] = "Break minutes must be 1–240.";
    else if (b.mode === "FIXED_WINDOW" && (!isClock(b.start) || !isClock(b.end))) e[`breaks.${i}`] = "Enter the break's start and end.";
    else if (b.mode === "FLOATING_WINDOW" && (!isClock(b.window_start) || !isClock(b.window_end))) e[`breaks.${i}`] = "Enter the window the break can be taken in.";
  });
  if (values.breaks.length > 4) e.breaks = "Use at most 4 breaks.";
  for (const [field, high] of [["grace_in_minutes", 240], ["grace_out_minutes", 240], ["early_in_window_minutes", 720], ["late_out_window_minutes", 720]] as const) {
    if (values[field].trim() && !intIn(values[field], 0, high)) e[field] = `Enter whole minutes from 0 to ${high}.`;
  }
  if (values.half_split_time && !isClock(values.half_split_time)) e.half_split_time = "Enter a time such as 13:30.";
  if (!values.effective_from) e.effective_from = "Choose the date this starts.";
  else if (values.effective_from < today && !values.reason.trim()) e.reason = "Give a reason for a start date in the past.";
  if (section === "version" && values.temporary) {
    if (!values.effective_to) e.effective_to = "Choose the last day of the temporary change.";
    else if (values.effective_to < values.effective_from) e.effective_to = "The end date is before the start date.";
  }
  return e;
}

const intOrNull = (text: string) => (text.trim() === "" ? null : Number(text));

/** Form values → `VersionIn` (kind-dependent fields only; the server ignores nothing, so others are left out). */
export function toVersionBody(values: ShiftFormValues, section: ShiftSection): VersionBody {
  const { kind } = values;
  const timed = kind !== "OPEN";
  const start = timed ? values.start_time : null;
  const end = timed ? values.end_time : null;
  const overnight = !!start && !!end && isClock(start) && isClock(end) && crossesMidnight(start, end);
  const body: VersionBody = {
    effective_from: values.effective_from || null,
    effective_to: section === "version" && values.temporary ? values.effective_to || null : null,
    start_time: start,
    end_time: end,
    segments: kind === "SPLIT" ? values.segments.map((s) => ({ kind: s.kind, start: s.start, end: s.end })) : [],
    break_rules: values.breaks.map((b) => {
      const rule: ShiftBreakRule = { kind: b.kind, mode: b.mode, minutes: Number(b.minutes), paid: b.paid };
      const first = b.mode === "FIXED_WINDOW" ? b.start : b.mode === "FLOATING_WINDOW" ? b.window_start : "";
      if (b.mode === "FIXED_WINDOW") Object.assign(rule, { start: b.start, end: b.end });
      if (b.mode === "FLOATING_WINDOW") Object.assign(rule, { window_start: b.window_start, window_end: b.window_end });
      if (b.auto_deduct_after_minutes.trim()) rule.auto_deduct_after_minutes = Number(b.auto_deduct_after_minutes);
      // A break of a night shift that starts before the shift's start clock is on the next day (C: 01:30–03:30).
      if (overnight && isClock(first) && toMinutes(first) < toMinutes(start!)) rule.next_day = true;
      return rule;
    }),
    half_split_time: timed && values.half_split_time ? values.half_split_time : null,
    core_start_time: kind === "FLEXIBLE" && values.core_start_time ? values.core_start_time : null,
    core_end_time: kind === "FLEXIBLE" && values.core_end_time ? values.core_end_time : null,
    expected_net_minutes: (kind === "FLEXIBLE" || kind === "OPEN") && values.expected.trim() ? parseHours(values.expected) : null,
    grace_in_minutes: intOrNull(values.grace_in_minutes),
    grace_out_minutes: intOrNull(values.grace_out_minutes),
    early_in_window_minutes: intOrNull(values.early_in_window_minutes) ?? 120,
    late_out_window_minutes: intOrNull(values.late_out_window_minutes) ?? 240,
    anchor_timezone: timed && values.anchor_timezone.trim() ? values.anchor_timezone.trim() : null,
    safety_critical: values.safety_critical,
    outdoor: values.outdoor,
    long_duty: kind === "FIXED" && !!start && start === end && values.long_duty,
    reason: values.reason.trim() || null,
  };
  return body;
}

/** Gross / unpaid / net minutes of the form's day (the preview card; the server computes the binding numbers). */
export function previewMinutes(values: ShiftFormValues): { gross: number | null; unpaid: number; net: number | null } {
  const unpaid = values.breaks.filter((b) => !b.paid).reduce((sum, b) => sum + (Number(b.minutes) || 0), 0);
  if (values.kind === "OPEN") return { gross: null, unpaid, net: parseHours(values.expected) };
  let gross: number | null = null;
  if (values.kind === "SPLIT") {
    const rows = values.segments.filter((s) => s.kind === "WORK" && isClock(s.start) && isClock(s.end));
    gross = rows.length ? rows.reduce((sum, s) => sum + spanMinutes(s.start, s.end), 0) : null;
  } else if (isClock(values.start_time) && isClock(values.end_time)) {
    gross = spanMinutes(values.start_time, values.end_time);
  }
  if (values.kind === "FLEXIBLE") return { gross, unpaid, net: values.expected.trim() ? parseHours(values.expected) : null };
  return { gross, unpaid, net: gross === null ? null : Math.max(0, gross - unpaid) };
}

/* ------------------------------------------------------------------ versions */

export type VersionState = "IN_FORCE" | "SCHEDULED" | "ENDED" | "VOIDED";

export function versionState(v: Pick<ShiftVersion, "effective_from" | "effective_to" | "voided_at">, today: string): VersionState {
  if (v.voided_at) return "VOIDED";
  if (v.effective_from > today) return "SCHEDULED";
  if (v.effective_to && v.effective_to < today) return "ENDED";
  return "IN_FORCE";
}

export const VERSION_STATE_LABEL: Record<VersionState, string> = {
  IN_FORCE: "In force", SCHEDULED: "Scheduled", ENDED: "Ended", VOIDED: "Undone",
};

/** Net scheduled minutes of a version for the list (expected minutes, else gross − unpaid break). */
export function versionNetMinutes(v: ShiftVersion | null | undefined, kind?: string | null): number | null {
  if (!v) return null;
  if (v.expected_net_minutes) return v.expected_net_minutes;
  if (kind === "OPEN" || kind === "FLEXIBLE") return null;
  if (v.segments?.length) {
    const work = v.segments.filter((s) => s.kind === "WORK").reduce((sum, s) => sum + spanMinutes(s.start, s.end), 0);
    return Math.max(0, work - (v.unpaid_break_minutes ?? 0));
  }
  if (!isClock(v.start_time) || !isClock(v.end_time)) return null;
  return Math.max(0, spanMinutes(v.start_time, v.end_time) - (v.unpaid_break_minutes ?? 0));
}

/** "Lunch 60 unpaid 13:00–14:00" for the first break, "+1 more" for the rest. */
export function breaksSummary(rules: ShiftBreakRule[] | null | undefined, legacyUnpaid?: number | null): string {
  if (!rules?.length) return legacyUnpaid ? `Unpaid break ${legacyUnpaid} min` : "No breaks";
  const first = rules[0];
  const kind = BREAK_KINDS.find((k) => k.value === first.kind)?.label ?? first.kind;
  const window = first.start && first.end ? ` ${first.start}–${first.end}` : first.window_start && first.window_end ? ` ${first.window_start}–${first.window_end}` : "";
  return `${kind} ${first.minutes} ${first.paid ? "paid" : "unpaid"}${window}${rules.length > 1 ? ` +${rules.length - 1} more` : ""}`;
}

/** The calendar day after / before `date` (YYYY-MM-DD) without the device zone. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Today's date in a zone as YYYY-MM-DD. */
export function todayIn(zone: string | null | undefined, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * A version's clock times on `date` shown in the work zone (D-AS-38): an anchored shift (US-E1, 09:00–18:00 New
 * York) reads 19:30–04:30 (+1) in Asia/Kolkata on an EST date. `dayOffset` = days after `date` of the end.
 */
export function timesInZone(date: string, start: string, end: string, fromZone: string | null | undefined, toZone: string):
  { start: string; end: string; endDayOffset: number; startDayOffset: number } {
  if (!fromZone || fromZone === toZone) {
    return { start, end, startDayOffset: 0, endDayOffset: crossesMidnight(start, end) ? 1 : 0 };
  }
  const startUtc = Date.parse(zonedIso(date, start, fromZone));
  const endUtc = Date.parse(zonedIso(crossesMidnight(start, end) ? addDays(date, 1) : date, end, fromZone));
  const wall = (utc: number) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: toZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(utc));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
  };
  const s = wall(startUtc);
  const e = wall(endUtc);
  const offset = (day: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
  return { start: s.time, end: e.time, startDayOffset: offset(s.day), endDayOffset: offset(e.day) };
}

/* ------------------------------------------------------------------ assignment rules */

export const PRIORITY_BANDS: { value: number; label: string }[] = [
  { value: 1000, label: "Employee" }, { value: 800, label: "Team" }, { value: 600, label: "Department / job role" },
  { value: 400, label: "Branch / entity" }, { value: 0, label: "Default" },
];

/** "Employee band", "Between Branch / entity and Department / job role", … (higher wins, D-AS-85). */
export function priorityBand(priority: number): string {
  const exact = PRIORITY_BANDS.find((b) => b.value === priority);
  if (exact) return exact.label;
  const above = [...PRIORITY_BANDS].reverse().find((b) => b.value > priority);
  const below = PRIORITY_BANDS.find((b) => b.value < priority);
  if (above && below) return `Between ${below.label} and ${above.label}`;
  return above ? `Below ${above.label}` : `Above ${below?.label ?? "Employee"}`;
}

export type CriteriaDimension = "everyone" | "branch_ids" | "legal_entity_ids" | "department_ids" | "employee_ids";

export const CRITERIA_DIMENSIONS: { value: CriteriaDimension; label: string }[] = [
  { value: "everyone", label: "Everyone" }, { value: "branch_ids", label: "Branches" },
  { value: "legal_entity_ids", label: "Legal entities" }, { value: "department_ids", label: "Departments" },
  { value: "employee_ids", label: "Employees" },
];

const DIMENSION_LABEL: Record<string, string> = {
  legal_entity_ids: "Entity", branch_ids: "Branch", pay_group_ids: "Pay group", department_ids: "Department",
  grade_ids: "Grade", employment_types: "Employment type", designation_ids: "Job role", employee_ids: "Employee",
};

/** Criteria as chip texts ("Branch: Pune Plant"); `name` resolves ids per dimension when known. */
export function criteriaChips(criteria: ShiftRuleCriteria | null | undefined,
  name: (dimension: string, id: number | string) => string | undefined = () => undefined): string[] {
  if (!criteria || criteria.everyone || !Object.entries(criteria).some(([k, v]) => k !== "everyone" && Array.isArray(v) && v.length)) {
    return ["Everyone"];
  }
  const out: string[] = [];
  for (const [key, value] of Object.entries(criteria)) {
    if (key === "everyone" || !Array.isArray(value)) continue;
    for (const item of value) out.push(`${DIMENSION_LABEL[key] ?? key}: ${name(key, item) ?? (typeof item === "number" ? `#${item}` : item)}`);
  }
  return out;
}

/* ------------------------------------------------------------------ explain */

const LOSS_REASON: Record<string, string> = {
  LOWER_PRIORITY: "lost to a higher-priority rule",
  OWNER_SCOPE_MISMATCH: "skipped: the shift belongs to another unit",
  AMBIGUOUS: "skipped: another rule has the same priority",
  SHIFT_MISSING: "skipped: the shift was not found",
  RULE_WINS: "not used: a rule wins over the placement",
  NO_VERSION_ON_DATE: "not used: the shift has no version on this date",
};

export const lossReason = (code: string | null | undefined) => (code ? LOSS_REASON[code] ?? code.replace(/_/g, " ").toLowerCase() : "not used");

/** "Rule (priority 500) over placement" — the winning step and the steps it beat (§11.4). */
export function explainSummary(day: { source: string; candidates: { step: string; won: boolean; priority?: number }[] }): string {
  if (day.source === "NONE") return "No shift applies";
  const winner = day.candidates.find((c) => c.won);
  const label = (step: string, priority?: number) =>
    step === "RULE" ? `rule${priority !== undefined ? ` (priority ${priority})` : ""}` : step === "PLACEMENT" ? "placement" : step === "ROSTER" ? "roster" : step.toLowerCase();
  const head = winner ? label(winner.step, winner.priority) : label(day.source);
  const losers = Array.from(new Set(day.candidates.filter((c) => !c.won).map((c) => label(c.step, c.priority))));
  const text = losers.length ? `${head} over ${losers.join(", ")}` : head;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
