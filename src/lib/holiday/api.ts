/**
 * Typed client of the work-week API (LH-M1 WI-1.12; backend app/routes/holiday_work_weeks.py, 11 §6.11).
 *
 * State-changing calls send an `Idempotency-Key` and, for edits, `If-Match` (row_version). Errors keep the server's
 * structured `issues` (weekly-rest warnings, LH 04-holiday/03 §6.3) so forms can show them and ask for review.
 */

import type { Method } from "axios";

import { ApiError, http, toApiError, type ApiIssue } from "@/lib/api";
import { IDEMPOTENCY_HEADER, newIdempotencyKey, withStepUp } from "@/lib/payroll/api";

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

/* ================================================================== holiday calendars (LH-M1 Goal 2; 11 §6.10–6.11) */

export type Observance = "NONE" | "NEXT_WORKING_DAY" | "OBSERVED_IF_OFF";
export type HolidayType = "PUBLIC" | "COMPANY" | "OPTIONAL";

export interface Calendar {
  id: number;
  code: string;
  name: string;
  name_i18n: Record<string, string>;
  description: string | null;
  legal_entity_id: number | null;
  owner: string;
  country_code: string | null;
  subdivision_code: string | null;
  weekend_days: number[] | null;
  effective_weekend: number[];
  employee_observance: Observance;
  status: "ACTIVE" | "INACTIVE";
  row_version: number;
  parent_calendar_id: number | null;
  includes_count: number;
  used_by: UsedBy;
  can_manage: boolean;
  // detail only
  includes?: { included_calendar_id: number; priority: number; code: string; name: string }[];
  included_by?: { id: number; code: string }[];
  local_today?: string;
  in_use?: string | null;
}

export interface LineageNode {
  id: number;
  code: string;
  name: string | null;
  status: string | null;
  priority: number | null;
  own_count: number;
  exclusions: number;
  repeated: boolean;
  children: LineageNode[];
}

export interface CalendarExclusion {
  id: number;
  calendar_id: number;
  holiday_id: number | null;
  holiday_rule_id: number | null;
  effective_from_year: number | null;
  reason: string;
  holiday: { id: number; name: string; date: string; calendar_id: number; holiday_type: HolidayType; calendar_code: string | null } | null;
  created_at: string | null;
}

export interface Lineage {
  calendar_id: number;
  year: number;
  tree: LineageNode;
  exclusions: CalendarExclusion[];
  flattened: { total: number; own: number; inherited: number; excluded: number };
  included_by: { id: number; code: string }[];
  max_depth: number;
  calendar_version: string;
  affected_dates?: string[];
}

export interface FlatHoliday {
  id: number;
  date: string;
  name: string;
  holiday_type: HolidayType;
  portion: string;
  status: string;
  calendar_id: number;
  holiday_rule_id: number | null;
  source_code: string | null;
  own: boolean;
  path: string[];
  excluded_by: number | null;
}

export interface CalendarHolidays {
  calendar_id: number;
  year: number;
  items: FlatHoliday[];
  excluded: FlatHoliday[];
  summary: { total: number; own: number; inherited: Record<string, number>; excluded: number };
  calendar_version: string;
}

export interface CriteriaAssignment {
  id: number;
  calendar_id: number | null;
  calendar_code: string | null;
  calendar_name: string | null;
  work_week_pattern_id: number | null;
  work_week_code: string | null;
  criteria: Record<string, unknown>;
  priority: number;
  effective_from: string;
  effective_to: string | null;
  legal_entity_id: number | null;
  reason: string | null;
  row_version: number;
}

export interface CalendarAssignments {
  calendar_id: number;
  branch_links: (BranchLink & { branch_code: string; branch_name: string })[];
  criteria: CriteriaAssignment[];
  overrides: { assignment_id: number; employee_id: number; effective_from: string; effective_to: string | null }[];
}

