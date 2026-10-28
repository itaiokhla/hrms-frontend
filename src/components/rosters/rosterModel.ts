/**
 * Pure helpers of the roster screens (AS-M5 WI-AS-5.5; 03-shifts/02 §4-§6, §13): the period's dates, the cell map
 * built from published entries and drafts, unsaved grid edits and their `DraftCellIn` bodies, cell labels, rule
 * results per cell, refusal wording and My schedule times. No React here, so all of it is unit-tested.
 */

import { addDays, timesInZone } from "@/components/shifts/shiftModel";

import type { DraftCellBody, EntryKind, RosterDraft, RosterEntry, RuleResult, ScheduleDay } from "./api";

/** A roster period covers at most this many days (backend MAX_PERIOD_DAYS). */
export const MAX_PERIOD_DAYS = 62;

/* ------------------------------------------------------------------ dates */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const utc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

/** Every date of the period, both ends included (YYYY-MM-DD, no device zone). */
export function periodDates(start: string, end: string): string[] {
  const out: string[] = [];
  for (let day = start; day <= end && out.length <= 366; day = addDays(day, 1)) out.push(day);
  return out;
}

/** Days from `start` to `end`, both included. */
export const daySpan = (start: string, end: string) => Math.round((utc(end).getTime() - utc(start).getTime()) / 86400000) + 1;

export const isWeekend = (date: string) => [0, 6].includes(utc(date).getUTCDay());

