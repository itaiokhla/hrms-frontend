/**
 * Pure helpers of the rotation pages (A16; 03-shifts/02 §2-§3): the draft editor's values, crew rows, client checks
 * that mirror `rotation_engine.validate_pattern` (the API checks again and has the last word), and plain labels.
 */

import type {
  AutoPublishRun, RotationTemplate, RotationVersion, RotationVersionBody, TokenTarget,
} from "@/components/rosters/api";

export const OFF_TOKEN = "O";
export const MAX_CYCLE_DAYS = 366;
const TOKEN_CHARS = /^[A-Z0-9]*$/;

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Base row + per-crew offsets (Panama, DuPont, 6-on-2-off) or one explicit row per crew (Pitman, 7-on-7-off). */
export type RowMode = "BASE" | "ROWS";

export interface CrewOffset { code: string; offset: string }
export interface CrewRow { code: string; row: string }

/** The draft editor's controlled values (strings while typing; `draftBody` turns them into the API body). */
export interface DraftValues {
  mode: RowMode;
  tokens: string;
  crewOffsets: CrewOffset[];
  crewRows: CrewRow[];
  /** token → "" (not chosen) | "OFF" | shift id. */
  tokenMap: Record<string, string>;
  coverage: Record<string, number>;
  weekAnchorWeekday: string;
  lintsMuted: string[];
}

type VersionLike = Pick<RotationVersion, "tokens" | "crew_rows" | "crew_offsets" | "token_map" | "coverage"
  | "week_anchor_weekday" | "lints_muted">;

const mapToForm = (map: Record<string, TokenTarget> | null | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(map ?? {}).map(([token, target]) => [
    token, target === "OFF" ? "OFF" : typeof target === "object" && target ? String(target.shift_id) : ""]));

export function draftFromVersion(v: VersionLike): DraftValues {
  const rows = v.crew_rows && Object.keys(v.crew_rows).length ? v.crew_rows : null;
  return {
    mode: rows ? "ROWS" : "BASE",
    tokens: v.tokens ?? "",
    crewOffsets: rows ? [] : Object.entries(v.crew_offsets ?? {}).map(([code, offset]) => ({ code, offset: String(offset) })),
    crewRows: rows ? Object.entries(rows).map(([code, row]) => ({ code, row })) : [],
    tokenMap: mapToForm(v.token_map),
    coverage: { ...(v.coverage ?? {}) },
    weekAnchorWeekday: v.week_anchor_weekday == null ? "" : String(v.week_anchor_weekday),
    lintsMuted: [...(v.lints_muted ?? [])],
  };
}

/** A template copied on use (§2.4): its rows, offsets and coverage; the token map starts empty. */
export function draftFromTemplate(t: RotationTemplate): DraftValues {
  return draftFromVersion({ tokens: t.tokens, crew_rows: t.crew_rows, crew_offsets: t.crew_offsets, token_map: {},
    coverage: t.coverage, week_anchor_weekday: t.week_anchor_weekday, lints_muted: [] });
}

/** A scratch pattern: one crew, a 7-day week of a general shift and a Sunday off. */
export function blankDraft(): DraftValues {
  return { mode: "BASE", tokens: "GGGGGGO", crewOffsets: [{ code: "A", offset: "0" }], crewRows: [], tokenMap: {},
    coverage: {}, weekAnchorWeekday: "0", lintsMuted: [] };
}

export const cleanTokens = (value: string) => value.toUpperCase().replace(/\s+/g, "");

/** Cycle length L: the base row's length, or the first crew row's. */
export function cycleLength(d: DraftValues): number {
  return d.mode === "BASE" ? d.tokens.length : d.crewRows[0]?.row.length ?? 0;
}

/** Distinct non-OFF tokens of the rows, in first-seen order (each needs a shift or "OFF" in the token map). */
export function usedTokens(d: DraftValues): string[] {
  const rows = d.mode === "BASE" ? [d.tokens] : d.crewRows.map((r) => r.row);
  const seen: string[] = [];
  for (const row of rows) for (const t of row) if (t !== OFF_TOKEN && !seen.includes(t)) seen.push(t);
  return seen;
}

/** Crew c's tokens over one cycle: `tokens[(i + offset) mod L]` (base row, §2.1) or its own row. */
export function crewRow(d: DraftValues, code: string): string {
  if (d.mode === "ROWS") return d.crewRows.find((r) => r.code === code)?.row ?? "";
  const length = d.tokens.length;
  const offset = Number(d.crewOffsets.find((c) => c.code === code)?.offset ?? 0);
  if (!length || !Number.isInteger(offset)) return d.tokens;
  return Array.from({ length }, (_, i) => d.tokens[(((i + offset) % length) + length) % length]).join("");
}

export function crewCodes(d: DraftValues): string[] {
  return d.mode === "ROWS" ? d.crewRows.map((r) => r.code) : d.crewOffsets.map((c) => c.code);
}