export interface CalendarWrite {
  code?: string;
  name: string;
  description?: string | null;
  legal_entity_id?: number | null;
  country_code?: string | null;
  subdivision_code?: string | null;
  weekend_days?: number[] | null;
  employee_observance?: Observance;
}

export interface AssignmentWrite {
  calendar_id?: number | null;
  work_week_pattern_id?: number | null;
  criteria: Record<string, unknown>;
  priority: number;
  effective_from?: string;
  effective_to?: string | null;
  legal_entity_id?: number | null;
  reason?: string;
}

export const calendarsApi = {
  list: (query: { q?: string; status?: "ACTIVE" | "INACTIVE"; owner?: "TENANT"; legal_entity_id?: number; country_code?: string; skip?: number; limit?: number } = {}) =>
    request<Page<Calendar>>("get", "/holiday-calendars", undefined, { params: { ...query } }),
  get: (id: number) => request<Calendar>("get", `/holiday-calendars/${id}`),
  create: (body: CalendarWrite) => request<Calendar>("post", "/holiday-calendars", body),
  update: (id: number, body: Partial<CalendarWrite> & { status?: "ACTIVE" | "INACTIVE" }, rowVersion?: number) =>
    request<Calendar>("patch", `/holiday-calendars/${id}`, body, { rowVersion }),
  lineage: (id: number, year?: number) => request<Lineage>("get", `/holiday-calendars/${id}/lineage`, undefined, { params: year ? { year } : {} }),
  holidays: (id: number, year: number) => request<CalendarHolidays>("get", `/holiday-calendars/${id}/holidays`, undefined, { params: { year } }),
  setIncludes: (id: number, includes: { included_calendar_id: number; priority: number }[], reason?: string, rowVersion?: number) =>
    request<Lineage & { recount?: unknown }>("put", `/holiday-calendars/${id}/includes`, { includes, ...(reason ? { reason } : {}) }, { rowVersion }),
  addExclusion: (id: number, body: { holiday_id?: number; holiday_rule_id?: number; effective_from_year?: number; reason: string }) =>
    request<CalendarExclusion>("post", `/holiday-calendars/${id}/exclusions`, body),
  removeExclusion: (id: number, exclusionId: number, reason?: string) =>
    request<{ removed: number }>("delete", `/holiday-calendars/${id}/exclusions/${exclusionId}`, undefined, { params: reason ? { reason } : {} }),
  addOccurrence: (id: number, body: { name: string; date: string; holiday_type: HolidayType; description?: string }) =>
    request<{ id: number }>("post", `/holiday-calendars/${id}/occurrences`, body),
  assignments: (id: number) => request<CalendarAssignments>("get", `/holiday-calendars/${id}/assignments`),
  criteria: (calendarId?: number) =>
    request<{ items: CriteriaAssignment[] }>("get", "/holiday-calendar-assignments", undefined, { params: calendarId ? { calendar_id: calendarId } : {} }).then((r) => r.items),
  createAssignment: (body: AssignmentWrite) => request<CriteriaAssignment>("post", "/holiday-calendar-assignments", body),
  updateAssignment: (id: number, body: Partial<AssignmentWrite>, rowVersion?: number) =>
    request<CriteriaAssignment>("patch", `/holiday-calendar-assignments/${id}`, body, { rowVersion }),
  setBranchLink: (branchId: number, body: { holiday_calendar_id?: number; work_week_pattern_id?: number; effective_from?: string; reason?: string }) =>
    request<BranchLink>("put", `/branches/${branchId}/calendar-link`, body),
  branchLinks: (branchId: number) =>
    request<{ items: BranchLink[]; current: { holiday_calendar_id: number | null; work_week_pattern_id: number | null }; local_today: string }>(
      "get",
      `/branches/${branchId}/calendar-links`,
    ),
};

export const OBSERVANCE_LABEL: Record<Observance, string> = {
  NONE: "None",
  NEXT_WORKING_DAY: "Next working day",
  OBSERVED_IF_OFF: "Observed when off",
};

