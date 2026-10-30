/**
 * Typed client of roster periods, drafts, publication and My schedule (AS-M5 WI-AS-5.5; backend app/routes/rosters.py,
 * app/services/shift_rosters.py). Writes send an `Idempotency-Key`; draft saves and discards send the period's
 * `row_version`. Errors keep the body's structured `issues` and `details` (rule results, stale cells).
 */

import type { Method } from "axios";

import { ShiftApiError } from "@/components/shifts/api";
import { http, toApiError, type ApiIssue } from "@/lib/api";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/payroll/api";

/* ------------------------------------------------------------------ objects (serialize_period / _entry / _draft) */

export type PeriodStatus = "DRAFT" | "PUBLISHED" | "AMENDING" | "CLOSED" | "CANCELLED";
export type EntryKind = "WORK" | "OFF";

export interface RosterPeriod {
  id: number;
  code: string;
  name: string;
  team_id: number | null;
  branch_id: number | null;
  department_ids: number[] | null;
  start_date: string;
  end_date: string;
  status: PeriodStatus | string;
  publish_due_at: string | null;
  last_published_at: string | null;
  last_publication_id: number | null;
  requires_approval: boolean;
  row_version: number;
  /** Draft cells waiting to be published. */
  drafts: number;
}

export interface RosterEntry {
  id: number;
  employee_id: number;
  shift_date: string;
  entry_seq: number;
  kind: EntryKind;
  shift_id: number | null;
  shift_version_id: number | null;
  custom_start_time: string | null;
  custom_end_time: string | null;
  site_id: number | null;
  planned_work_mode: string | null;
  version: number;
  source: string;
  roster_period_id: number | null;
  publication_id: number | null;
  published_at: string;
  acknowledged_at: string | null;
  note: string | null;
}

export interface RosterDraft {
  id: number;
  employee_id: number;
  shift_date: string;
  entry_seq: number;
  action: "UPSERT" | "DELETE";
  kind: EntryKind | null;
  shift_id: number | null;
  custom_start_time: string | null;
  custom_end_time: string | null;
  site_id: number | null;
  planned_work_mode: string | null;
  source: string | null;
  base_entry_id: number | null;
  base_entry_version: number | null;
  note: string | null;
}

/** The grid's shift legend: active shifts plus any shift an entry or draft still references. */
export interface RosterShift {
  id: number;
  code: string;
  name: string;
  color_token: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string;
}

export interface RosterEmployee {
  id: number;
  name: string;
  employee_code: string;
}

/** `GET /rosters/{id}` (§13). */
export interface RosterGridData {
  period: RosterPeriod;
  employees: RosterEmployee[];
  entries: RosterEntry[];
  drafts: RosterDraft[];
  shifts: RosterShift[];
  /** §5.2: a publish goes to an approver; and one is waiting (drafts frozen). */
  publish_requires_approval?: boolean;
  approval_pending?: boolean;
}

/** `RuleResult` (03-shifts/02 §6.1): one rule finding over an employee's dates. */
export interface RuleResult {
  rule_key: string;
  severity: "WARN" | "REQUIRE_REASON" | "BLOCK" | string;
  employee_id?: number | null;
  dates?: string[];
  measured?: string | number | null;
  limit?: string | number | null;
  unit?: string | null;
  source_ref?: string | null;
  message_key?: string | null;
  message?: string | null;
  [key: string]: unknown;
}

/** `POST /rosters/{id}/validate` and `publish` with `dry_run` (§5.1 preview). */
export interface PublishPreview {
  dry_run: true;
  nothing_to_publish?: boolean;
  changes?: Record<string, unknown>[];
  results: RuleResult[];
  blocking?: RuleResult[];
  snapshot_hash?: string | null;
}

export interface PublishDone {
  dry_run: false;
  nothing_to_publish?: boolean;
  publication_id: number | null;
  snapshot_hash: string | null;
  entries_created?: number;
  entries_updated?: number;
  entries_withdrawn?: number;
  min_notice_hours?: string | null;
  results: RuleResult[];
  period?: RosterPeriod;
  /** §5.2: the roster went to a publisher for approval instead of being published. */
  pending_approval?: boolean;
  approval_request_id?: number;
}

export interface ScheduleDay {
  date: string;
  source: "ROSTER" | "RULE" | "PLACEMENT" | "NONE" | string;
  kind: EntryKind | null;
  shift_id: number | null;
  shift_code: string | null;
  start_time: string | null;
  end_time: string | null;
  anchor_timezone: string | null;
  work_timezone: string | null;
  entries: RosterEntry[];
}

/** `GET /me/schedule` (from / to default to the employee-local today and 13 days after). */
export interface MySchedule {
  employee_id: number;
  from: string;
  to: string;
  days: ScheduleDay[];
}

