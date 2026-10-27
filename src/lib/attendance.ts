import { api } from "@/lib/api";
import type { LocationAttempt } from "@/lib/geolocation";
import type { AttendanceAction, AttendancePolicy, Hours, LocationMode, MyAttendance } from "@/lib/types";

export const ACTION_LABELS: Record<AttendanceAction, string> = {
  PUNCH_IN: "Punch in",
  LUNCH_IN: "Start lunch",
  LUNCH_OUT: "End lunch",
  PUNCH_OUT: "Punch out",
};

export const EVENT_LABELS: Record<string, string> = {
  PUNCH_IN: "Punched in",
  LUNCH_IN: "Lunch started",
  LUNCH_OUT: "Lunch ended",
  PUNCH_OUT: "Punched out",
  SESSION_CLOSED: "Closed without punch-out",
  CORRECTION: "Corrected by HR",
};

const PATHS: Record<AttendanceAction, string> = {
  PUNCH_IN: "check-in",
  LUNCH_IN: "lunch-in",
  LUNCH_OUT: "lunch-out",
  PUNCH_OUT: "check-out",
};

/** One id per user intent: retries and double clicks of the same intent reuse it. */
export function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

export interface ActionMeta {
  idempotency_key: string;
  attendance_id?: number;
  location?: LocationAttempt;
  location_consent?: boolean;
  exception_reason?: string;
  confirm_close_lunch?: boolean;
}

export function sendAction(action: AttendanceAction, meta: ActionMeta, image?: Blob | null) {
  const form = new FormData();
  // Stamped at send time so the server can tell how old the location reading is.
  form.append("meta", JSON.stringify({ ...meta, client_sent_at: new Date().toISOString() }));
  if (image) form.append("file", image, "capture.jpg");
  return api.post<MyAttendance>(`/attendance/me/${PATHS[action]}`, form);
}

export function locationModeFor(policy: AttendancePolicy, action: AttendanceAction): LocationMode {
  return action === "PUNCH_IN" || action === "PUNCH_OUT" ? policy.location.punch : policy.location.lunch;
}

export function faceRequiredFor(policy: AttendancePolicy, action: AttendanceAction): boolean {
  return action === "PUNCH_IN" || action === "PUNCH_OUT" ? policy.require_face : policy.require_face_for_lunch;
}

/** The location notice is acknowledged at punch-in whenever the company collects any location. */
export function noticeRequired(policy: AttendancePolicy): boolean {
  return policy.tracking.enabled || policy.location.punch !== "OFF";
}

/**
 * Whether the lunch in progress is paid: the open break's own snapshot (stored when it started), not the company's
 * current policy, which may have changed since (BUG-AS-17). Without an open break the fallback is returned.
 */
export function openBreakIsPaid(breaks: { ended_at: string | null; is_paid: boolean }[] | undefined, fallback: boolean): boolean {
  const open = (breaks ?? []).find((b) => b.ended_at === null);
  return open ? open.is_paid : fallback;
}

/**
 * Hours "now" from the server's provisional totals: the counters advance by the
 * time elapsed since the server computed them (never from the device clock alone).
 */
export function liveHours(hours: Hours, state: string, lunchIsPaid: boolean, elapsedSeconds: number) {
  const elapsed = hours.provisional ? Math.max(0, Math.floor(elapsedSeconds)) : 0;
  const onLunch = state === "ON_LUNCH";
  return {
    gross: (hours.gross_seconds ?? 0) + elapsed,
    lunch: hours.lunch_seconds + (onLunch ? elapsed : 0),
    net: (hours.net_seconds ?? 0) + (onLunch && !lunchIsPaid ? 0 : elapsed),
    complete: hours.complete,
    provisional: hours.provisional,
  };
}
