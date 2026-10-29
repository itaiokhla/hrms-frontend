/**
 * AS-M8 overtime review and AS-M9 live board / registers (backend app/routes/attendance_insights.py).
 * Hours only, never money (10-analytics D-5); registers are sealed exports (§6.3 G-8).
 */
import { api, downloadFile } from "@/lib/api";

export type LiveStatus = "NOT_YET_IN" | "WORKING" | "ON_LUNCH" | "IN_FIELD" | "COMPLETED" | "NOT_STARTED" | "ABSENT"
  | "UNMARKED" | "ON_LEAVE" | "OFF";

export interface LiveTile {
  kpi: string;
  key: string;
  label: string;
  value: string;
  unit: "PEOPLE" | "PORTION_UNITS";
  composition?: Record<string, string>;
  no_show?: number;
}

export interface LiveRow {
  employee_id: number;
  name: string;
  employee_code: string | null;
  status: LiveStatus;
  status_label: string;
  late: boolean;
  late_by_minutes: number | null;
  no_show: boolean;
  first_in_at: string | null;
  last_out_at: string | null;
  expected_start_at: string | null;
  work_mode: string | null;
  site_id: number | null;
  expected_units: string;
  evaluation_state: string;
  day_result: string | null;
  exceptions: string[];
}

export interface LiveBoard {
  date: string;
  live: boolean;
  as_of: string;
  zone: string;
  zone_now: string;
  tiles: LiveTile[];
  counts: Record<LiveStatus, number>;
  consistency: { expected_equals_present_plus_on_duty_plus_absent: boolean };
  items: LiveRow[];
  total: number;
  skip: number;
  limit: number;
}

export interface LiveParams {
  date?: string;
  q?: string;
  status?: LiveStatus[];
  quick?: string;
  sort?: string;
  department_id?: number;
  team_id?: number;
  branch_id?: number;
  site_id?: number;
  skip?: number;
  limit?: number;
}

export interface OvertimeQueueItem {
  id: number;
  employee_id: number;
  employee_name: string | null;
  date: string;
  minutes_requested: number | null;
  minutes_computed: number | null;
  minutes_approved: number | null;
  source: string;
  status: string;
  comp_off: boolean;
  reason: string | null;
  version: number;
  attendance: { net_minutes: number | null; ot_candidate_minutes: number; evaluation_state: string } | null;
}

export interface OvertimeContext {
  entry_id: number;
  date: string;
  status: string;
  origin: "ATTENDANCE" | "REQUEST";
  attendance_day: {
    evaluation_state: string; version: number; day_result: string; first_in_at: string | null; last_out_at: string | null;
    expected_start_at: string | null; expected_end_at: string | null; net_minutes: number | null;
    ot_eligible_minutes: number; ot_candidate_minutes: number; exceptions: string[];
  } | null;
  policy: { source: string; comp_off_allowed: boolean; min_minutes: number; combination: string } | null;
  caps: { window: string; limit_minutes: number; used_minutes: number | null; left_minutes: number | null;
    rolling_used_minutes: number | null; projected_over: boolean }[];
  usage: { quarter: { from: string; to: string; minutes: number }; rolling_3_months: { from: string; to: string; minutes: number } };
  consent: { required: boolean; on_file: boolean | null; enforced: boolean; pack_version?: string | null };
}

export interface ProposalRun {
  employees: number;
  weeks: number;
  created: number;
  updated: number;
  cancelled: number;
  successors: number;
  flagged: number;
  consent_missing: number;
}

export type RegisterForm = "FORM_25" | "FORM_D";

export interface RegisterRow {
  employee_id: number;
  employee_code: string;
  name: string;
  designation: string;
  sex: string;
  marks: string[];
  hours?: (string | null)[];
  wages?: string;
  totals: {
    present_units: string; absent_units: string; leave_units: string; holidays: number; weekly_offs: number;
    days_worked: number; hours_worked: string; ot_hours: string; night_minutes: number;
  };
}

export interface Register {
  form: RegisterForm;
  title: string;
  establishment: { kind: string; id: number; name: string };
  from: string;
  to: string;
  dates: string[];
  rows: RegisterRow[];
  legend: string;
  pending_days: number;
  corrections: { date: string; employee: string | null; version: number; day_result: string | null; trigger: string | null; at: string | null }[];
  seal: { generator: string; generated_at: string; generated_by: string; sha256: string; statement: string; rows: number };
  total: number;
}

export interface RegisterParams {
  from: string;
  to: string;
  legal_entity_id?: number | null;
  branch_id?: number | null;
  department_id?: number | null;
}

const clean = (p: object) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)));

const PATH: Record<RegisterForm, string> = { FORM_25: "form-25", FORM_D: "form-d" };

export const insightsApi = {
  liveBoard: (params: LiveParams = {}) =>
    api.get<LiveBoard>("/attendance/live-board", { params: clean(params), paramsSerializer: { indexes: null } }),
  overtimeQueue: (skip = 0, limit = 25) => api.get<{ items: OvertimeQueueItem[]; total: number }>("/attendance/overtime/queue", { params: { skip, limit } }),
  overtimeContext: (id: number) => api.get<OvertimeContext>(`/attendance/overtime/${id}/context`),
  convert: (id: number, outcome: "PAY" | "COMP_OFF", minutes?: number, remarks?: string) =>
    api.post<{ id: number; status: string; comp_off: boolean; minutes_approved: number }>(`/attendance/overtime/${id}/convert`, clean({ outcome, minutes, remarks })),
  runProposals: (from: string, to: string) => api.post<ProposalRun>("/attendance/overtime/proposals/run", { from, to }),
  registers: () => api.get<{ items: { code: RegisterForm; name: string; formats: string[]; max_days: number }[] }>("/attendance/registers"),
  register: (form: RegisterForm, params: RegisterParams) => api.get<Register>(`/attendance/registers/${PATH[form]}`, { params: clean(params) }),
  download: (form: RegisterForm, params: RegisterParams, format: "CSV" | "XLSX" | "PDF") => {
    const query = new URLSearchParams(Object.entries(clean({ ...params, format })).map(([k, v]) => [k, String(v)]));
    return downloadFile(`/attendance/registers/${PATH[form]}?${query.toString()}`, `${form}.${format.toLowerCase()}`);
  },
};

export const fmtMinutes = (minutes: number | null | undefined) => {
  if (minutes === null || minutes === undefined) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};