/* ================================================== rules, years and publication (LH-M1 Goal 3; 11 §6.10) */

export type RuleKind = "FIXED_DATE" | "NTH_WEEKDAY" | "WEEKDAY_RELATIVE" | "EASTER_OFFSET" | "ANNUAL_CONFIRM" | "ONE_OFF";
export type ObservedRule = "NONE" | "NEAREST_WORKDAY" | "NEXT_WORKDAY" | "PREVIOUS_WORKDAY";
export type HolidayCategory =
  | "NATIONAL"
  | "REGIONAL"
  | "FESTIVAL"
  | "ELECTION"
  | "COMPANY_EVENT"
  | "SHUTDOWN"
  | "BRIDGE"
  | "EMERGENCY"
  | "BANK"
  | "OTHER";
export type YearStatus = "DRAFT" | "PUBLISHED" | "NONE";
export type OccurrenceStatus = "PROVISIONAL" | "CONFIRMED" | "CANCELLED";

export interface RuleWrite {
  name: string;
  kind: RuleKind;
  params: Record<string, unknown>;
  holiday_type: HolidayType;
  category: HolidayCategory;
  portion?: "FULL" | "FIRST_HALF" | "SECOND_HALF";
  duration_days: number;
  duration_range?: [number, number] | null;
  observed_rule: ObservedRule;
  applies_on?: number[] | null;
  valid_from_year?: number;
  valid_to_year?: number | null;
  source?: "MANUAL" | "PACK" | "IMPORT" | "GOVT_NOTICE";
  legal_ref?: string | null;
  issued_on?: string | null;
  apply_to_draft_years?: boolean;
}

export interface HolidayRule extends RuleWrite {
  id: number;
  calendar_id: number;
  status: "ACTIVE" | "INACTIVE";
  version: number;
  row_version: number;
  summary: string;
  next_dates: string[];
  expected_dates: Record<string, string>;
  generated_rows: number;
}

export interface RuleSaveResult {
  rule: HolidayRule;
  draft_changes: { year: number; counts: Record<string, number> }[];
  published_years_affected: number[];
  info?: { code: string; message: string }[];
}

export interface PreviewRow {
  date: string;
  weekday: number;
  name: string;
  status: string;
  observance: "ORIGINAL" | "OBSERVED";
  observed_from_date: string | null;
  sequence_index: number;
}

export interface RulePreview {
  calendar_id: number;
  weekend: number[];
  years: { year: number; rows: PreviewRow[]; notes: { code: string; message: string; severity: string }[] }[];
  info: { code: string; message: string }[];
}

export interface YearItem {
  id: number;
  calendar_id: number;
  date: string;
  weekday: number;
  name: string;
  holiday_type: HolidayType;
  category: HolidayCategory;
  portion: string;
  status: OccurrenceStatus;
  observance: "ORIGINAL" | "OBSERVED";
  observed_from_date: string | null;
  sequence_index: number;
  rule_id: number | null;
  source: string;
  rule_year: number | null;
  overridden: boolean;
  moved_from: string | null;
  expected_source: string | null;
  description: string | null;
  row_version: number;
  own: boolean;
  source_code: string | null;
  path: string[];
  year_status: YearStatus | null;
  actions?: string[];
}

export interface PendingRequest {
  requested_by_user_id: number;
  requested_by: string | null;
  requested_at: string | null;
  content_hash: string;
  kind: "PUBLISH" | "AMEND";
  operations: Record<string, unknown>[];
  reason: string | null;
}

export interface YearRecord {
  calendar_id: number;
  year: number;
  status: YearStatus;
  version: number;
  content_hash: string | null;
  published_at: string | null;
  published_by: string | null;
  approved_by: string | null;
  generated_at: string | null;
  row_version: number | null;
  pending_request: PendingRequest | null;
}

