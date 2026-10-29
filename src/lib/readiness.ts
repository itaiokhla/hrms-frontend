/** Country packs, industry bundles, Fair Workweek estimate and cut-over readiness (G-22 / G-23;
 * backend app/routes/attendance_readiness.py). */
import { payrollApi } from "./payroll/api";

export interface PackEntity {
  legal_entity_id: number; name: string; country: string; has_pack: boolean; adopted: boolean; verified: boolean;
  daily_max_today: string | null;
  pack: null | {
    name: string; verified: boolean; sources: string[]; weekly_max_hours: string | null; daily_max_hours: string | null;
    max_days_per_week: number | null; max_consecutive_days: number | null; weekly_rest_min_hours: string | null;
    breaks: { kind: string; after_minutes: number; minutes: number; paid: boolean }[];
    overtime: { multiplier: string; night_multiplier?: string; requires_consent: boolean; weekly_threshold_hours?: number;
      caps: { window: string; hours: number }[] };
    privacy: { location_retention_days_max: number | null; biometric_timekeeping: string; punch_photo_allowed: boolean };
    scheduling: { notice_hours: number | null; late_addition_consent: boolean;
      predictability_pay_hours?: Record<string, number> };
    reduced_hours_windows?: { code: string; from: string; to: string; daily_max_hours: string }[];
  };
}
export interface Bundle {
  code: string; name: string; country: string; description: string; applied: boolean;
  policies: { type: string; fields: Record<string, unknown> }[];
}
export interface CheckItem { key: string; label: string; status: "PASS" | "WARN" | "FAIL" | "INFO"; detail: string; link: string | null }
export interface AcceptanceRun {
  job_id: number; status: string; started_by_user_id: number | null; created_at: string | null;
  summary: { PASS: number; WARN: number; FAIL: number; INFO: number; ready: boolean } | null;
  items: CheckItem[]; probes: { key: string; status: string; detail: string }[];
  signed_off_by_user_id: number | null; signed_off_at: string | null; sign_off_note?: string | null; error: string | null;
}
export interface FairWorkweek {
  legal_entity_id: number; applies: boolean; adopted?: boolean; notice_hours: number | null; total_hours: string;
  employees: { employee_id: number; employee_name: string | null; hours: string }[];
  items: { employee_id: number; employee_name: string | null; shift_date: string; change_kind: string;
    notice_hours: string; kind: "CHANGE" | "CANCELLATION_24H"; hours: string }[];
}

export const readinessApi = {
  packs: () => payrollApi.get<{ version: string; items: PackEntity[]; available: string[] }>("/attendance/packs"),
  adopt: (legalEntityId: number, enabled: boolean, reason: string) =>
    payrollApi.put<{ items: PackEntity[] }>(`/attendance/packs/${legalEntityId}`, { enabled, reason }),
  fairWorkweek: (legalEntityId: number, from: string, to: string) =>
    payrollApi.get<FairWorkweek>(`/attendance/packs/${legalEntityId}/fair-workweek`, { params: { from, to } }),
  bundles: () => payrollApi.get<{ items: Bundle[] }>("/attendance/bundles"),
  applyBundle: (code: string) =>
    payrollApi.post<{ bundle: string; created: { policy_id: number; type: string; name: string }[] }>(
      `/attendance/bundles/${code}/apply`, {}),
  readiness: () =>
    payrollApi.get<{ items: CheckItem[]; summary: AcceptanceRun["summary"]; last_acceptance: AcceptanceRun | null }>(
      "/attendance/readiness"),
  startAcceptance: () => payrollApi.post<{ job_id: number }>("/attendance/readiness/acceptance", {}),
  acceptance: (jobId: number) => payrollApi.get<AcceptanceRun>(`/attendance/readiness/acceptance/${jobId}`),
  signOff: (jobId: number, note?: string) =>
    payrollApi.post<AcceptanceRun>(`/attendance/readiness/acceptance/${jobId}/sign-off`, { note: note || null }),
};
