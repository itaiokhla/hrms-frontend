/**
 * Typed client of capture v2 (AS-M2, G-06; backend app/routes/attendance_capture.py, attendance_sites.py,
 * attendance_devices.py, attendance_review.py, attendance_privacy.py, attendance_policies.py). Writes send an
 * `Idempotency-Key`; edits send `If-Match: "<row_version>"`. Errors keep the body's `code`, `issues` and `details`
 * (GEOFENCE_BLOCKED reason_allowed / distance_band, CONSENT_REQUIRED purpose, SITE_RADIUS_TOO_SMALL min_radius_m).
 *
 * The kiosk device calls (no user session) live in `kioskApi.ts`: they must not go through the session interceptors.
 */

import type { Method } from "axios";

import { ShiftApiError } from "@/components/shifts/api";
import { http, toApiError, type ApiIssue } from "@/lib/api";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/payroll/api";
import type { LocationAttempt } from "@/lib/geolocation";
import type { MyAttendance, SessionDetail } from "@/lib/types";

import type { Direction } from "./captureModel";

export { ShiftApiError as CaptureApiError };

/* ------------------------------------------------------------------ objects */

export interface PageOf<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
}

/** `GET /me/attendance/capture`: the effective capture policy of the punch screen (no geometry, no secrets). */
export interface CaptureView {
  profile: "STANDARD" | "LEGACY_V1" | string;
  sources: string[];
  /** AS-M12: punches made without network are queued on the phone and synced later. */
  offline_punches?: "OFF" | "ALLOW";
  offline_max_age_hours?: number;
  tracking?: { enabled: boolean; interval_minutes: number; grace_minutes: number; pause_on_break: boolean };
  shift_required: boolean;
  capture_required: boolean;
  face_on_punch: boolean;
  face_on_break: boolean;
  punch_photo: boolean;
  location_mode: "OFF" | "OPTIONAL" | "REQUIRED" | string;
  location_on_breaks: "OFF" | "OPTIONAL" | "REQUIRED" | string;
  location_failure_action: "ALLOW_WITH_REASON" | "BLOCK" | string;
  geofence_mode: "OFF" | "FLAG" | "REQUIRE_REASON" | "BLOCK" | string;
  ip_mode: "OFF" | "FLAG" | "BLOCK" | string;
  qr_mode: "OFF" | "REQUIRED" | string;
  multiple_sessions_allowed: boolean;
  allow_multiple_breaks: boolean;
  min_session_minutes: number;
  gps: { preferred_accuracy_m: number; acceptable_accuracy_m: number; max_fix_age_seconds: number };
  policy_id: number | null;
  policy_version: number | null;
  date: string;
  sites: { id: number; name: string; kind: string }[];
  /** OFF = no face step; REQUIRED = camera; SKIPPED = face on, but no valid face consent (punch without face). */
  face_step: "OFF" | "REQUIRED" | "SKIPPED";
  consents_needed: { purpose: string; notice_version: string | null }[];
}

/** What the punching employee may see of the site check: result, band and site name — never coordinates. */
export interface LocationCheck {
  result: "INSIDE" | "OUTSIDE" | "UNKNOWN" | "NOT_CHECKED" | string;
  label: string | null;
  distance_band: string | null;
  site_name: string | null;
  flags: string[];
}

export interface PunchResult extends MyAttendance {
  punch_id: number | null;
  direction: Direction;
  capture_source: "WEB" | "MOBILE";
  location_check: LocationCheck | null;
  face_step: "OFF" | "REQUIRED" | "SKIPPED";
}

export interface PunchMeta {
  direction: Direction;
  capture_source: "WEB" | "MOBILE";
  idempotency_key: string;
  attendance_id?: number;
  location?: LocationAttempt;
  location_consent?: boolean;
  exception_reason?: string;
  confirm_close_lunch?: boolean;
  work_location_choice?: "ON_SITE" | "REMOTE" | "FIELD";
  qr_payload?: string;
}

export interface Site {
  id: number;
  code: string;
  name: string;
  kind: string;
  legal_entity_id: number | null;
  branch_id: number | null;
  timezone: string | null;
  geometry_type: "CIRCLE" | "POLYGON" | "NONE";
  center_lat: number | null;
  center_lng: number | null;
  radius_m: number | null;
  polygon: number[][] | null;
  ip_ranges: string[];
  qr_configured: boolean;
  outdoor: boolean;
  status: "ACTIVE" | "ARCHIVED" | string;
  effective_from: string;
  effective_to: string | null;
  row_version: number;
  warnings: string[];
}