export interface WorkingDay {
  id: number;
  calendar_id: number;
  date: string;
  weekday: number;
  name: string;
  portion: string;
  reason: string;
  row_version: number;
}

export interface YearView extends YearRecord {
  calendar_code: string;
  calendar_name: string;
  local_today: string;
  backdate_days: number;
  window_start: string;
  items: YearItem[];
  working_days: WorkingDay[];
  notes: { code: string; message: string; severity: string; rule_id: number | null }[];
  summary: { own: number; inherited: number; expected: number; cancelled: number; rules: number };
  can_manage: boolean;
  can_publish: boolean;
  requires_second_person: boolean;
  current_content_hash: string;
}

export interface ImpactWarning {
  code: string;
  confirm: boolean;
  severity: "warning" | "info";
  message: string;
  details?: Record<string, unknown>;
}

export interface YearImpact {
  content_hash: string;
  diff: { calendar_code: string; date: string; change: "added" | "removed" | "changed"; name: string }[];
  changed_dates: string[];
  people: { employees: number; by_branch: Record<string, number> };
  leave: { approved_requests: number; dates: number; units: string; pending_requests: number };
  payroll: { locked_periods: { pay_group: string | null; period_start: string; period_end: string; state: string }[] };
  errors: { code: string; message: string; dates: string[] }[];
  warnings: ImpactWarning[];
  holidays: { own: number; expected: number };
}

export interface YearChangeResult {
  dry_run: boolean;
  status?: "PUBLISHED" | "AMENDED" | "PENDING_SECOND_PERSON" | "DRAFT_UPDATED" | "NO_CHANGE";
  impact: YearImpact;
  year: YearRecord;
  requires_second_person: boolean;
  id?: number | null;
}

export interface AmendOperation {
  op: "add" | "cancel" | "move" | "confirm" | "edit" | "add_working_day" | "remove_working_day";
  [key: string]: unknown;
}

export interface CalendarHistory {
  calendar_id: number;
  years: YearRecord[];
  events: {
    id: number;
    action: string;
    description: string;
    actor: string | null;
    created_at: string | null;
    year: number | null;
    version: number | null;
    reason: string | null;
  }[];
}

export interface OccurrenceWrite {
  name: string;
  date: string;
  holiday_type: HolidayType;
  category?: HolidayCategory;
  status?: "CONFIRMED" | "PROVISIONAL";
  duration_days?: number;
  description?: string;
  reason?: string;
  acknowledged_warnings?: string[];
  dry_run?: boolean;
}

