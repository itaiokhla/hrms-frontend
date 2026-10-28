/**
 * Typed client of the attendance day evaluations (AS-M3; backend app/routes/attendance_days.py,
 * app/services/attendance_days.py). V2-only: a v1 tenant answers 404 on every path. Attendance publishes facts
 * (results, marks, seconds); money is payroll's.
 */

import { http, toApiError } from "@/lib/api";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/payroll/api";

export type DayResult = "PRESENT" | "HALF_DAY" | "ABSENT" | "MISSING_PUNCH" | "UNMARKED" | "PENDING" | "OFF";
export type PortionResult = "PRESENT" | "ABSENT" | "MISSING_PUNCH" | "UNMARKED" | "PENDING" | "OFF";
export type EvaluationState = "OPEN" | "PROVISIONAL" | "FINAL";

export interface AttendanceDay {
  id: number;
  employee_id: number;
  shift_date: string;
  version: number;
  evaluation_state: EvaluationState;
  rules_mode: "LEGACY_V1" | "STANDARD";
  content_hash: string;
  expected_portion: "FULL" | "FIRST_HALF" | "SECOND_HALF" | "NONE";
  expected_minutes: number | null;
  expected_start_at: string | null;
  expected_end_at: string | null;
  session_count: number;
  first_in_at: string | null;
  last_out_at: string | null;
  gross_minutes: number | null;
  net_seconds: number | null;
  net_minutes: number | null;
  unpaid_break_minutes: number | null;
  auto_deducted_minutes: number;
  late_minutes: number | null;
  early_minutes: number | null;
  short_minutes: number | null;
  late_mark: boolean;
  late_excused: boolean;
  late_excuse_source: "REQUEST" | "POLICY" | null;
  early_mark: boolean;
  early_excused: boolean;
  early_excuse_source: "REQUEST" | "POLICY" | null;
  short_mark: boolean;
  late_converted: boolean;
  early_converted: boolean;
  night_minutes: number;
  ot_eligible_minutes: number;
  ot_candidate_minutes: number;
  first_half_result: PortionResult;
  second_half_result: PortionResult;
  day_result: DayResult;
  presence_basis: string | null;
  exception_codes: string[];
  pending_reasons: string[];
  evaluated_at: string;
  trigger: string;
  history?: { version: number; trigger: string; created_at: string; changed: string[] }[];
}

export interface DayExplain {
  close_point: string;
  phase: "BEFORE_CLOSE" | "AFTER_CLOSE";
  rules_mode: string;
  expected_portion: string;
  reasons: string[];
  instances: { kind: string; start: string | null; end: string | null; shift_version_id: number | null }[];
  net_closed_seconds: number | null;
}

export interface DayResponse {
  day: AttendanceDay | null;
  explain?: DayExplain;
}

export const attendanceDaysApi = {
  get: async (employeeId: string | number, date: string, explain = false): Promise<DayResponse> => {
    try {
      const response = await http.get<DayResponse>(`/attendance/days/${employeeId}/${date}`,
        { params: explain ? { explain: true } : undefined });
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },
};

/* ------------------------------------------------------------------ exceptions (04-attendance/03 §12) */

export interface ExceptionItem {
  day_id: number;
  employee_id: number;
  employee_name: string;
  shift_date: string;
  day_result: DayResult;
  evaluation_state: EvaluationState;
  exception_codes: string[];
  late_minutes: number | null;
  early_minutes: number | null;
  net_minutes: number | null;
}

export interface ExceptionQuery {
  start: string;
  end: string;
  code?: string;
  skip?: number;
  limit?: number;
}

/* ------------------------------------------------------------------ cut-over (spine §15.1) */

export interface ReconcileDifference {
  employee_id: number;
  date: string;
  field: string;
  legacy: unknown;
  v2: unknown;
}

export interface ReconcileSummary {
  job_id: number;
  status: string;
  started_by_user_id: number | null;
  created_at: string | null;
  start: string | null;
  end: string | null;
  days: number | null;
  differences: number | null;
  items: ReconcileDifference[];
}

export interface CutoverStatus {
  state: "LEGACY" | "RECONCILING" | "V2_ACTIVE";
  prepared: boolean;
  last_reconcile: ReconcileSummary | null;
}

async function call<T>(run: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await run()).data;
  } catch (error) {
    throw toApiError(error);
  }
}