export interface SiteBody {
  code?: string;
  name?: string;
  kind?: string;
  legal_entity_id?: number | null;
  branch_id?: number | null;
  geometry_type?: "CIRCLE" | "POLYGON" | "NONE";
  center_lat?: number | null;
  center_lng?: number | null;
  radius_m?: number | null;
  polygon?: number[][] | null;
  ip_ranges?: string[];
  outdoor?: boolean;
  effective_from?: string | null;
  effective_to?: string | null;
}

export interface NetworkTest {
  client_ip: string;
  ip_version: number | null;
  is_private: boolean | null;
  matches: { site_id: number; site_code: string; ranges: string[] }[];
  ipv6_hint: string | null;
}

export interface Device {
  id: number;
  code: string;
  name: string;
  kind: string;
  vendor: string | null;
  integration: string | null;
  branch_id: number | null;
  site_id: number | null;
  timezone: string | null;
  status: "PENDING_ACTIVATION" | "ACTIVE" | "SUSPENDED" | "RETIRED" | string;
  health: string | null;
  paired: boolean;
  token_expires_at: string | null;
  claim_code_expires_at: string | null;
  activated_at: string | null;
  last_seen_at: string | null;
  row_version: number;
  allowed_actions: string[];
}

/** Create, reissue and resume answer the one-time claim code (shown once, valid 24 h). */
export interface DeviceWithClaim extends Device {
  claim_code?: string;
  claim_code_expires_at: string | null;
}

export interface DeviceBody {
  code: string;
  name: string;
  kind?: "KIOSK" | "TERMINAL" | "AGENT";
  branch_id?: number | null;
  site_id?: number | null;
  timezone?: string | null;
  vendor?: string | null;
  serial_number?: string | null;
  direction_mode?: string | null;
  device_role?: string | null;
}

/** TERMINAL / AGENT fields (AS-M7): computed health, watermark and protocol, never the secret. */
export interface IngestDevice extends Device {
  serial_number: string | null;
  direction_mode: string;
  device_role: string;
  has_secret: boolean;
  watermark_at: string | null;
  last_punch_at: string | null;
  last_clock_skew_seconds: number | null;
  backfill_from: string | null;
  protocol_version: string | null;
  endpoint: string;
}

/** Activate / rotate-secret: the secret is in this answer only (copy it into the device now). */
export interface DeviceConnection {
  secret: string;
  serial_number?: string | null;
  agent_id?: string | null;
  server_path: string;
  instructions: string;
}

export interface FirstContact {
  required: boolean;
  seen?: boolean;
  first_seen_at?: string;
  last_seen_at?: string;
  ip_hash?: string | null;
  payload_count?: number;
}

export interface DevicePunchRow {
  id: number;
  occurred_at: string;
  device_user_id: string | null;
  employee: { id: number; name: string; code: string } | null;
  direction: string;
  verify_mode: string | null;
  mapping_status: string;
  disposition: string;
  evidence_flags: string[];
}

export interface DeviceSummary {
  device: IngestDevice;
  punches: number;
  unmapped_user_ids: number;
  open_rejects: number;
  rejected_today: number;
  recent: DevicePunchRow[];
}

export interface DeviceMapping {
  id: number;
  device_id: number | null;
  device_user_id: string;
  device_user_label: string;
  employee_id: number;
  employee: { id: number; name: string; code: string } | null;
  effective_from: string;
  effective_to: string | null;
  sync_state: string;
  row_version: number;
}

export interface UnmappedUser {
  device_id: number | null;
  device_user_id: string;
  count: number;
  first_at: string | null;
  last_at: string | null;
}

export interface DeviceCommand {
  id: number;
  device_id: number;
  command: string;
  payload: Record<string, unknown>;
  status: string;
  return_code: string | null;
  expires_at: string | null;
  sent_at: string | null;
  acked_at: string | null;
  created_at: string | null;
  row_version: number;
}

export interface IngestReject {
  id: number;
  line_no: number;
  reason: string;
  payload_hash: string;
  ingest_batch_id: string;
  status: string;
  created_at: string | null;
}