/** Crew codes and offsets of a saved version (the assignment form's crew picker). */
export function versionCrews(v: Pick<RotationVersion, "crew_rows" | "crew_offsets">): { code: string; offset: number }[] {
  if (v.crew_rows && Object.keys(v.crew_rows).length) return Object.keys(v.crew_rows).map((code) => ({ code, offset: 0 }));
  return Object.entries(v.crew_offsets ?? {}).map(([code, offset]) => ({ code, offset: Number(offset) || 0 }));
}

/** Switch representation: rows are the shifted base row per crew; back again, the first row with offsets 0. */
export function switchMode(d: DraftValues, mode: RowMode): DraftValues {
  if (mode === d.mode) return d;
  if (mode === "ROWS") {
    const codes = d.crewOffsets.length ? d.crewOffsets.map((c) => c.code) : ["A"];
    return { ...d, mode, crewRows: codes.map((code) => ({ code, row: crewRow(d, code) })), crewOffsets: [] };
  }
  return { ...d, mode, tokens: d.crewRows[0]?.row ?? "", crewRows: [],
    crewOffsets: d.crewRows.map((r) => ({ code: r.code, offset: "0" })) };
}

/** Client checks before a save (§2.2 ROW_LENGTH, MODE, TOKEN_UNMAPPED, OFFSET_RANGE; the API checks coverage too). */
export function validateDraft(d: DraftValues): Record<string, string> {
  const errors: Record<string, string> = {};
  const length = cycleLength(d);
  if (d.mode === "BASE") {
    if (!d.tokens) errors.tokens = "Enter one letter per day of the cycle.";
    else if (!TOKEN_CHARS.test(d.tokens)) errors.tokens = "Use only letters A–Z and digits 0–9.";
    else if (d.tokens.length > MAX_CYCLE_DAYS) errors.tokens = `A cycle has at most ${MAX_CYCLE_DAYS} days.`;
    const codes = new Set<string>();
    d.crewOffsets.forEach((c, n) => {
      const offset = Number(c.offset);
      if (!c.code.trim()) errors[`crew-${n}`] = "Give the crew a code.";
      else if (codes.has(c.code)) errors[`crew-${n}`] = "Each crew needs its own code.";
      else if (c.offset === "" || !Number.isInteger(offset) || offset < 0 || (length && offset >= length)) {
        errors[`crew-${n}`] = `Offset must be a whole number from 0 to ${Math.max(length - 1, 0)}.`;
      }
      codes.add(c.code);
    });
  } else {
    if (!d.crewRows.length) errors.rows = "Add at least one crew row.";
    const codes = new Set<string>();
    d.crewRows.forEach((r, n) => {
      if (!r.code.trim()) errors[`row-${n}`] = "Give the crew a code.";
      else if (codes.has(r.code)) errors[`row-${n}`] = "Each crew needs its own code.";
      else if (!r.row) errors[`row-${n}`] = "Enter one letter per day of the cycle.";
      else if (!TOKEN_CHARS.test(r.row)) errors[`row-${n}`] = "Use only letters A–Z and digits 0–9.";
      else if (r.row.length !== length) errors[`row-${n}`] = `Every row needs the same length (${length} days).`;
      codes.add(r.code);
    });
  }
  for (const token of usedTokens(d)) {
    if (!d.tokenMap[token]) errors[`map-${token}`] = `Choose what ${token} means.`;
  }
  return errors;
}

/** The API body of a save (a new DRAFT version). */
export function draftBody(d: DraftValues): RotationVersionBody {
  const tokenMap: Record<string, TokenTarget> = {};
  for (const token of usedTokens(d)) {
    const value = d.tokenMap[token];
    if (value) tokenMap[token] = value === "OFF" ? "OFF" : { shift_id: Number(value) };
  }
  const base = d.mode === "BASE";
  return {
    cycle_days: cycleLength(d),
    tokens: base ? d.tokens : null,
    crew_rows: base ? null : Object.fromEntries(d.crewRows.map((r) => [r.code.trim(), r.row])),
    crew_offsets: base ? Object.fromEntries(d.crewOffsets.map((c) => [c.code.trim(), Number(c.offset)])) : {},
    token_map: tokenMap,
    coverage: d.coverage,
    week_anchor_weekday: d.weekAnchorWeekday === "" ? null : Number(d.weekAnchorWeekday),
    lints_muted: d.lintsMuted,
  };
}

/* ------------------------------------------------------------------ labels */

export const VERSION_STATUS: Record<string, { label: string; tone: "neutral" | "success" | "info" }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  ACTIVE: { label: "Active", tone: "success" },
  SUPERSEDED: { label: "Superseded", tone: "info" },
};

export const versionStatusLabel = (status: string | null | undefined) => VERSION_STATUS[status ?? ""]?.label ?? status ?? "—";