export const yearsApi = {
  rules: (calendarId: number, status?: "ACTIVE" | "INACTIVE") =>
    request<{ calendar_id: number; local_today: string; items: HolidayRule[] }>("get", `/holiday-calendars/${calendarId}/rules`, undefined, {
      params: status ? { status } : {},
    }),
  rule: (ruleId: number) => request<HolidayRule>("get", `/holiday-calendars/rules/${ruleId}`),
  createRule: (calendarId: number, body: RuleWrite) => request<RuleSaveResult>("post", `/holiday-calendars/${calendarId}/rules`, body),
  updateRule: (ruleId: number, body: Partial<RuleWrite>, rowVersion?: number) =>
    request<RuleSaveResult>("patch", `/holiday-calendars/rules/${ruleId}`, body, { rowVersion }),
  deactivateRule: (ruleId: number, reason?: string) =>
    request<RuleSaveResult>("post", `/holiday-calendars/rules/${ruleId}/deactivate`, { reason, apply_to_draft_years: true }),
  setExpectedDate: (ruleId: number, year: number, date: string | null) =>
    request<RuleSaveResult>("put", `/holiday-calendars/rules/${ruleId}/expected-date`, { year, date }),
  previewRule: (body: { calendar_id: number; rule_id?: number; rule: Partial<RuleWrite>; years?: number; from_year?: number }) =>
    request<RulePreview>("post", "/holiday-calendars/rules/preview", body),
  year: (calendarId: number, year: number) => request<YearView>("get", `/holiday-calendars/${calendarId}/years/${year}`),
  generate: (calendarId: number, year: number) =>
    request<{ counts: Record<string, number>; notes: { code: string; message: string }[]; year_record: YearRecord }>(
      "post",
      `/holiday-calendars/${calendarId}/years/${year}/generate`,
    ),
  discard: (calendarId: number, year: number) => request<{ removed: number }>("delete", `/holiday-calendars/${calendarId}/years/${year}`),
  publish: (
    calendarId: number,
    year: number,
    body: { dry_run?: boolean; acknowledged_warnings?: string[]; note?: string; reason?: string; content_hash?: string },
  ) =>
    // LH-SEC-02: a publish (not a dry run) needs a fresh step-up; "Confirm it's you" opens and the call is retried.
    withStepUp(() => request<YearChangeResult>("post", `/holiday-calendars/${calendarId}/years/${year}/publish`, body)),
  amend: (
    calendarId: number,
    year: number,
    body: {
      operations?: AmendOperation[];
      reason?: string;
      dry_run?: boolean;
      acknowledged_warnings?: string[];
      content_hash?: string;
      complete_request?: boolean;
    },
  ) => request<YearChangeResult>("post", `/holiday-calendars/${calendarId}/years/${year}/amend`, body),
  applyRules: (calendarId: number, year: number, reason: string, dryRun = false) =>
    request<YearChangeResult & { operations: AmendOperation[] }>("post", `/holiday-calendars/${calendarId}/years/${year}/apply-rules`, {
      reason,
      dry_run: dryRun,
    }),
  decline: (calendarId: number, year: number, reason?: string) =>
    request<YearRecord>("post", `/holiday-calendars/${calendarId}/years/${year}/request/decline`, { reason }),
  addOccurrence: (calendarId: number, body: OccurrenceWrite) => request<YearChangeResult>("post", `/holiday-calendars/${calendarId}/occurrences`, body),
  editDraftRow: (holidayId: number, body: Record<string, unknown>, rowVersion?: number) =>
    request<{ status: string }>("patch", `/holiday-calendars/occurrences/${holidayId}`, body, { rowVersion }),
  confirm: (holidayId: number, body: { date?: string; reason?: string }) =>
    request<YearChangeResult>("post", `/holiday-calendars/occurrences/${holidayId}/confirm`, body),
  cancel: (holidayId: number, body: { reason?: string }) => request<YearChangeResult>("post", `/holiday-calendars/occurrences/${holidayId}/cancel`, body),
  move: (holidayId: number, body: { new_date: string; reason?: string }) =>
    request<YearChangeResult>("post", `/holiday-calendars/occurrences/${holidayId}/move`, body),
  declareWorkingDay: (calendarId: number, body: { date: string; name: string; reason: string }) =>
    request<WorkingDay | YearChangeResult>("post", `/holiday-calendars/${calendarId}/working-days`, body),
  removeWorkingDay: (calendarId: number, workingDayId: number, reason?: string) =>
    request<unknown>("delete", `/holiday-calendars/${calendarId}/working-days/${workingDayId}`, undefined, {
      params: reason ? { reason } : {},
    }),
  history: (calendarId: number) => request<CalendarHistory>("get", `/holiday-calendars/${calendarId}/history`),
};

export const RULE_KIND_LABEL: Record<RuleKind, string> = {
  FIXED_DATE: "Same date every year",
  NTH_WEEKDAY: "Weekday of a month",
  WEEKDAY_RELATIVE: "Weekday before/after a date",
  EASTER_OFFSET: "Days from Easter",
  ANNUAL_CONFIRM: "Announced every year",
  ONE_OFF: "Once",
};

export const OBSERVED_LABEL: Record<ObservedRule, string> = {
  NONE: "Do not move",
  NEAREST_WORKDAY: "Nearest weekday",
  NEXT_WORKDAY: "Next weekday",
  PREVIOUS_WORKDAY: "Previous weekday",
};

