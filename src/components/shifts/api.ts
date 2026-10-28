/**
 * Typed client of the shift catalogue and assignment rules (AS-M1 WI-AS-1.6; backend app/routes/shift_catalogue.py,
 * app/services/shift_catalogue.py). Writes send an `Idempotency-Key`; PATCHes send `If-Match` (row_version). Errors
 * keep the body's structured `issues` and `details` (field errors, `next_allowed_from`, `refused[]`).
 */

import type { Method } from "axios";

import { ApiError, http, toApiError, type ApiIssue } from "@/lib/api";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/payroll/api";
import type {
  Page, Shift, ShiftBreakRule, ShiftDetail, ShiftKind, ShiftRule, ShiftRuleCriteria, ShiftSegment, ShiftVersion,
} from "@/lib/types";

/* ------------------------------------------------------------------ bodies (app/schemas/shifts.py) */

/** `VersionIn`: times are the work zone's unless `anchor_timezone` is set. */
export interface VersionBody {
  effective_from?: string | null;
  effective_to?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  segments?: ShiftSegment[];
  break_rules?: ShiftBreakRule[];
  half_split_time?: string | null;
  core_start_time?: string | null;
  core_end_time?: string | null;
  expected_net_minutes?: number | null;
  grace_in_minutes?: number | null;
  grace_out_minutes?: number | null;
  early_in_window_minutes?: number;
  late_out_window_minutes?: number;
  anchor_timezone?: string | null;
  safety_critical?: boolean;
  outdoor?: boolean;
  long_duty?: boolean;
  reason?: string | null;
  on_overlap?: "REJECT" | "TRUNCATE";
  acknowledged_warnings?: string[];
  dry_run?: boolean;
}

export interface ShiftCreateBody {
  code: string;
  name: string;
  kind: ShiftKind;
  color_token: string;
  legal_entity_id?: number | null;
  branch_id?: number | null;
  description?: string | null;
  version: VersionBody;
}

export interface ShiftPatchBody {
  name?: string;
  color_token?: string;
  description?: string | null;
  code?: string;
  kind?: ShiftKind;
}

export interface RuleBody {
  name: string;
  shift_id: number;
  criteria: ShiftRuleCriteria;
  priority: number;
  effective_from: string;
  effective_to?: string | null;
  legal_entity_id?: number | null;
  reason?: string | null;
  replaces_rule_id?: number | null;
  apply_to_locked_periods?: boolean;
}

export interface RulePatchBody {
  name?: string;
  shift_id?: number;
  criteria?: ShiftRuleCriteria;
  priority?: number;
  effective_to?: string | null;
  status?: "ACTIVE" | "INACTIVE";
  reason?: string | null;
  apply_to_locked_periods?: boolean;
}

export interface BulkAssignBody {
  employee_ids: number[];
  shift_id: number;
  effective_from: string;
  effective_to?: string | null;
  apply_as: "RULE" | "PLACEMENT";
  apply_to_locked_periods?: boolean;
  reason?: string | null;
  name?: string | null;
  dry_run?: boolean;
}

/* ------------------------------------------------------------------ responses */

export interface PayrollStates {
  OPEN: number;
  INPUT_LOCKED: number;
  FINALIZED: number;
}

export interface PreviewVersionRow {
  version_no: number | null;
  effective_from: string;
  effective_to: string | null;
  start_time: string | null;
  end_time: string | null;
  new: boolean;
  return_of?: number;
}

export interface WarningRow {
  code: string;
  [key: string]: unknown;
}

/** `POST /shifts/{id}/versions` with `dry_run` (§3.6 preview; `create_version`). */
export interface VersionPreview {
  dry_run: true;
  versions: PreviewVersionRow[];
  affected_employees: { count: number; sample: number[] };
  dates_by_payroll_state: PayrollStates;
  scheduled_minutes: { old: number | null; new: number | null };
  warnings: WarningRow[];
}

export interface VersionSaved {
  dry_run: false;
  version: ShiftVersion;
  created: ShiftVersion[];
  effects: { employees: number; leave_recalculation_queued: boolean };
  affected_employees: { count: number; sample: number[] };
  warnings: WarningRow[];
}