/** Structural refusals (§2.2 `details.rule` / issue `rule`) in plain words. */
export const ISSUE_RULE_TEXT: Record<string, string> = {
  ROW_LENGTH: "A row is not as long as the cycle.",
  MODE: "Use either one base row with crew offsets or one row per crew.",
  TOKEN_UNMAPPED: "A letter has no shift.",
  O_REMAPPED: "O always means a day off and can't be given a shift.",
  OFFSET_RANGE: "A crew offset is outside the cycle.",
  COVERAGE_MISMATCH: "The crews don't cover each letter as the pattern says.",
};

/** Refusal codes of the rotation endpoints in plain words (the API message is shown under them). */
export const ROTATION_ERROR_TEXT: Record<string, string> = {
  ROTATION_PATTERN_INVALID: "The pattern isn't valid yet. Fix the points below.",
  INVALID_FIELDS: "Some values aren't valid. Fix the points below.",
  TOKEN_UNMAPPED: "Every letter needs a shift of this company, or Off.",
  SHIFT_ARCHIVED: "A chosen shift is archived. Pick another shift.",
  CONFLICT: "Another rotation already uses this code.",
  // INVALID_TRANSITION: the API's own message says which (activate a draft, assign an active version, end once).
  ROW_VERSION_CONFLICT: "Someone else changed this assignment. Reload and try again.",
  ROTATION_OVERLAP: "Someone already follows a rotation on these dates. End it first or pick later dates.",
  BACKDATE_LIMIT: "A rotation can start at most 7 days in the past.",
  VALIDATION_ERROR: "Some values aren't valid.",
  NOT_FOUND: "This rotation doesn't exist or is outside what you can see.",
};

/** Fatigue lints (§2.7; WARN only, never blocking). */
export const LINT_LABELS: Record<string, string> = {
  LINT_BACKWARD_ROTATION: "Shifts rotate backwards",
  LINT_WEEKLY_ROTATION_SPEED: "Shifts change every week or two",
  LINT_SHIFT_OVER_12H: "A shift is longer than 12 hours",
  LINT_SAFETY_CRITICAL_OVER_8H: "Safety-critical shift longer than 8 hours",
  LINT_CONSECUTIVE_DAYS: "More than 7 working days in a row",
  LINT_CONSECUTIVE_LONG_OR_NIGHT: "More than 3 long or night shifts in a row",
  LINT_DAY_NIGHT_SWITCH_REST: "Too little sleep between day and night blocks",
  LINT_NO_FREE_WEEKEND: "No free weekend in the cycle",
  LINT_PERMANENT_NIGHTS: "A crew works only nights",
  LINT_EARLY_START: "A shift starts before 07:00",
  LINT_REST_BELOW_10H: "Less than 10 hours between shifts",
  LINT_NIGHT_WORKER_AVERAGE: "Night worker average hours too high",
};

export function lintLabel(key: string): string {
  return LINT_LABELS[key] ?? key.replace(/^LINT_/, "").toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** "6 on 2 off block rotation · 24 days · 4 crews" for a template picker option. */
export function templateSummary(t: RotationTemplate): string {
  const crews = t.crew_rows ? Object.keys(t.crew_rows).length : Object.keys(t.crew_offsets).length;
  return `${t.cycle_days} days · ${crews} ${crews === 1 ? "crew" : "crews"}`;
}

/* ------------------------------------------------------------------ last auto-publish run */

const RUN_STATUS: Record<string, string> = {
  QUEUED: "Waiting to run",
  RUNNING: "Running",
  SUCCEEDED: "Finished",
  FAILED: "Failed",
  DEAD: "Failed",
  CANCELLED: "Cancelled",
};

/** One line for the latest `roster.rotation_generate` run: progress while it runs, the chunk summary after. */
export function autoPublishText(run: AutoPublishRun | null | undefined): string {
  if (!run) return "Not run yet.";
  const status = RUN_STATUS[run.status] ?? run.status;
  const total = run.progress_total;
  if (run.status === "QUEUED" || run.status === "RUNNING") {
    return total ? `${status}: ${run.progress_done} of ${total} chunks done.` : `${status}.`;
  }
  if (run.status !== "SUCCEEDED" || !run.summary) return run.error ? `${status}: ${run.error}` : `${status}.`;
  const s = run.summary;
  const parts = [`${status}: ${s.entries ?? 0} ${s.entries === 1 ? "entry" : "entries"} published`];
  if (s.failed_chunks) parts.push(`${s.failed_chunks} of ${s.chunks ?? total ?? 0} chunks failed`);
  else if (s.chunks) parts.push(`${s.chunks} ${s.chunks === 1 ? "chunk" : "chunks"}`);
  if (s.blocked_employees) {
    parts.push(`${s.blocked_employees} ${s.blocked_employees === 1 ? "person needs" : "people need"} a planner decision`);
  }
  return `${parts.join(" · ")}.`;
}
