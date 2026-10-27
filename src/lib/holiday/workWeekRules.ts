/**
 * Form state of the work-week editor and its conversion to and from the rules JSON (LH 04-holiday/03 §3.2, §5.10).
 * Pure functions: the server stays the validator (V-1..V-9); these only shape what the form shows and sends.
 */

import type { CycleRules, HalfPortion, Kind, Rules, WeeklyRules } from "./api";

export type DayMode = "WORKING" | "HALF" | "OFF";

export interface WeekdayState {
  mode: DayMode;
  /** WORKING days: occurrences that are full offs ("Also off on 2nd, 4th"). */
  extraOff: number[];
  /** HALF days: which half is off. */
  portion: HalfPortion;
  /** HALF days: only these occurrences ([] = every week). */
  halfNth: number[];
}

/** A cycle day: W work, O off, F morning off, S afternoon off. */
export type CycleCell = "W" | "O" | "F" | "S";

export interface CycleState {
  length: number;
  anchor: string;
  cells: CycleCell[];
}

export interface EditorRules {
  kind: Kind;
  weekdays: WeekdayState[];
  cycle: CycleState;
  /** null = every full off is a rest day (the default). */
  restDays: number[] | null;
}

export const MIN_CYCLE = 2;
export const MAX_CYCLE = 56;

const working = (): WeekdayState => ({ mode: "WORKING", extraOff: [], portion: "SECOND_HALF", halfNth: [] });

/** The first Monday on or after `iso` (the default cycle anchor, §5.10). */
export function nextMonday(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const shift = (8 - d.getUTCDay()) % 7; // getUTCDay: 0 = Sunday, 1 = Monday
  d.setUTCDate(d.getUTCDate() + shift);
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function defaultEditor(today: string): EditorRules {
  const weekdays = Array.from({ length: 7 }, working);
  weekdays[5] = { ...working(), mode: "OFF" };
  weekdays[6] = { ...working(), mode: "OFF" };
  return { kind: "WEEKLY", weekdays, cycle: { length: 14, anchor: nextMonday(today), cells: Array(14).fill("W") }, restDays: null };
}

const sortNth = (values: number[]) => [...values].sort((a, b) => (a === -1 ? 6 : a) - (b === -1 ? 6 : b));

export function fromRules(rules: Rules, today: string): EditorRules {
  const base = defaultEditor(today);
  if (rules.kind === "CYCLE") {
    const cells: CycleCell[] = Array(rules.cycle_length_days).fill("W");
    rules.cycle_off_days.forEach((d) => (cells[d] = "O"));
    (rules.half_day_offs ?? []).forEach((h) => (cells[h.cycle_day] = h.portion === "FIRST_HALF" ? "F" : "S"));
    return { kind: "CYCLE", weekdays: base.weekdays, cycle: { length: rules.cycle_length_days, anchor: rules.anchor_date, cells }, restDays: rules.rest_days ?? null };
  }
  const weekdays = Array.from({ length: 7 }, working);
  rules.weekly_off_days.forEach((d) => (weekdays[d] = { ...working(), mode: "OFF" }));
  rules.nth_weekday_offs.forEach((r) => (weekdays[r.weekday] = { ...weekdays[r.weekday], extraOff: sortNth(r.nth) }));
  (rules.half_day_offs ?? []).forEach((h) => {
    weekdays[h.weekday] = { ...weekdays[h.weekday], mode: "HALF", portion: h.portion, halfNth: sortNth(h.nth ?? []) };
  });
  return { kind: "WEEKLY", weekdays, cycle: base.cycle, restDays: rules.rest_days ?? null };
}

export function toRules(state: EditorRules): Rules {
  const rest = state.restDays && state.restDays.length ? { rest_days: [...state.restDays].sort((a, b) => a - b) } : {};
  if (state.kind === "CYCLE") {
    const cells = state.cycle.cells.slice(0, state.cycle.length);
    const half = cells
      .map((c, i) => (c === "F" || c === "S" ? { cycle_day: i, portion: (c === "F" ? "FIRST_HALF" : "SECOND_HALF") as HalfPortion } : null))
      .filter((h): h is { cycle_day: number; portion: HalfPortion } => h !== null);
    const rules: CycleRules = {
      kind: "CYCLE",
      cycle_length_days: state.cycle.length,
      anchor_date: state.cycle.anchor,
      cycle_off_days: cells.map((c, i) => (c === "O" ? i : -1)).filter((i) => i >= 0),
      ...(half.length ? { half_day_offs: half } : {}),
      ...rest,
    };
    return rules;
  }
  const off = state.weekdays.map((d, i) => (d.mode === "OFF" ? i : -1)).filter((i) => i >= 0);
  const nth = state.weekdays
    .map((d, i) => (d.mode !== "OFF" && d.extraOff.length ? { weekday: i, nth: sortNth(d.extraOff) } : null))
    .filter((r): r is { weekday: number; nth: number[] } => r !== null);
  const half = state.weekdays
    .map((d, i) => (d.mode === "HALF" ? { weekday: i, portion: d.portion, ...(d.halfNth.length ? { nth: sortNth(d.halfNth) } : {}) } : null))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const rules: WeeklyRules = {
    ...(half.length || state.restDays?.length ? { kind: "WEEKLY" as const } : {}),
    weekly_off_days: off,
    nth_weekday_offs: nth,
    ...(half.length ? { half_day_offs: half } : {}),
    ...rest,
  };
  return rules;
}

/** Half-day offs anywhere in the form (gated until LH-M5b). */
export function usesHalfDays(state: EditorRules): boolean {
  return state.kind === "CYCLE" ? state.cycle.cells.some((c) => c === "F" || c === "S") : state.weekdays.some((d) => d.mode === "HALF");
}

/** Messages the form can show before asking the server (the server still decides). */
export function localProblems(state: EditorRules): string[] {
  const out: string[] = [];
  if (state.kind === "WEEKLY") {
    if (state.weekdays.every((d) => d.mode === "OFF")) out.push("A work week needs at least one working day.");
  } else {
    if (!Number.isInteger(state.cycle.length) || state.cycle.length < MIN_CYCLE || state.cycle.length > MAX_CYCLE)
      out.push(`A cycle is ${MIN_CYCLE}–${MAX_CYCLE} days long.`);
    if (!state.cycle.anchor) out.push("Choose the anchor date of cycle day 1.");
    if (state.cycle.cells.slice(0, state.cycle.length).every((c) => c === "O")) out.push("A cycle needs at least one working day.");
  }
  return out;
}

/** Full offs that may be rest days: weekdays (always off or off on some occurrences) or cycle days. */
export function restCandidates(state: EditorRules): number[] {
  if (state.kind === "CYCLE") return state.cycle.cells.slice(0, state.cycle.length).map((c, i) => (c === "O" ? i : -1)).filter((i) => i >= 0);
  return state.weekdays.map((d, i) => (d.mode === "OFF" || d.extraOff.length ? i : -1)).filter((i) => i >= 0);
}

/** Resize a cycle, keeping existing cells and filling new ones with W. */
export function resizeCycle(cycle: CycleState, length: number): CycleState {
  const cells = Array.from({ length: Math.max(0, length) }, (_, i) => cycle.cells[i] ?? "W");
  return { ...cycle, length, cells };
}

/** Upper snake code from a name (§5.10 "Code: from name"). */
export function codeFromName(name: string): string {
  return (
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30)
      .replace(/_+$/, "") || ""
  );
}

/** First and last date of a YYYY-MM month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