export interface PageOf<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
}

/* ------------------------------------------------------------------ bodies (app/schemas/rosters.py) */

export interface PeriodBody {
  code: string;
  name: string;
  branch_id: number | null;
  start_date: string;
  end_date: string;
}

export interface DraftCellBody {
  employee_id: number;
  shift_date: string;
  entry_seq: number;
  action: "UPSERT" | "DELETE";
  kind?: EntryKind;
  shift_id?: number;
}

export interface PublishBody {
  dry_run?: boolean;
  acknowledged_warnings?: string[];
  reasons?: Record<string, string>;
}

/* ------------------------------------------------------------------ errors */

/** The structured API error of the shift and roster modules (`issues`, `details`). */
export { ShiftApiError as RosterApiError };

const STRUCTURED = new Set([400, 404, 409, 422]);

async function request<T>(method: Method, url: string, body?: unknown,
  options: { params?: Record<string, unknown>; idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (method.toLowerCase() !== "get") headers[IDEMPOTENCY_HEADER] = options.idempotencyKey ?? newIdempotencyKey();
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

const clean = (params: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));

/* ------------------------------------------------------------------ calls */

export const rostersApi = {
  list: (params: { status?: string; skip?: number; limit?: number } = {}) =>
    request<PageOf<RosterPeriod>>("get", "/rosters", undefined, { params: clean({ skip: 0, limit: 50, ...params }) }),
  create: (body: PeriodBody, idempotencyKey?: string) => request<RosterPeriod>("post", "/rosters", body, { idempotencyKey }),
  grid: (id: number | string) => request<RosterGridData>("get", `/rosters/${id}`),
  putDrafts: (id: number | string, cells: DraftCellBody[], rowVersion: number) =>
    request<{ saved: number; period: RosterPeriod }>("put", `/rosters/${id}/drafts`, { cells, row_version: rowVersion }),
  discardDrafts: (id: number | string, rowVersion: number) =>
    request<RosterPeriod>("delete", `/rosters/${id}/drafts`, undefined, { params: { row_version: rowVersion } }),
  validate: (id: number | string) => request<PublishPreview>("post", `/rosters/${id}/validate`),
  previewPublish: (id: number | string) => request<PublishPreview>("post", `/rosters/${id}/publish`, { dry_run: true }),
  publish: (id: number | string, body: PublishBody, idempotencyKey?: string) =>
    request<PublishDone>("post", `/rosters/${id}/publish`, { ...body, dry_run: false }, { idempotencyKey }),
  mySchedule: (from?: string, to?: string) =>
    request<MySchedule>("get", "/me/schedule", undefined, { params: clean({ from, to }) }),
  /** The roster generator: month periods and rotation drafts for `days` (default 90) from the branch-local today. */
  generateAhead: (branchId: number, days = 90, idempotencyKey?: string) =>
    request<GenerateAheadResult>("post", "/rotations/generate-ahead", { branch_id: branchId, days }, { idempotencyKey }),
};

export interface GenerateAheadResult {
  from: string;
  to: string;
  days: number;
  generated: number;
  periods: { period_id: number; code: string; start_date: string; end_date: string; generated: number }[];
}

/* ------------------------------------------------------------------ rotations (app/routes/shift_rotations.py) */

/** A token's shift (`{shift_id}`) or a second OFF token (`"OFF"`); `O` is always OFF and never mapped (§2.1). */
export type TokenTarget = { shift_id: number } | "OFF";

/** One of the 22 platform templates (`GET /rotations/templates`, `rotation_engine.TEMPLATES`, 03-shifts/02 §2.3). */
export interface RotationTemplate {
  key: string;
  number: number;
  name: string;
  cycle_days: number;
  tokens: string | null;
  crew_rows: Record<string, string> | null;
  crew_offsets: Record<string, number>;
  coverage: Record<string, number>;
  week_anchor_weekday: number | null;
  note: string;
  /** The research's default clock times per token (labels only; real times come from the mapped shifts). */
  default_shifts: Record<string, { start: string; end: string }>;
}

export type RotationVersionStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED";

/** `serialize_version`: exactly one of `tokens` (base row + `crew_offsets`) or `crew_rows`. */
export interface RotationVersion {
  id: number;
  pattern_id: number;
  version_no: number;
  status: RotationVersionStatus | string;
  cycle_days: number;
  tokens: string | null;
  crew_rows: Record<string, string> | null;
  crew_offsets: Record<string, number> | null;
  token_map: Record<string, TokenTarget> | null;
  coverage: Record<string, number> | null;
  week_anchor_weekday: number | null;
  lints_muted: string[];
  content_hash: string;
  row_version: number;
}

/** `serialize_pattern`: the pattern with every version, oldest first. */
export interface RotationPattern {
  id: number;
  code: string;
  name: string;
  template_key: string | null;
  branch_id: number | null;
  legal_entity_id: number | null;
  status: "ACTIVE" | "ARCHIVED" | string;
  current_version_id: number | null;
  row_version: number;
  versions: RotationVersion[];
}

export interface RotationPatternBody {
  code: string;
  name: string;
  template_key: string | null;
}

/** `PatternVersionIn`: a save always adds a new DRAFT version (an ACTIVE version is never edited, §2.5). */
export interface RotationVersionBody {
  cycle_days: number;
  tokens: string | null;
  crew_rows: Record<string, string> | null;
  crew_offsets: Record<string, number>;
  token_map: Record<string, TokenTarget>;
  coverage: Record<string, number>;
  week_anchor_weekday: number | null;
  lints_muted: string[];
}

/** A version save answers its fatigue lints (WARN only, never blocking; §2.7). */
export type SavedRotationVersion = RotationVersion & { lints: RuleResult[] };

export interface RotationAssignment {
  id: number;
  pattern_version_id: number;
  pattern_id: number;
  pattern_code: string;
  version_no: number;
  target_kind: "EMPLOYEE" | "TEAM" | string;
  employee_id: number | null;
  employee_name: string | null;
  employee_code: string | null;
  team_id: number | null;
  crew_code: string | null;
  offset_days: number;
  anchor_date: string;
  effective_from: string;
  effective_to: string | null;
  status: "ACTIVE" | "ENDED" | string;
  auto_publish: boolean;
  row_version: number;
}

/** `POST /rotation-assignments/{id}/end` (UA-AS-161): the last day, a reason and the row's `row_version`. */
export interface RotationAssignmentEndBody {
  effective_to: string;
  reason: string;
  row_version?: number;
}

/** `RotationAssignmentIn` (§3.3): one assignment per employee from `effective_from`. */
export interface RotationAssignBody {
  pattern_version_id: number;
  employee_ids: number[];
  crew_code: string | null;
  offset_days: number;
  anchor_date: string;
  effective_from: string;
  effective_to: string | null;
  auto_publish: boolean;
}

/** `GET /rotations/auto-publish/last`: the latest `roster.rotation_generate` job of the tenant (§3.5, EC AS-REL-06). */
export interface AutoPublishRun {
  job_id: number;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED" | string;
  local_date: string | null;
  progress_done: number;
  progress_total: number | null;
  created_at: string | null;
  finished_at: string | null;
  summary: {
    publications: number;
    entries: number | null;
    blocked_employees: number;
    chunks: number | null;
    failed_chunks: number | null;
  } | null;
  error: string | null;
}

export const rotationsApi = {
  templates: () => request<RotationTemplate[]>("get", "/rotations/templates"),
  list: () => request<RotationPattern[]>("get", "/rotations"),
  /** One pattern with its versions: the API lists every pattern of the tenant, so a missing id is a 404. */
  get: async (id: number | string): Promise<RotationPattern> => {
    const found = (await rotationsApi.list()).find((p) => p.id === Number(id));
    if (!found) throw new ShiftApiError(404, "Rotation pattern not found.", "NOT_FOUND");
    return found;
  },
  create: (body: RotationPatternBody, idempotencyKey?: string) =>
    request<RotationPattern & { lints: RuleResult[] }>("post", "/rotations", body, { idempotencyKey }),
  addVersion: (patternId: number | string, body: RotationVersionBody, idempotencyKey?: string) =>
    request<SavedRotationVersion>("post", `/rotations/${patternId}/versions`, body, { idempotencyKey }),
  activate: (patternId: number | string, versionNo: number, idempotencyKey?: string) =>
    request<RotationVersion>("post", `/rotations/${patternId}/versions/${versionNo}/activate`, undefined, { idempotencyKey }),
  assignments: (params: { pattern_id?: number; skip?: number; limit?: number } = {}) =>
    request<PageOf<RotationAssignment>>("get", "/rotation-assignments", undefined,
      { params: clean({ skip: 0, limit: 100, ...params }) }),
  assign: (body: RotationAssignBody, idempotencyKey?: string) =>
    request<{ items: RotationAssignment[] }>("post", "/rotation-assignments", body, { idempotencyKey }),
  /** ACTIVE → ENDED on `effective_to`; unpublished rotation drafts after it are deleted (published entries stay). */
  endAssignment: (id: number, body: RotationAssignmentEndBody, idempotencyKey?: string) =>
    request<RotationAssignment & { drafts_removed: number }>("post", `/rotation-assignments/${id}/end`, body,
      { idempotencyKey }),
  lastAutoPublish: () => request<AutoPublishRun | null>("get", "/rotations/auto-publish/last"),
};
