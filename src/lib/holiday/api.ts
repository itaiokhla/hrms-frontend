/**
 * Typed client of the work-week API (LH-M1 WI-1.12; backend app/routes/holiday_work_weeks.py, 11 §6.11).
 *
 * State-changing calls send an `Idempotency-Key` and, for edits, `If-Match` (row_version). Errors keep the server's
 * structured `issues` (weekly-rest warnings, LH 04-holiday/03 §6.3) so forms can show them and ask for review.
 */

import type { Method } from "axios";

import { ApiError, http, toApiError, type ApiIssue } from "@/lib/api";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/payroll/api";

/* ------------------------------------------------------------------ rules (04-holiday/03 §3.2) */

export type Kind = "WEEKLY" | "CYCLE";
export type HalfPortion = "FIRST_HALF" | "SECOND_HALF";
export type Portion = "FULL" | HalfPortion;

export interface NthRule {
  weekday: number;
  nth: number[];
}
export interface WeeklyHalfRule {
  weekday: number;
  portion: HalfPortion;
  nth?: number[];
}
export interface CycleHalfRule {
  cycle_day: number;
  portion: HalfPortion;
}

export interface WeeklyRules {
  kind?: "WEEKLY";
  weekly_off_days: number[];
  nth_weekday_offs: NthRule[];
  half_day_offs?: WeeklyHalfRule[];
  rest_days?: number[];
}
export interface CycleRules {
  kind: "CYCLE";
  cycle_length_days: number;
  anchor_date: string;
  cycle_off_days: number[];
  half_day_offs?: CycleHalfRule[];
  rest_days?: number[];
}
export type Rules = WeeklyRules | CycleRules;

export const isCycle = (rules: Rules): rules is CycleRules => rules.kind === "CYCLE";

/* ------------------------------------------------------------------ resources */

export interface WorkWeekVersion {
  id: number;
  version: number;
  rules: Rules;
  kind: Kind;
  summary: string;
  effective_from: string;
  effective_to: string | null;
  reason: string | null;
  content_hash: string;
  state: "PAST" | "CURRENT" | "SCHEDULED";
  created_by_user_id: number | null;
  created_by: string | null;
  created_at: string | null;
}

export interface UsedBy {
  branches: number;
  employees: number;
  criteria: number;
}

export interface WorkWeek {
  id: number;
  code: string;
  name: string;
  name_i18n: Record<string, string>;
  kind: Kind;
  status: "ACTIVE" | "INACTIVE";
  legal_entity_id: number | null;
  owner: string;
  row_version: number;
  rules: Rules;
  summary: string;
  has_half_day_offs: boolean;
  current_version: WorkWeekVersion | null;
  next_change: { version: number; effective_from: string } | null;
  versions_count: number;
  used_by: UsedBy;
  can_manage: boolean;
  // Detail only
  in_use?: string | null;
  allowed_actions?: string[];
  local_today?: string;
  warnings?: RestIssue[];
}

export interface WorkWeekDetail extends WorkWeek {
  versions: WorkWeekVersion[];
  used_by_detail: {
    branches: { id: number; code: string; name: string; links: BranchLink[] }[];
    criteria: { id: number; priority: number; criteria: Record<string, unknown>; effective_from: string; effective_to: string | null }[];
    employees: { employee_id: number; assignment_id: number; effective_from: string; effective_to: string | null }[];
  };
}

export interface BranchLink {
  id: number;
  branch_id: number;
  holiday_calendar_id: number | null;
  work_week_pattern_id: number | null;
  effective_from: string;
  effective_to: string | null;
  reason: string | null;
  row_version: number;
}

export interface Template {
  code: string;
  name: string;
  kind: Kind;
  typical_use: string;
  rules: Rules;
  summary: string;
  needs_half_day_offs: boolean;
  available: boolean;
  unavailable_reason: string | null;
}

export interface RestIssue extends ApiIssue {
  rule: "R-1" | "R-2";
  start: string;
  end: string;
  count: number;
  limit: number;
  legal_entity_id?: number;
  legal_entity?: string;
  verified?: boolean;
}

export interface PreviewDay {
  date: string;
  weekday: number;
  portion: Portion | null;
  rest_day: boolean;
  cycle_day: number | null;
  occurrence: number;
  in_effect: boolean;
  changed: boolean;
  previous_portion: Portion | null;
}

export interface Impact {
  employees_affected: { count: number; per_branch: { branch_id: number; branch: string | null; count: number }[] };
  date_changes: { working_to_off: number; off_to_working: number; full_to_half: number; half_change: number; dates: string[] };
  leave_recount: { requests: number; units: number; by_type: { leave_type: string; requests: number; units: number }[] };
  pending_requests: number;
  /** Input-locked or finalized payroll periods that the change reaches only through retro detection. */
  locked_periods: { pay_group_id: number; pay_group: string | null; period_start: string; period_end: string; state: "INPUT_LOCKED" | "FINALIZED"; changed_dates: number }[];
  declared_working_days: string[];
}

export interface Preview {
  mode: "create" | "version";
  pattern_id: number | null;
  rules: Rules;
  summary: string;
  kind: Kind;
  effective_from: string;
  local_today: string;
  backdated: boolean;
  from: string;
  to: string;
  days: PreviewDay[];
  totals: { days: number; full_offs: number; half_offs: number; working_days: number };
  rest_check: { warnings: RestIssue[]; violations: RestIssue[] };
  half_day_offs_enabled: boolean;
  issues: ApiIssue[];
  no_change: boolean;
  impact: Impact | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
  can_create?: boolean;
  /** Company-local today (server clock). */
  local_today?: string;
}