export interface ImportRow {
  row: number;
  valid_time: boolean;
  employee_id?: number | null;
  employee?: { name: string; code: string } | null;
  employee_code?: string | null;
  device_user_id?: string | null;
  date?: string | null;
  time?: string | null;
  timezone?: string;
  direction?: string;
  occurred_at?: string;
  mapping_status?: string;
  issues: string[];
}

export interface PunchImport {
  id: number;
  file_name: string;
  status: "DRY_RUN" | "COMMITTED" | string;
  totals: { rows: number; valid: number; invalid: number; unmapped: number; duplicates: number; inserted?: number };
  rows: ImportRow[];
  created_at: string | null;
  committed_at: string | null;
}

export interface ReviewItem {
  id: number;
  kind: string;
  severity: "INFO" | "WARNING" | "HIGH" | string;
  status: "OPEN" | "ACKNOWLEDGED" | "APPROVED" | "REJECTED" | "RESOLVED" | string;
  employee_id: number | null;
  employee_name: string | null;
  shift_date: string | null;
  punch_id: number | null;
  session_id: number | null;
  location_sample_id: number | null;
  device_id: number | null;
  device_user_id: string | null;
  dedup_key: string | null;
  decided_by_user_id: number | null;
  decided_at: string | null;
  note: string | null;
  created_at: string | null;
  row_version: number;
  allowed_actions: string[];
}

export interface ReviewFilters {
  kind?: string[];
  status?: string;
  severity?: string;
  employee_id?: number;
  from?: string;
  to?: string;
  q?: string;
  skip?: number;
  limit?: number;
}

export interface Evidence {
  punch_id: number;
  employee_id: number;
  verify_mode: string | null;
  face_match_score: number | null;
  photo_available: boolean;
  photo_redacted: boolean;
  evidence_flags: string[];
}

export interface Consent {
  id: number;
  employee_id: number;
  purpose: string;
  purpose_label: string;
  scope: string;
  subject_ref: Record<string, unknown> | null;
  legal_basis: string;
  notice_version: string;
  status: string;
  valid_from: string;
  valid_to: string | null;
  notice_period_days: number | null;
  channel: string;
  recorded_by_user_id: number | null;
  recorded_at: string | null;
}

export interface PolicyDocument {
  id: number;
  code: string;
  version: string;
  title: string;
  legal_entity_id: number | null;
  effective_from: string;
  requires_acknowledgement: boolean;
  purposes: string[];
  summary: string | null;
  privacy_contact: string | null;
  status: "DRAFT" | "PUBLISHED" | "RETIRED" | string;
  published_at: string | null;
  row_version: number;
  acknowledged_at: string | null;
}

export interface PrivacyConsentRow {
  purpose: string;
  label: string;
  needed: boolean;
  status: string | null;
  legal_basis: string;
  notice_version: string | null;
  valid_from: string | null;
  valid_to: string | null;
  can_grant: boolean;
  can_withdraw: boolean;
  withdraw_effect: string | null;
}

export interface PrivacyPanel {
  employee_id: number;
  as_of: string;
  collection: {
    sources: string[];
    location_at_punch: string;
    location_on_breaks: string;
    tracking: boolean;
    /** Periodic location check interval while checked in (capture policy `tracking.interval_minutes`). */
    tracking_interval_minutes?: number | null;
    tracking_pause_on_break?: boolean;
    face_match: { on: boolean; applies_to_me: boolean; note: string | null };
    punch_photo: boolean;
    kiosk_methods: string[];
    site_checks: { geofence: string; network: string; qr: string };
    note: string;
  };
  retention: { class: string; label: string; days?: number; years?: number; days_after_exit?: number }[];
  viewers: { who: string; sees: string }[];
  consents: PrivacyConsentRow[];
  history: Consent[];
  documents: PolicyDocument[];
  evidence_views: { viewer: string; at: string; what?: string }[];
  contact: string | null;
}

export interface PolicyVersion {
  id: number;
  version: number;
  status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | string;
  effective_from: string;
  effective_to: string | null;
  fields: Record<string, unknown>;
  activated_at: string | null;
}

export interface PolicyRule {
  id: number;
  criteria: Record<string, unknown>;
  priority: number;
  effective_from: string;
  effective_to: string | null;
  status: string;
}