export const attendanceExceptionsApi = {
  list: (query: ExceptionQuery) =>
    call(() => http.get<{ total: number; items: ExceptionItem[] }>("/attendance/exceptions", { params: query })),
};

const writeHeaders = () => ({ headers: { [IDEMPOTENCY_HEADER]: newIdempotencyKey() } });

export const attendanceCutoverApi = {
  status: () => call(() => http.get<CutoverStatus>("/attendance/setup/status")),
  prepare: () => call(() => http.post<Record<string, unknown>>("/attendance/setup/prepare", {}, writeHeaders())),
  reconcile: (start: string, end: string) =>
    call(() => http.post<ReconcileSummary>("/attendance/setup/reconcile", { start, end }, writeHeaders())),
  cutover: (reconcileJobId: number) =>
    call(() => http.post<CutoverStatus>("/attendance/setup/cutover", { reconcile_job_id: reconcileJobId },
      writeHeaders())),
};

/* ------------------------------------------------------------------ rules policy editor (02 §4.3, §5.4) */

export interface RulesFields {
  day_basis: "PRESENCE" | "HOURS";
  hours_basis: "NET" | "GROSS";
  threshold_mode: "ABSOLUTE" | "PERCENT_OF_EXPECTED";
  full_day_min_minutes: string;
  half_day_min_minutes: string;
  full_day_min_percent: number;
  half_day_min_percent: number;
  absent_marking: "AUTO_ABSENT" | "LEAVE_UNMARKED";
  grace_in_minutes: number | null;
  grace_out_minutes: number;
  late_half_day_after_minutes: number | null;
  early_half_day_before_minutes: number | null;
  late_waiver: "NONE" | "NET_GE_EXPECTED" | "GROSS_GE_EXPECTED";
  early_waiver: "NONE" | "NET_GE_EXPECTED" | "GROSS_GE_EXPECTED";
  short_hours_enabled: boolean;
  short_tolerance_minutes: number;
  break_attestation: boolean;
  ot_post_shift_buffer_minutes: number;
}

export interface PolicySummary {
  id: number;
  name: string;
  type: string;
  status: string;
  active_version?: { version: number; fields: Record<string, unknown>; effective_from: string } | null;
  versions?: { version: number; status: string; fields: Record<string, unknown> }[];
}

export interface SimulateResult {
  window: { start: string; end: string } | null;
  population: { covered_now: number; covered_after: number; joining_count: number; leaving_count: number };
  dates: { OPEN: number; INPUT_LOCKED: number; FINALIZED: number };
  changes: { day_result?: Record<string, number>; changed_days?: number; late_marks_added?: number;
             late_marks_removed?: number; ot_candidate_minutes_delta?: number; night_minutes_delta?: number };
  sample: { employee_id: number; days: { date: string; before: { day_result: string }; after: { day_result: string } }[] }[];
  bounded: boolean;
  v2_active: boolean;
}

const EVERYONE = [{ criteria: { everyone: true }, priority: 10 }];

export const attendanceRulesApi = {
  list: () => call(() => http.get<PolicySummary[]>("/attendance/policies", { params: { type: "ATTENDANCE_RULES_POLICY" } })),
  create: (name: string, fields: RulesFields) =>
    call(() => http.post<PolicySummary>("/attendance/policies", { type: "ATTENDANCE_RULES_POLICY", name, fields },
                                         writeHeaders())),
  assignEveryone: (policyId: number) =>
    call(() => http.put(`/attendance/policies/${policyId}/assignments`, { rules: EVERYONE }, writeHeaders())),
  simulate: (policyId: number, version: number, effectiveFrom: string) =>
    call(() => http.post<SimulateResult>(`/attendance/policies/${policyId}/versions/${version}/simulate`,
                                         { effective_from: effectiveFrom, assignments: EVERYONE })),
  activate: (policyId: number, version: number, effectiveFrom: string, reason: string, applyToLocked: boolean) =>
    call(() => http.post(`/attendance/policies/${policyId}/versions/${version}/activate`,
                         { effective_from: effectiveFrom, reason, apply_to_locked_periods: applyToLocked },
                         writeHeaders())),
};
