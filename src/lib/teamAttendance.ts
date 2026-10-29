/** Team attendance (IG-AS-98..100): the manager's board, punching for a team member, deleting a session, settings. */
import { api } from "./api";

export interface TeamSettings {
  proxy_punch_enabled: boolean;
  proxy_punch_location: "REQUIRED" | "OPTIONAL" | "OFF";
  allow_manual_location: boolean;
  reason_required: boolean;
  edit_enabled: boolean;
  can_manage?: boolean;
}

export interface TeamMember {
  employee_id: number;
  name: string;
  employee_code: string | null;
  position: string | null;
  state: "NOT_PUNCHED_IN" | "WORKING" | "PUNCHED_OUT";
  session_id: number | null;
  check_in_time: string | null;
  check_out_time: string | null;
  capture_source: string | null;
  /** The shift date the session (or the next punch in) belongs to; after midnight it can be yesterday. */
  shift_date: string | null;
  /** What a manager may do now: [] when the shift date is complete and one session per day applies. */
  actions: ("IN" | "OUT")[];
  can_punch: boolean;
  tracking: MemberTracking | null;
}

/** Periodic location checks of a live session (the "about every N minutes" sampling). */
export interface MemberTracking {
  state: "ACTIVE" | "PAUSED" | "STOPPED" | null;
  stop_reason: string | null;
  interval_minutes: number | null;
  schedule_state: "SCHEDULED" | "DUE" | "OVERDUE" | null;
  next_due_at: string | null;
  missed: number;
  last_at: string | null;
  last_type: string | null;
  accuracy_m: number | null;
  can_see_location: boolean;
  latitude?: number | null;
  longitude?: number | null;
}

export interface TeamBoard {
  date: string; settings: TeamSettings; can_punch: boolean; can_edit: boolean; server_now?: string; items: TeamMember[];
}

export interface BulkPunchResult {
  direction: "IN" | "OUT";
  done: number;
  failed: number;
  results: { employee_id: number; ok: boolean; attendance_id?: number; replayed?: boolean; code?: string; message?: string }[];
}

export interface PunchLocation {
  source: "DEVICE" | "MANUAL";
  latitude: number;
  longitude: number;
  accuracy_m?: number | null;
  address?: string | null;
}

export const teamApi = {
  board: (q?: string) => api.get<TeamBoard>("/attendance/team/today", { params: { q: q || undefined } }),
  punch: (body: { employee_id: number; direction: "IN" | "OUT"; reason?: string; location?: PunchLocation | null;
    idempotency_key: string; client_sent_at?: string }) => api.post("/attendance/team/punch", body),
  bulkPunch: (body: { employee_ids: number[]; direction: "IN" | "OUT"; reason?: string; location?: PunchLocation | null;
    idempotency_key: string; client_sent_at?: string }) => api.post<BulkPunchResult>("/attendance/team/punch/bulk", body),
  void: (attendanceId: number, reason: string) => api.post(`/attendance/sessions/${attendanceId}/void`, { reason }),
  settings: () => api.get<TeamSettings>("/attendance/team/settings"),
  saveSettings: (body: Partial<TeamSettings> & { reason?: string }) => api.put<TeamSettings>("/attendance/team/settings", body),
};

export function newKey(): string {
  return `tp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