export const CATEGORY_LABEL: Record<HolidayCategory, string> = {
  NATIONAL: "National",
  REGIONAL: "Regional",
  FESTIVAL: "Festival",
  ELECTION: "Election",
  COMPANY_EVENT: "Company event",
  SHUTDOWN: "Shutdown",
  BRIDGE: "Bridge day",
  EMERGENCY: "Emergency",
  BANK: "Bank closure",
  OTHER: "Other",
};

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/* ------------------------------------------------------------------ day marks (LH 05 §3.6; WI-1.9 / WI-1.12) */

export type FactHolidayType = "PUBLIC" | "COMPANY" | "OPTIONAL_AVAILED" | "OPTIONAL_NOT_AVAILED";
export type WorkingPortion = "FULL" | HalfPortion | "NONE";

export interface DayHoliday {
  id: number;
  name: string;
  type: FactHolidayType;
  category: HolidayCategory;
  portion: Portion;
  status: "CONFIRMED" | "PROVISIONAL" | "CANCELLED";
  observance: "ORIGINAL" | "OBSERVED" | "EMPLOYEE_SUBSTITUTE";
  observed_from_date: string | null;
  /** Presence, never pay: payroll decides pay from `paid_holiday_types` (BUG-11). */
  non_working: boolean;
}

export interface DayLeave {
  leave_id: number;
  portion: string;
  status: "APPROVED" | "PENDING" | string;
  charged_units: string | null;
  label: string;
}

export interface DayMark {
  date: string;
  weekday: number;
  employed: boolean;
  timezone: string | null;
  calendar_id: number | null;
  calendar_source: string;
  work_week_id: number | null;
  weekly_off: boolean;
  weekly_off_portion: WorkingPortion;
  declared_working_day: boolean;
  working_portion: WorkingPortion;
  working: boolean;
  scheduled_minutes: number;
  observed_elsewhere: string | null;
  holiday: DayHoliday | null;
  leave?: DayLeave[];
}

export interface CalendarSegment {
  id: number | null;
  from: string;
  to: string;
  code: string | null;
  name: string | null;
  years: Record<string, { status: string; version: number }>;
}

export interface MyCalendar {
  employee_id: number;
  local_today: string;
  timezone: string | null;
  /** Full weekly-off weekdays (0 = Monday) of the work week valid today. */
  weekend: number[];
  /** First weekday of a week row: the day after the weekend run (Fri–Sat → Sunday). */
  week_start: number;
  from: string;
  to: string;
  calendars: CalendarSegment[];
  work_weeks: { id: number | null; from: string; to: string }[];
  days: DayMark[];
}

export interface EmployeeDays {
  employee_id: number;
  local_today: string;
  weekend: number[];
  week_start: number;
  days: DayMark[];
}

export const dayMarksApi = {
  me: (from: string, to: string) => request<MyCalendar>("get", "/me/calendar", undefined, { params: { from, to } }),
  employee: (employeeId: number, from: string, to: string) =>
    request<EmployeeDays>("get", "/calendar/days", undefined, { params: { employee_id: employeeId, from, to } }),
};

/** The kind of a date for the year grid and its legend (LH 09-ui-ux/02 §16). */
export type MarkKind = "public" | "company" | "optional" | "optional-chosen" | "half" | "provisional" | "weekly-off" | "working-day" | "leave" | "work" | "none";

export function markKind(d: DayMark): MarkKind {
  if (!d.employed) return "none";
  const h = d.holiday;
  if (h) {
    if (h.status === "PROVISIONAL") return "provisional";
    if (h.type === "OPTIONAL_NOT_AVAILED") return "optional";
    if (h.type === "OPTIONAL_AVAILED") return "optional-chosen";
    if (h.portion !== "FULL") return "half";
    return h.type === "PUBLIC" ? "public" : "company";
  }
  if ((d.leave ?? []).some((l) => l.status === "APPROVED")) return "leave";
  if (d.declared_working_day) return "working-day";
  if (d.weekly_off) return "weekly-off";
  return "work";
}