export interface CapturePolicyRow {
  id: number;
  type: string;
  name: string;
  description: string | null;
  status: string;
  active_version: PolicyVersion | null;
  latest_version: number | null;
  draft_versions: number[];
  rule_count: number;
  head_count?: number;
  head_count_scope?: string;
}

export interface CapturePolicyDetail extends CapturePolicyRow {
  versions: PolicyVersion[];
  assignments: PolicyRule[];
  rule_history?: PolicyRule[];
}

export interface RuleBody {
  criteria: Record<string, unknown>;
  priority: number;
  effective_from?: string | null;
  effective_to?: string | null;
}

/* ------------------------------------------------------------------ request */

const STRUCTURED = new Set([400, 404, 409, 410, 412, 422, 428]);

interface Options {
  rowVersion?: number;
  params?: Record<string, unknown>;
  idempotencyKey?: string;
  /** Repeat-style params (`kind=A&kind=B`). */
  paramsSerializer?: (params: Record<string, unknown>) => string;
}

async function request<T>(method: Method, url: string, body?: unknown, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (method.toLowerCase() !== "get") headers[IDEMPOTENCY_HEADER] = options.idempotencyKey ?? newIdempotencyKey();
  if (options.rowVersion !== undefined) headers["If-Match"] = `"${options.rowVersion}"`;
  let response;
  try {
    response = await http.request<T>({
      method, url, data: body, params: options.params, headers,
      paramsSerializer: options.paramsSerializer ? { serialize: options.paramsSerializer } : undefined,
      validateStatus: (s) => (s >= 200 && s < 300) || STRUCTURED.has(s),
    });
  } catch (error) {
    throw toApiError(error);
  }
  if (response.status >= 300) {
    const data = (response.data ?? {}) as { detail?: unknown; code?: string; issues?: ApiIssue[]; details?: Record<string, unknown> };
    const list = Array.isArray(data.detail) ? (data.detail as { field: string; msg: string }[]) : undefined;
    const detail = data.detail as { message?: unknown; details?: Record<string, unknown> } | string | undefined;
    const message = typeof detail === "string" ? detail
      : list ? list.map((d) => d.msg).join(". ")
        : detail && typeof detail === "object" && typeof detail.message === "string" ? detail.message : "Request failed.";
    const details = data.details ?? (detail && typeof detail === "object" && !list ? detail.details : undefined);
    throw new ShiftApiError(response.status, message, data.code, data.issues ?? [], details, list);
  }
  return response.data;
}

const clean = (params: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));

/**
 * `kind=A&kind=B` (FastAPI list query) for the review queue. `status=` stays even when empty: an empty status means
 * "every status" (the route's default is OPEN).
 */
export function repeatParams(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || (value === "" && key !== "status")) continue;
    if (Array.isArray(value)) value.forEach((v) => search.append(key, String(v)));
    else search.append(key, String(value));
  }
  return search.toString();
}

/* ------------------------------------------------------------------ calls */