export interface VersionResult {
  version: WorkWeekVersion | null;
  warnings: RestIssue[];
  recount: { mode: string; dates: number; leave_days: number; changed: number | null } | null;
  changed_dates?: number;
  pattern: WorkWeekDetail;
}

/* ------------------------------------------------------------------ errors */

/** An API error that keeps the body's `issues` (and `details`). */
export class HolidayApiError extends ApiError {
  issues: ApiIssue[];
  details?: Record<string, unknown>;

  constructor(status: number, message: string, code: string | undefined, issues: ApiIssue[] = [], details?: Record<string, unknown>) {
    super(status, message, code);
    this.issues = issues;
    this.details = details;
  }
}

const STRUCTURED = new Set([400, 404, 409, 422]);

async function request<T>(method: Method, url: string, body?: unknown, options: { rowVersion?: number; params?: Record<string, unknown> } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (method.toLowerCase() !== "get") headers[IDEMPOTENCY_HEADER] = newIdempotencyKey();
  if (options.rowVersion !== undefined) headers["If-Match"] = `"${options.rowVersion}"`;
  let response;
  try {
    response = await http.request<T>({
      method,
      url,
      data: body,
      params: options.params,
      headers,
      validateStatus: (s) => (s >= 200 && s < 300) || STRUCTURED.has(s),
    });
  } catch (error) {
    throw toApiError(error);
  }
  if (response.status >= 300) {
    const data = (response.data ?? {}) as { detail?: unknown; code?: string; issues?: ApiIssue[]; details?: Record<string, unknown> };
    const message =
      typeof data.detail === "string"
        ? data.detail
        : Array.isArray(data.detail)
          ? (data.detail as { msg: string }[]).map((d) => d.msg).join(". ")
          : "Request failed.";
    throw new HolidayApiError(response.status, message, data.code, data.issues ?? [], data.details);
  }
  return response.data;
}

/* ------------------------------------------------------------------ calls */

export interface WorkWeekQuery {
  q?: string;
  kind?: Kind;
  status?: "ACTIVE" | "INACTIVE";
  owner?: "TENANT";
  legal_entity_id?: number;
  sort?: string;
  skip?: number;
  limit?: number;
}

export interface WorkWeekCreate {
  code?: string;
  name: string;
  legal_entity_id?: number | null;
  template_code?: string;
  rules?: Rules;
  effective_from?: string;
  reason?: string;
  acknowledge_warnings?: boolean;
}

export interface VersionCreate {
  rules: Rules;
  effective_from?: string;
  reason?: string;
  acknowledge_warnings?: boolean;
}

export interface PreviewRequest {
  /** Optional with `pattern_id` (the rules valid today). */
  rules?: Rules;
  /** With `pattern_id`: every date under its own saved version (Schedule tab), no impact. */
  stored?: boolean;
  pattern_id?: number;
  legal_entity_id?: number | null;
  effective_from?: string;
  from?: string;
  to?: string;
}

export const workWeeksApi = {
  list: (query: WorkWeekQuery = {}) => request<Page<WorkWeek>>("get", "/work-weeks", undefined, { params: { ...query } }),
  templates: () => request<{ items: Template[] }>("get", "/work-weeks/templates").then((r) => r.items),
  get: (id: number) => request<WorkWeekDetail>("get", `/work-weeks/${id}`),
  history: (id: number) =>
    request<{ items: { id: number; action: string; description: string; actor_email: string | null; created_at: string | null }[] }>(
      "get",
      `/work-weeks/${id}/history`,
    ).then((r) => r.items),
  versions: (id: number) => request<{ items: WorkWeekVersion[] }>("get", `/work-weeks/${id}/versions`).then((r) => r.items),
  create: (body: WorkWeekCreate) => request<WorkWeekDetail>("post", "/work-weeks", body),
  update: (id: number, body: Partial<Pick<WorkWeek, "code" | "name" | "status" | "name_i18n">>, rowVersion?: number) =>
    request<WorkWeekDetail>("patch", `/work-weeks/${id}`, body, { rowVersion }),
  addVersion: (id: number, body: VersionCreate, rowVersion?: number) =>
    request<VersionResult>("post", `/work-weeks/${id}/versions`, body, { rowVersion }),
  preview: (body: PreviewRequest) => request<Preview>("post", "/work-weeks/preview", body),
  duplicateAsCrew: (id: number, body: { name: string; code?: string; offset_days: number; acknowledge_warnings?: boolean }) =>
    request<WorkWeekDetail>("post", `/work-weeks/${id}/crews`, body),
  branchLinks: (branchId: number) => request<{ items: BranchLink[] }>("get", `/branches/${branchId}/calendar-links`).then((r) => r.items),
  setBranchLink: (branchId: number, body: { work_week_pattern_id?: number; holiday_calendar_id?: number; effective_from?: string; reason?: string }) =>
    request<BranchLink>("put", `/branches/${branchId}/calendar-link`, body),
};

/* ------------------------------------------------------------------ labels */

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const OCCURRENCES: { value: number; label: string }[] = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: 5, label: "5th" },
  { value: -1, label: "Last" },
];
export const PORTION_LABEL: Record<Portion, string> = { FULL: "Off", FIRST_HALF: "Morning off", SECOND_HALF: "Afternoon off" };
