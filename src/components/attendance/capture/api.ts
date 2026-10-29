/**
 * Typed client of the ATTENDANCE_CAPTURE_POLICY editor (AS-M2; `/attendance/policies?type=…`). Sites and the privacy
 * panel use `captureApi` (`../captureApi.ts`).
 */

import { http, toApiError } from "@/lib/api";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/payroll/api";

import type { PolicySummary } from "../days/api";

async function call<T>(run: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await run()).data;
  } catch (error) {
    throw toApiError(error);
  }
}

const writeHeaders = (extra?: Record<string, string>) => ({ headers: { [IDEMPOTENCY_HEADER]: newIdempotencyKey(), ...extra } });

export const CAPTURE_TYPE = "ATTENDANCE_CAPTURE_POLICY";

/** Spine §6.2.1 fields the editor writes (the server validates again: INVALID_FIELDS). */
export interface CaptureFields {
  profile?: "STANDARD" | "LEGACY_V1";
  allowed_sources: string[];
  shift_required: boolean;
  capture_required: boolean;
  face_on_punch: boolean;
  face_on_break: boolean;
  punch_photo: boolean;
  kiosk_methods: string[];
  dpia_reference: string | null;
  location_mode: "OFF" | "OPTIONAL" | "REQUIRED";
  location_on_breaks: "OFF" | "OPTIONAL" | "REQUIRED";
  location_failure_action: "ALLOW_WITH_REASON" | "BLOCK";
  reject_low_accuracy: boolean;
  gps: { preferred_accuracy_m: number; acceptable_accuracy_m: number; timeout_seconds: number; max_attempts: number; max_fix_age_seconds: number };
  geofence_mode: "OFF" | "FLAG" | "REQUIRE_REASON" | "BLOCK";
  allowed_site_ids: number[] | null;
  ip_mode: "OFF" | "FLAG" | "BLOCK";
  qr_mode: "OFF" | "REQUIRED";
  tracking: { enabled: boolean; interval_minutes: number; grace_minutes: number; pause_on_break: boolean; movement_threshold_m: number };
  multiple_sessions_allowed: boolean;
  allow_multiple_breaks: boolean;
  break_open_at_punch_out: "CONFIRM_AUTO_CLOSE" | "BLOCK";
  min_session_minutes: number;
  auto_close_mode: "MAX_DURATION" | "SHIFT_END_PLUS";
  max_session_hours: number;
  auto_close_after_minutes: number;
  infer_breaks_from_punches: boolean;
  max_break_gap_minutes: number;
  offline_punches: "OFF" | "ALLOW";
  offline_max_age_hours: number;
  supervisor_muster: { enabled: boolean; photo_required: boolean; geofence_mode: "OFF" | "FLAG" | "REQUIRE_REASON" | "BLOCK"; offline_allowed: boolean };
}

export interface PolicyDetail extends PolicySummary {
  versions?: { version: number; status: string; fields: Record<string, unknown>; effective_from?: string | null }[];
}

const EVERYONE = [{ criteria: { everyone: true }, priority: 10 }];

export const capturePolicyApi = {
  list: () => call(() => http.get<PolicySummary[]>("/attendance/policies", { params: { type: CAPTURE_TYPE } })),
  get: (id: number) => call(() => http.get<PolicyDetail>(`/attendance/policies/${id}`)),
  create: (name: string, fields: CaptureFields, effectiveFrom: string) =>
    call(() => http.post<PolicyDetail>("/attendance/policies",
      { type: CAPTURE_TYPE, name, fields, effective_from: effectiveFrom }, writeHeaders())),
  newVersion: (id: number, fields: CaptureFields, effectiveFrom: string) =>
    call(() => http.post<{ version: number }>(`/attendance/policies/${id}/versions`,
      { fields, effective_from: effectiveFrom }, writeHeaders())),
  assignEveryone: (id: number) =>
    call(() => http.put(`/attendance/policies/${id}/assignments`, { rules: EVERYONE }, writeHeaders())),
  activate: (id: number, version: number, effectiveFrom: string, reason: string) =>
    call(() => http.post<{ warnings?: string[] }>(`/attendance/policies/${id}/versions/${version}/activate`,
      { effective_from: effectiveFrom, reason }, writeHeaders())),
  resolve: (employeeId: number) =>
    call(() => http.get<Record<string, unknown>>("/attendance/policies/resolve", { params: { type: CAPTURE_TYPE, employee_id: employeeId } })),
};