/** "Mon 2 Nov 2026" (cell labels, result dates). */
export function dateLabel(date: string): string {
  const d = utc(date);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Column header parts: "Mon" over "2 Nov". */
export function dayHeader(date: string): { weekday: string; day: string } {
  const d = utc(date);
  return { weekday: WEEKDAYS[d.getUTCDay()], day: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` };
}

/* ------------------------------------------------------------------ cells */

export const cellKey = (employeeId: number, date: string) => `${employeeId}|${date}`;

/** What a palette chip puts in a cell: a shift, a day off, or Clear (withdraw / drop the entry). */
export type PaletteValue = { kind: "WORK"; shiftId: number } | { kind: "OFF" } | { kind: "CLEAR" };

/**
 * One grid cell (entry 1 of the date): PUBLISHED solid, DRAFT saved but not published, PENDING an unsaved edit of
 * this screen, EMPTY nothing at all. `kind` null with DRAFT / PENDING = the entry is being removed.
 */
export interface Cell {
  kind: EntryKind | null;
  shiftId: number | null;
  status: "PUBLISHED" | "DRAFT" | "PENDING" | "EMPTY";
  /** Further published entries on the date (split days, entry_seq 2-3). */
  extra: number;
}

export const EMPTY_CELL: Cell = { kind: null, shiftId: null, status: "EMPTY", extra: 0 };

/** Published entries, then drafts on top (a DELETE draft empties the cell but stays visible as a draft). */
export function buildCells(entries: RosterEntry[], drafts: RosterDraft[]): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  for (const e of entries) {
    const key = cellKey(e.employee_id, e.shift_date);
    const cell = cells.get(key) ?? { ...EMPTY_CELL };
    if (e.entry_seq === 1) cells.set(key, { ...cell, kind: e.kind, shiftId: e.shift_id, status: "PUBLISHED" });
    else cells.set(key, { ...cell, extra: cell.extra + 1 });
  }
  for (const d of drafts) {
    if (d.entry_seq !== 1) continue;
    const key = cellKey(d.employee_id, d.shift_date);
    const cell = cells.get(key) ?? { ...EMPTY_CELL };
    const removed = d.action === "DELETE";
    cells.set(key, { ...cell, kind: removed ? null : d.kind, shiftId: removed || d.kind !== "WORK" ? null : d.shift_id,
      status: "DRAFT", extra: d.kind === "OFF" ? 0 : cell.extra });
  }
  return cells;
}

/** The cells with this screen's unsaved edits on top. */
export function applyPending(cells: Map<string, Cell>, pending: Map<string, PaletteValue>): Map<string, Cell> {
  if (pending.size === 0) return cells;
  const out = new Map(cells);
  pending.forEach((value, key) => {
    const cell = out.get(key) ?? EMPTY_CELL;
    out.set(key, {
      kind: value.kind === "CLEAR" ? null : value.kind,
      shiftId: value.kind === "WORK" ? value.shiftId : null,
      status: "PENDING",
      extra: value.kind === "OFF" ? 0 : cell.extra,
    });
  });
  return out;
}

/** A new pending map with `value` in the cell (immutable, so React sees the change). */
export function withPending(pending: Map<string, PaletteValue>, employeeId: number, date: string,
  value: PaletteValue): Map<string, PaletteValue> {
  const next = new Map(pending);
  next.set(cellKey(employeeId, date), value);
  return next;
}

/** `PUT /rosters/{id}/drafts` cells of the unsaved edits, ordered by employee then date. */
export function toDraftCells(pending: Map<string, PaletteValue>): DraftCellBody[] {
  return [...pending.entries()]
    .map(([key, value]) => {
      const [id, date] = key.split("|");
      const base = { employee_id: Number(id), shift_date: date, entry_seq: 1 };
      if (value.kind === "CLEAR") return { ...base, action: "DELETE" as const };
      if (value.kind === "OFF") return { ...base, action: "UPSERT" as const, kind: "OFF" as const };
      return { ...base, action: "UPSERT" as const, kind: "WORK" as const, shift_id: value.shiftId };
    })
    .sort((a, b) => a.employee_id - b.employee_id || a.shift_date.localeCompare(b.shift_date));
}

/* ------------------------------------------------------------------ palette drag payload */

export const DRAG_TYPE = "text/plain";

export const paletteKey = (value: PaletteValue) =>
  value.kind === "WORK" ? `shift:${value.shiftId}` : value.kind === "OFF" ? "off" : "clear";

export function parsePaletteKey(raw: string | null | undefined): PaletteValue | null {
  if (raw === "off") return { kind: "OFF" };
  if (raw === "clear") return { kind: "CLEAR" };
  const match = /^shift:(\d+)$/.exec(raw ?? "");
  return match ? { kind: "WORK", shiftId: Number(match[1]) } : null;
}

/* ------------------------------------------------------------------ labels */

/** What the cell shows: the shift code, "Off", or "No shift". */
export function cellText(cell: Cell, codeOf: (shiftId: number) => string | undefined): string {
  if (cell.kind === "OFF") return "Off";
  if (cell.kind === "WORK") return cell.shiftId ? codeOf(cell.shiftId) ?? `#${cell.shiftId}` : "Work";
  return "No shift";
}

/**
 * The cell button's accessible name: "Asha Rao, Mon 2 Nov 2026: M1", then " (draft)" or " (unsaved)" when the cell
 * is not published yet, then ", 1 issue" / ", 2 issues" when validation flagged the cell.
 */
export function cellLabel(employeeName: string, date: string, cell: Cell, codeOf: (shiftId: number) => string | undefined,
  issues = 0): string {
  const state = cell.status === "DRAFT" ? " (draft)" : cell.status === "PENDING" ? " (unsaved)" : "";
  const flagged = issues > 0 ? `, ${issues} ${issues === 1 ? "issue" : "issues"}` : "";
  return `${employeeName}, ${dateLabel(date)}: ${cellText(cell, codeOf)}${state}${flagged}`;
}

/* ------------------------------------------------------------------ rule results */

/** Rule results per cell: each (employee, date) of a result's `dates`. */
export function resultsByCell(results: RuleResult[] | null | undefined): Map<string, RuleResult[]> {
  const out = new Map<string, RuleResult[]>();
  for (const r of results ?? []) {
    if (r.employee_id == null) continue;
    for (const date of r.dates ?? []) {
      const key = cellKey(r.employee_id, String(date).slice(0, 10));
      out.set(key, [...(out.get(key) ?? []), r]);
    }
  }
  return out;
}

/** Plain names of the rule keys of 03-shifts/02 §6.2 (unknown keys read as "Some rule key"). */
export const RULE_LABELS: Record<string, string> = {
  MIN_REST_VIOLATION: "Too little rest between shifts",
  WEEKLY_REST_HOURS: "Too little weekly rest",
  WEEKLY_REST_EXCEEDED: "Too many working days in a row",
  SHIFT_OVERLAP: "Shifts overlap",
  NOT_EMPLOYED: "Not employed on this date",
  ENTRY_OUT_OF_PLACEMENT: "No longer in this team or branch",
  SHIFT_ARCHIVED: "Shift is archived",
  BACKDATE_LIMIT: "Date is too far in the past",
  PERIOD_LOCKED: "Payroll period is locked",
  ROSTER_AFFECTS_APPROVED_LEAVE: "Changes approved leave",
  HOLIDAY_WORK: "Work on a holiday",
  DAILY_HOURS_EXCEEDED: "Too many hours in a day",
  SPREAD_OVER_EXCEEDED: "Day spread too long",
  WEEKLY_HOURS_EXCEEDED: "Too many hours in a week",
  CONTINUOUS_WORK_EXCEEDED: "Too long without a break",
  OT_CAP_PROJECTED: "Overtime cap reached",
  NIGHT_WORK_CONSENT_MISSING: "Night work consent missing",
  MIN_WOMEN_NIGHT_SHIFT: "Too few co-workers on a night shift",
  ADOLESCENT_LIMITS: "Young worker limits",
  NOTICE_PERIOD_SHORT: "Short notice",
  LATE_ADDITION_NO_CONSENT: "Late addition without consent",
  CANCELLATION_INSIDE_NOTICE: "Cancelled inside the notice period",
  ON_CALL_NOT_ALLOWED: "On-call not allowed",
  COVERAGE_BELOW_MINIMUM: "Not enough people on a shift",
  UNAVAILABLE: "Employee marked unavailable",
  TAG_MISSING: "Missing required skill",
  TAG_EXPIRED: "Required skill expired",
};

export function ruleLabel(key: string | null | undefined): string {
  if (!key) return "Rule";
  return RULE_LABELS[key] ?? key.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export const SEVERITY_LABELS: Record<string, string> = { BLOCK: "Blocks publishing", REQUIRE_REASON: "Needs a reason", WARN: "Warning" };
export const severityLabel = (severity: string | null | undefined) => SEVERITY_LABELS[severity ?? ""] ?? severity ?? "—";

/** "11 h measured, limit 11 h" style line of a result (measured vs limit, with the unit when given). */
export function measuredText(r: Pick<RuleResult, "measured" | "limit" | "unit">): string | null {
  const unit = r.unit ? ` ${String(r.unit).toLowerCase()}` : "";
  const has = (v: unknown) => v !== null && v !== undefined && v !== "";
  if (!has(r.measured) && !has(r.limit)) return null;
  if (!has(r.limit)) return `Measured ${r.measured}${unit}`;
  if (!has(r.measured)) return `Limit ${r.limit}${unit}`;
  return `Measured ${r.measured}${unit} vs limit ${r.limit}${unit}`;
}

/** Distinct rule keys of one severity, in first-seen order (one acknowledgement / reason per key, §6.1). */
export function keysOf(results: RuleResult[] | null | undefined, severity: string): string[] {
  return [...new Set((results ?? []).filter((r) => r.severity === severity).map((r) => r.rule_key).filter(Boolean))];
}

/** The refusal code a real publish returns for these blocking results (mirrors `shift_rosters._gate`). */
export function blockingCode(blocking: RuleResult[] | null | undefined): string | null {
  if (!blocking?.length) return null;
  return blocking.some((r) => r.rule_key === "MIN_REST_VIOLATION" || r.rule_key === "WEEKLY_REST_HOURS")
    ? "INSUFFICIENT_REST_HOURS" : "ROSTER_RULE_VIOLATION";
}

/** Plain wording for the refusal codes a planner can meet (shown above the issues list). */
export const ROSTER_ERROR_TEXT: Record<string, string> = {
  INSUFFICIENT_REST_HOURS: "Too little rest between shifts. Change the flagged cells before publishing.",
  ROSTER_RULE_VIOLATION: "The roster breaks a working-time rule. Change the flagged cells before publishing.",
  WARNINGS_UNACKNOWLEDGED: "Acknowledge every warning before publishing.",
  ROSTER_REASON_REQUIRED: "Give a reason for each flagged rule before publishing.",
  ROSTER_STALE_DRAFT: "Some cells were changed by someone else after you drafted them. Reload the grid and check them again.",
  ROW_VERSION_CONFLICT: "Someone else changed this roster. Reload and try again.",
  ROSTER_PERIOD_TOO_LONG: `A roster period covers at most ${MAX_PERIOD_DAYS} days.`,
  ROSTER_PERIOD_OVERLAP: "Another roster period of this branch already covers these dates.",
  CONFLICT: "Another roster period already uses this code.",
  ROSTER_CELL_IN_OTHER_PERIOD: "A cell belongs to another roster period.",
  ROSTER_PUBLISH_TOO_LARGE: "Too many entries to publish at once.",
  SHIFT_ARCHIVED: "A chosen shift is archived. Pick another shift.",
  INVALID_TRANSITION: "This roster period is closed for changes.",
  TOO_MANY_ITEMS: "Save at most 500 cells at a time.",
  LOCK_TIMEOUT: "Someone else is saving the same people. Try again in a moment.",
};

/* ------------------------------------------------------------------ new period */

export interface PeriodValues {
  code: string;
  name: string;
  branch_id: string;
  start_date: string;
  end_date: string;
}

/** Client checks of the New period form (the API checks again). */
export function validatePeriod(v: PeriodValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!v.code.trim()) errors.code = "Enter a code.";
  else if (v.code.trim().length > 40) errors.code = "Use at most 40 characters.";
  if (!v.name.trim()) errors.name = "Give the period a name.";
  if (!v.branch_id) errors.branch_id = "Choose the branch this period plans.";
  if (!v.start_date) errors.start_date = "Choose the first day.";
  if (!v.end_date) errors.end_date = "Choose the last day.";
  if (v.start_date && v.end_date) {
    if (v.end_date < v.start_date) errors.end_date = "The last day can't be before the first day.";
    else if (daySpan(v.start_date, v.end_date) > MAX_PERIOD_DAYS) errors.end_date = `A period covers at most ${MAX_PERIOD_DAYS} days.`;
  }
  return errors;
}

/* ------------------------------------------------------------------ my schedule */

/** "09:00–17:00", "22:00–06:00 (+1)" in the work zone (an anchored shift converted, D-AS-38); null without times. */
export function scheduleTimes(day: Pick<ScheduleDay, "date" | "start_time" | "end_time" | "anchor_timezone" | "work_timezone">,
  fallbackZone: string): string | null {
  if (!day.start_time || !day.end_time) return null;
  const zone = day.work_timezone || fallbackZone;
  const t = timesInZone(day.date, day.start_time, day.end_time, day.anchor_timezone, zone);
  const start = t.startDayOffset !== 0 ? `${t.start} (${t.startDayOffset > 0 ? "+" : ""}${t.startDayOffset})` : t.start;
  return `${start}–${t.end}${t.endDayOffset > 0 ? ` (+${t.endDayOffset})` : ""}`;
}

/** What one My schedule day shows: the shift code, "Off", or "No shift". */
export function scheduleText(day: Pick<ScheduleDay, "kind" | "shift_code" | "shift_id">): string {
  if (day.kind === "OFF") return "Off";
  if (day.shift_id) return day.shift_code ?? `Shift #${day.shift_id}`;
  return "No shift";
}