export interface RuleSampleRow {
  employee_id: number;
  from: string;
  before: { shift_id: number; source: string } | null;
  after: { shift_id: number; source: string } | null;
}

/** `POST /shift-assignment-rules/simulate` (§12.7). */
export interface RulePreview {
  employees_affected: number;
  sample: RuleSampleRow[];
  dates_changed: number;
  dates_by_payroll_state: PayrollStates;
}

export interface RuleSaved extends ShiftRule {
  effects: { employees: number; leave_recalculation_queued: boolean };
  warnings?: WarningRow[];
  preview?: RulePreview;
}

export interface BulkResultRow {
  employee_id: number;
  status: string;
  reason?: string;
  unchanged?: boolean;
  before_shift_id?: number | null;
}

/** `POST /shift-assignment-rules/bulk-assign` (§13): a rule preview / the created rule, or per-employee results. */
export type BulkAssignResult =
  | ({ dry_run: true; apply_as: "RULE"; items: number } & RulePreview)
  | { dry_run: false; apply_as: "RULE"; rule: RuleSaved; results: BulkResultRow[] }
  | { dry_run: boolean; apply_as: "PLACEMENT"; results: BulkResultRow[] };

export interface ExplainCandidate {
  step: "RULE" | "PLACEMENT" | "ROSTER" | string;
  won: boolean;
  rule_id?: number;
  name?: string;
  priority?: number;
  shift_id?: number;
  reason?: string | null;
}

export interface ExplainDay {
  date: string;
  source: "ROSTER" | "RULE" | "PLACEMENT" | "NONE" | string;
  shift_id: number | null;
  shift_version_id: number | null;
  rule_id?: number | null;
  shift_code?: string | null;
  kind?: string | null;
  anchor_timezone?: string | null;
  work_timezone?: string;
  start_time?: string | null;
  end_time?: string | null;
  candidates: ExplainCandidate[];
}

export interface ExplainResult {
  employee_id: number;
  days: ExplainDay[];
}

export interface ShiftListQuery {
  q?: string;
  status?: "ACTIVE" | "ARCHIVED" | "ALL";
  kind?: ShiftKind;
  branch_id?: number;
  legal_entity_id?: number;
  sort?: string;
  skip?: number;
  limit?: number;
}

/* ------------------------------------------------------------------ errors */

/** An API error that keeps the body's `issues` (field errors) and `details`. */
export class ShiftApiError extends ApiError {
  issues: ApiIssue[];
  details?: Record<string, unknown>;

  constructor(status: number, message: string, code: string | undefined, issues: ApiIssue[] = [],
    details?: Record<string, unknown>, fields?: { field: string; msg: string }[]) {
    super(status, message, code, fields);
    this.issues = issues;
    this.details = details;
  }
}

const STRUCTURED = new Set([400, 404, 409, 422]);