export const MARK_LABEL: Record<MarkKind, string> = {
  public: "Public holiday",
  company: "Company holiday",
  optional: "Optional holiday",
  "optional-chosen": "Optional holiday (chosen)",
  half: "Half-day holiday",
  provisional: "Expected holiday",
  "weekly-off": "Weekly off",
  "working-day": "Declared working day",
  leave: "On leave",
  work: "Working day",
  none: "Not employed",
};

/* ------------------------------------------------------------------ Next year, closures, imports (Goal 5; 02 §8-§10) */

export type RolloverStatus = "PUBLISHED" | "DRAFT" | "NOT_GENERATED" | "NO_RULES" | "FAILED";

export interface RolloverCounts {
  holidays: number;
  expected: number;
  weekend: number;
  observed: number;
  edited: number;
  skipped: number;
  needs_date: number;
  cross_year: number;
}

export interface RolloverItem {
  calendar_id: number;
  code: string;
  name: string;
  legal_entity_id: number | null;
  year_status: RolloverStatus;
  version: number;
  rules: number;
  counts: RolloverCounts;
  last_generated_at: string | null;
  failed: boolean;
  error: string | null;
  can_manage: boolean;
  can_publish: boolean;
}

export interface RolloverOverview {
  year: number;
  local_today: string;
  generate_on: string;
  before_generate_on: boolean;
  generated_on: string | null;
  published: number;
  total: number;
  items: RolloverItem[];
}

export interface RolloverRun {
  year: number;
  calendars: { calendar_id: number; code: string; result: "GENERATED" | "EXISTS" | "PUBLISHED" | "NO_RULES" | "FAILED"; error?: string }[];
  totals: Record<string, number>;
}

export type DiffLineKind = "NEW" | "SAME" | "MOVED" | "GONE";
export interface DiffLine {
  line: DiffLineKind;
  name: string;
  date: string | null;
  previous_date: string | null;
}

export interface ClosureEmployee {
  employee_id: number;
  name: string | null;
  scheduled: boolean;
  working_portion: string;
  shift: string | null;
  scheduled_minutes: number;
  attendance_session: boolean;
  approved_leave_ids: number[];
  pending_leave: boolean;
  period_state: "OPEN" | "INPUT_LOCKED" | "FINALIZED";
}

export interface ClosureImpact {
  date: string;
  totals: {
    employees: number;
    scheduled: number;
    on_shift: number;
    attendance_sessions: number;
    approved_leave: number;
    pending_leave: number;
    input_locked: number;
    finalized: number;
  };
  employees: ClosureEmployee[];
  requires_typed_confirm: boolean;
}

export interface ClosureInput {
  date: string;
  name: string;
  portion?: Portion;
  holiday_type?: "PUBLIC" | "COMPANY";
  category?: HolidayCategory;
  description?: string;
  reason: string;
  dry_run?: boolean;
  confirm_date?: string;
  acknowledged_warnings?: string[];
}

export interface ClosureResult {
  dry_run?: boolean;
  status?: string;
  impact?: YearImpact;
  closure: ClosureImpact;
  hint: string | null;
  requires_second_person?: boolean;
  year?: YearView | { version: number; status: string };
  effects?: { payroll?: { input_locked: Record<string, number[]>; finalized: Record<string, number[]>; retro_job_id: number | null } };
}

export type ImportKind = "CSV_DATED" | "CSV_RULES" | "ICS";
export type ImportClass =
  | "NEW"
  | "CHANGED_DATE"
  | "CHANGED_DETAILS"
  | "UNCHANGED"
  | "CONFLICT"
  | "CONFLICT_EDIT"
  | "NOT_IN_SOURCE"
  | "CANCEL"
  | "NEW_RULE"
  | "DUPLICATE_RULE"
  | "ERROR";

