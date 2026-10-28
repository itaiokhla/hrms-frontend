/**
 * Typed client of the attendance day evaluations (AS-M3; backend app/routes/attendance_days.py,
 * app/services/attendance_days.py). V2-only: a v1 tenant answers 404 on every path. Attendance publishes facts
 * (results, marks, seconds); money is payroll's.
 */

import { http, toApiError } from "@/lib/api";

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