export const captureApi = {
  /* self service */
  myCapture: () => request<CaptureView>("get", "/me/attendance/capture"),
  myToday: () => request<MyAttendance>("get", "/attendance/me/today"),
  punch: (meta: PunchMeta, image?: Blob | null) => {
    const form = new FormData();
    form.append("meta", JSON.stringify({ ...meta, client_sent_at: new Date().toISOString() }));
    if (image) form.append("file", image, "capture.jpg");
    return request<PunchResult>("post", "/attendance/me/punch", form, { idempotencyKey: meta.idempotency_key });
  },
  privacy: () => request<PrivacyPanel>("get", "/me/attendance/privacy"),
  setMyConsent: (body: { purpose: string; status: "GRANTED" | "DECLINED" | "WITHDRAWN"; notice_version?: string | null }) =>
    request<Consent>("post", "/me/attendance/consents", clean(body)),
  acknowledge: (documentId: number) =>
    request<{ id: number; document_id: number; acknowledged_at: string }>("post", `/me/attendance/policy-documents/${documentId}/acknowledge`),

  /* sessions and evidence */
  session: (id: number | string, includeLocations = false) =>
    request<SessionDetail>("get", `/attendance/sessions/${id}`, undefined, { params: { include_locations: includeLocations } }),
  revealEvidence: (punchId: number) => request<Evidence>("post", `/attendance/punches/${punchId}/evidence`),

  /* sites */
  sites: (params: { status?: string; branch_id?: number; q?: string; skip?: number; limit?: number } = {}) =>
    request<PageOf<Site>>("get", "/attendance/sites", undefined, { params: clean({ skip: 0, limit: 25, ...params }) }),
  site: (id: number | string) => request<Site>("get", `/attendance/sites/${id}`),
  createSite: (body: SiteBody, idempotencyKey?: string) => request<Site>("post", "/attendance/sites", body, { idempotencyKey }),
  updateSite: (id: number, body: SiteBody, rowVersion: number) =>
    request<Site>("patch", `/attendance/sites/${id}`, body, { rowVersion }),
  archiveSite: (id: number, rowVersion: number, reason?: string) =>
    request<Site>("post", `/attendance/sites/${id}/archive`, clean({ reason }), { rowVersion }),
  rotateQr: (id: number, rowVersion: number) =>
    request<Site & { qr_payload: string }>("post", `/attendance/sites/${id}/rotate-qr`, undefined, { rowVersion }),
  networkTest: (params: { site_id?: number; branch_id?: number } = {}) =>
    request<NetworkTest>("get", "/attendance/sites/network-test", undefined, { params: clean(params) }),

  /* devices: KIOSK registry (AS-M2), TERMINAL / AGENT (AS-M7) */
  devices: (params: { status?: string; q?: string; kind?: string; skip?: number; limit?: number } = {}) =>
    request<PageOf<Device & Partial<IngestDevice>>>("get", "/attendance/devices", undefined, { params: clean({ skip: 0, limit: 25, ...params }) }),
  device: (id: number | string) => request<Device & Partial<IngestDevice>>("get", `/attendance/devices/${id}`),
  createDevice: (body: DeviceBody, idempotencyKey?: string) =>
    request<DeviceWithClaim & Partial<IngestDevice>>("post", "/attendance/devices", { kind: "KIOSK", ...clean({ ...body }) }, { idempotencyKey }),
  reissueClaim: (id: number) => request<DeviceWithClaim>("post", `/attendance/devices/${id}/claim-code`),
  deviceAction: (id: number, action: "suspend" | "resume" | "retire", rowVersion: number, reason?: string) =>
    request<DeviceWithClaim>("post", `/attendance/devices/${id}/${action}`, clean({ reason }), { rowVersion }),
  firstContact: (id: number) => request<FirstContact>("get", `/attendance/devices/${id}/first-contact`),
  deviceSummary: (id: number) => request<DeviceSummary>("get", `/attendance/devices/${id}/summary`),
  activateDevice: (id: number, body: { claim_code: string; serial_number?: string }) =>
    request<IngestDevice & { connection: DeviceConnection }>("post", `/attendance/devices/${id}/activate`, clean(body)),
  rotateSecret: (id: number) =>
    request<IngestDevice & { connection: DeviceConnection }>("post", `/attendance/devices/${id}/rotate-secret`),
  updateDevice: (id: number, body: Partial<DeviceBody>, rowVersion: number) =>
    request<IngestDevice>("patch", `/attendance/devices/${id}`, clean({ ...body }), { rowVersion }),
  deviceCommands: (id: number) => request<{ items: DeviceCommand[] }>("get", `/attendance/devices/${id}/commands`),
  queueCommand: (id: number, command: string, payload: Record<string, unknown> = {}) =>
    request<DeviceCommand>("post", `/attendance/devices/${id}/commands`, { command, payload }),
  cancelCommand: (id: number, commandId: number, rowVersion: number) =>
    request<DeviceCommand>("post", `/attendance/devices/${id}/commands/${commandId}/cancel`, undefined, { rowVersion }),
  deviceRejects: (id: number) => request<{ items: IngestReject[] }>("get", `/attendance/devices/${id}/rejects`),
  revealReject: (id: number, rejectId: number) =>
    request<{ id: number; raw_line: string | null; reason: string }>("post", `/attendance/devices/${id}/rejects/${rejectId}/reveal`),
  dismissReject: (id: number, rejectId: number) =>
    request<{ id: number; status: string }>("post", `/attendance/devices/${id}/rejects/${rejectId}/dismiss`),

  /* device user mappings (M-1..M-11) */
  mappings: (params: { device_id?: number | null; q?: string; skip?: number; limit?: number } = {}) =>
    request<PageOf<DeviceMapping> & { unmapped: UnmappedUser[] }>("get", "/attendance/device-mappings", undefined,
      { params: clean({ skip: 0, limit: 50, ...params }) }),
  saveMappings: (items: { device_id?: number | null; device_user_id: string; employee_id: number; effective_from?: string; effective_to?: string | null }[]) =>
    request<{ items: DeviceMapping[]; mapped_dates: number }>("post", "/attendance/device-mappings", { items }),
  autoMatch: (body: { device_id?: number | null; effective_from?: string; dry_run?: boolean }) =>
    request<{ dry_run: boolean; would_create?: number; created?: number; skipped: { employee_code: string; reason: string }[];
      items: { employee_name?: string; device_user_id: string; canonical?: string }[] }>("post", "/attendance/device-mappings/auto-match", body),
  endMapping: (id: number, effectiveTo: string, rowVersion: number) =>
    request<DeviceMapping>("post", `/attendance/device-mappings/${id}/end`, { effective_to: effectiveTo }, { rowVersion }),

  /* CSV punch imports (01 §8.6) */
  importPunches: (file: File, dryRun = true) => {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("dry_run", dryRun ? "true" : "false");
    return request<PunchImport>("post", "/attendance/imports", form);
  },
  commitImport: (id: number) => request<PunchImport>("post", `/attendance/imports/${id}/commit`),

  /* review queue */
  review: (filters: ReviewFilters = {}) =>
    request<PageOf<ReviewItem>>("get", "/attendance/review", undefined, {
      params: { skip: 0, limit: 25, ...filters, status: filters.status ?? "OPEN" }, paramsSerializer: repeatParams,
    }),
  decide: (id: number, body: { status: string; note?: string }, rowVersion: number) =>
    request<ReviewItem>("post", `/attendance/review/${id}/decide`, clean(body), { rowVersion }),

  /* capture policy (ATTENDANCE_CAPTURE_POLICY) */
  policies: (includeArchived = false) =>
    request<CapturePolicyRow[]>("get", "/attendance/policies", undefined, {
      params: { type: "ATTENDANCE_CAPTURE_POLICY", include_archived: includeArchived },
    }),
  policy: (id: number) => request<CapturePolicyDetail>("get", `/attendance/policies/${id}`),
  createPolicy: (body: { name: string; description?: string; fields?: Record<string, unknown>; effective_from?: string }) =>
    request<CapturePolicyDetail>("post", "/attendance/policies", { type: "ATTENDANCE_CAPTURE_POLICY", ...clean(body) }),
  newVersion: (id: number, body: { fields?: Record<string, unknown>; effective_from?: string } = {}) =>
    request<PolicyVersion>("post", `/attendance/policies/${id}/versions`, clean(body)),
  updateVersion: (id: number, version: number, body: { fields: Record<string, unknown>; effective_from?: string }) =>
    request<PolicyVersion>("put", `/attendance/policies/${id}/versions/${version}`, clean(body)),
  activate: (id: number, version: number, body: { effective_from?: string; reason?: string } = {}) =>
    request<PolicyVersion & { warnings: string[]; message?: string }>(
      "post", `/attendance/policies/${id}/versions/${version}/activate`, clean(body)),
  assignments: (id: number) => request<{ policy_id: number; rules: PolicyRule[] }>("get", `/attendance/policies/${id}/assignments`),
  putAssignments: (id: number, rules: RuleBody[]) =>
    request<{ policy_id: number; rules: PolicyRule[] }>("put", `/attendance/policies/${id}/assignments`, { rules }),
  archivePolicy: (id: number) => request<CapturePolicyRow>("post", `/attendance/policies/${id}/archive`),
  prepareCapture: () => request<Record<string, unknown>>("post", "/attendance/setup/prepare-capture"),
  policyDocuments: (status?: string) =>
    request<{ items: PolicyDocument[] }>("get", "/attendance/policy-documents", undefined, { params: clean({ status }) }),
};

/** Find one review item by id (there is no `GET /attendance/review/{id}`: the queue is paged until it is found). */
export async function findReviewItem(id: number, maxPages = 10): Promise<ReviewItem | null> {
  const limit = 200;
  for (let page = 0; page < maxPages; page++) {
    const result = await captureApi.review({ status: "", skip: page * limit, limit });
    const found = result.items.find((i) => i.id === id);
    if (found) return found;
    if ((page + 1) * limit >= result.total) return null;
  }
  return null;
}
