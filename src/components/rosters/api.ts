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