export interface ImportLine {
  line: number | null;
  kind: "DATED" | "RULE";
  values: Record<string, unknown> & { name?: string | null; date?: string | null };
  errors: { field: string; message: string; code?: string; reason?: string }[];
  warnings: { field: string; message: string }[];
  classification: ImportClass;
  action: "ACCEPT" | "SKIP";
  match?: { id: number; date: string; name: string };
  note?: string;
  preview?: { date: string; name: string }[];
}

export interface HolidayImport {
  id: number;
  calendar_id: number;
  kind: ImportKind;
  target_year: number;
  status: "DRY_RUN" | "COMMITTED" | "FAILED" | "EXPIRED";
  file_name: string | null;
  target_hash: string | null;
  row_version: number;
  created_at: string | null;
  committed_at: string | null;
  summary: Partial<Record<ImportClass, number>> & { lines?: number };
  year_status: string | null;
  source_label: string | null;
  ignored_properties: string[];
  ignored_columns: string[];
  result: { accepted: number; rules_created: number; rows_created: number; operations: number; amendment_status: string | null } | null;
  lines?: ImportLine[];
}

export const rolloverApi = {
  overview: (year?: number) => request<RolloverOverview>("get", "/holiday-calendars/rollover", undefined, { params: year ? { year } : {} }),
  generate: (year: number) => request<RolloverRun>("post", "/holiday-calendars/rollover/generate", { year }),
  diff: (calendarId: number, year: number) =>
    request<{ year: number; against: number; lines: DiffLine[] }>("get", `/holiday-calendars/${calendarId}/years/${year}/diff`),
  closure: (calendarId: number, body: ClosureInput) => request<ClosureResult>("post", `/holiday-calendars/${calendarId}/closures`, body),
};

export const importsApi = {
  check: (calendarId: number, kind: ImportKind, targetYear: number, file: File) => {
    const form = new FormData();
    form.append("kind", kind);
    form.append("target_year", String(targetYear));
    form.append("file", file);
    return request<HolidayImport>("post", `/holiday-calendars/${calendarId}/imports`, form);
  },
  get: (importId: number) => request<HolidayImport>("get", `/holiday-calendars/imports/${importId}`),
  list: (calendarId: number) => request<{ items: HolidayImport[] }>("get", `/holiday-calendars/${calendarId}/imports`),
  commit: (calendarId: number, importId: number, body: { decisions: { line: number; action: "ACCEPT" | "SKIP" }[]; reason?: string; target_hash?: string | null }) =>
    request<HolidayImport & { amendment: unknown }>("post", `/holiday-calendars/${calendarId}/imports/${importId}/commit`, body),
  templateUrl: (kind: "CSV_DATED" | "CSV_RULES", year: number) => `/holiday-calendars/imports/templates/${kind}?year=${year}`,
  errorsUrl: (importId: number) => `/holiday-calendars/imports/${importId}/errors.csv`,
};

export const ROLLOVER_STATUS_LABEL: Record<RolloverStatus, string> = {
  PUBLISHED: "Published",
  DRAFT: "Draft",
  NOT_GENERATED: "Not generated",
  NO_RULES: "No rules",
  FAILED: "Failed",
};

export const IMPORT_CLASS_LABEL: Record<ImportClass, string> = {
  NEW: "New",
  CHANGED_DATE: "Changed date",
  CHANGED_DETAILS: "Changed details",
  UNCHANGED: "Unchanged",
  CONFLICT: "Possible duplicate",
  CONFLICT_EDIT: "Conflict with your edit",
  NOT_IN_SOURCE: "Not in source",
  CANCEL: "Cancelled in source",
  NEW_RULE: "New repeating holiday",
  DUPLICATE_RULE: "Rule already exists",
  ERROR: "Error",
};