async function request<T>(method: Method, url: string, body?: unknown,
  options: { rowVersion?: number; params?: Record<string, unknown>; idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (method.toLowerCase() !== "get") headers[IDEMPOTENCY_HEADER] = options.idempotencyKey ?? newIdempotencyKey();
  if (options.rowVersion !== undefined) headers["If-Match"] = `"${options.rowVersion}"`;
  let response;
  try {
    response = await http.request<T>({
      method, url, data: body, params: options.params, headers,
      validateStatus: (s) => (s >= 200 && s < 300) || STRUCTURED.has(s),
    });
  } catch (error) {
    throw toApiError(error);
  }
  if (response.status >= 300) {
    const data = (response.data ?? {}) as { detail?: unknown; code?: string; issues?: ApiIssue[]; details?: Record<string, unknown> };
    const list = Array.isArray(data.detail) ? (data.detail as { field: string; msg: string }[]) : undefined;
    const message = typeof data.detail === "string" ? data.detail : list ? list.map((d) => d.msg).join(". ") : "Request failed.";
    throw new ShiftApiError(response.status, message, data.code, data.issues ?? [], data.details, list);
  }
  return response.data;
}

/** Drops empty values so the URL stays clean (and `GET /shifts` keeps its paged shape: skip/limit are always sent). */
function clean(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
}

/* ------------------------------------------------------------------ calls */

export const shiftsApi = {
  /** The paged catalogue (any list parameter selects the paged shape; default status ACTIVE). */
  list: (params: ShiftListQuery | Record<string, unknown>) =>
    request<Page<Shift>>("get", "/shifts", undefined, { params: clean({ skip: 0, limit: 25, ...params }) }),
  get: (id: number | string) => request<ShiftDetail>("get", `/shifts/${id}`),
  versions: (id: number | string) => request<ShiftVersion[]>("get", `/shifts/${id}/versions`),
  create: (body: ShiftCreateBody, idempotencyKey?: string) =>
    request<ShiftDetail>("post", "/shifts", body, { idempotencyKey }),
  update: (id: number | string, body: ShiftPatchBody, rowVersion: number) =>
    request<ShiftDetail>("patch", `/shifts/${id}`, body, { rowVersion }),
  archive: (id: number | string, rowVersion: number) =>
    request<ShiftDetail>("post", `/shifts/${id}/archive`, {}, { rowVersion }),
  restore: (id: number | string, rowVersion: number) =>
    request<ShiftDetail>("post", `/shifts/${id}/restore`, {}, { rowVersion }),
  previewVersion: (id: number | string, body: VersionBody) =>
    request<VersionPreview>("post", `/shifts/${id}/versions`, { ...body, dry_run: true }),
  createVersion: (id: number | string, body: VersionBody, idempotencyKey?: string) =>
    request<VersionSaved>("post", `/shifts/${id}/versions`, { ...body, dry_run: false }, { idempotencyKey }),
  resolve: (employeeId: number, from: string, to: string) =>
    request<ExplainResult>("get", "/shifts/resolve", undefined, { params: { employee_id: employeeId, from, to } }),

  rules: (params: Record<string, unknown>) =>
    request<Page<ShiftRule>>("get", "/shift-assignment-rules", undefined, { params: clean({ skip: 0, limit: 25, ...params }) }),
  rule: (id: number | string) => request<ShiftRule>("get", `/shift-assignment-rules/${id}`),
  createRule: (body: RuleBody, idempotencyKey?: string) =>
    request<RuleSaved>("post", "/shift-assignment-rules", body, { idempotencyKey }),
  updateRule: (id: number | string, body: RulePatchBody, rowVersion: number) =>
    request<RuleSaved>("patch", `/shift-assignment-rules/${id}`, body, { rowVersion }),
  simulateRule: (body: RuleBody) => request<RulePreview>("post", "/shift-assignment-rules/simulate", body),
  bulkAssign: (body: BulkAssignBody, idempotencyKey?: string) =>
    request<BulkAssignResult>("post", "/shift-assignment-rules/bulk-assign", body, { idempotencyKey }),
};

/** Field → message from a refusal: VALIDATION_ERROR `issues[]` (`version.start_time` → `start_time`) or 422 `detail[]`. */
export function shiftFieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (field: string | undefined, message: string | undefined) => {
    const parts = String(field ?? "").split(".").filter((p) => p && p !== "body" && p !== "version");
    const key = parts[0] ?? "";
    if (key && message && !out[key]) out[key] = message;
  };
  if (error instanceof ShiftApiError) error.issues.forEach((i) => add(i.field, i.message));
  if (error instanceof ApiError) (error.fields ?? []).forEach((f) => add(f.field, f.msg));
  return out;
}

/** Plain wording for the refusal codes a shift user can meet (shown above the form). */
export const SHIFT_ERROR_TEXT: Record<string, string> = {
  SHIFT_VERSION_IN_FORCE: "A version that is already in force can't change. Pick a later start date.",
  SHIFT_VERSION_OVERLAP_SCHEDULED: "The new version would run into a scheduled change.",
  SHIFT_VERSION_STARTED: "Some people already started this shift today. Start the change tomorrow.",
  SHIFT_ARCHIVED: "Restore the shift before changing its times.",
  SHIFT_IN_USE: "This shift is in use.",
  PRIORITY_CONFLICT: "Another rule with the same priority covers some of the same people. Use a different priority.",
  INVALID_TRANSITION: "A rule in force can't change its shift, people or priority. Replace it from a date instead.",
  NOT_ELIGIBLE: "Some people can't get this shift.",
  ROW_VERSION_CONFLICT: "Someone else changed this. Reload and try again.",
  FEATURE_DISABLED: "This isn't turned on for your company.",
};
