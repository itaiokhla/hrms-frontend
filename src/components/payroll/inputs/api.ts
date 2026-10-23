/**
 * Endpoint helpers for wage inputs, approvals, loans, reimbursements, overtime and tasks, on the shared
 * `payrollApi` (Idempotency-Key on every state change, structured 409s, STEP_UP_REQUIRED retry).
 * Paths are relative to /api/v1 and match hrms-backend/app/payroll/routes/*.py exactly.
 */

import type { AxiosProgressEvent } from "axios";

import { http, toApiError } from "@/lib/api";
import type { Money } from "@/lib/money";
import { payrollApi } from "@/lib/payroll/api";

import type {
  ApprovalRequest,
  ArrearsActionResult,
  ArrearsDetectOutcome,
  ArrearsPreviewItem,
  ArrearsProposal,
  ArrearsTrigger,
  Claim,
  ComponentOption,
  EmployeeOption,
  ListPage,
  Loan,
  OvertimeEntry,
  PayGroupOption,
  PayPeriodOption,
  RetroRunResult,
  Task,
  WageInput,
  WageInputImport,
  WageInputResult,
} from "./types";

type Params = Record<string, unknown>;

/** Drop empty filter values so the API sees only what the person chose. */
export function cleanParams(params: Params): Params {
  const out: Params = {};
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  });
  return out;
}

function multipart(file: File, onProgress?: (percent: number) => void) {
  const form = new FormData();
  form.append("file", file);
  return {
    body: form,
    config: {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (e: AxiosProgressEvent) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    },
  };
}

/** Download a protected file (CSV, receipt, evidence) as a Blob; the caller makes an object URL. */
export async function fetchBlob(url: string): Promise<Blob> {
  try {
    const response = await http.get<Blob>(url, { responseType: "blob" });
    return response.data;
  } catch (error) {
    throw toApiError(error);
  }
}

/** Save a Blob under a file name (template and result CSVs). */
export function saveBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/* ------------------------------------------------------------------ wage inputs */

export interface WageInputBody {
  employee_id: number;
  component_code: string;
  period_start: string;
  period_end: string;
  amount?: Money;
  units?: string;
  rate?: string;
  currency?: string;
  reason?: string;
  external_ref?: string;
  recurrence?: { until: string };
  submit?: boolean;
}

export interface WageInputPatchBody {
  row_version: number;
  amount?: Money;
  units?: string;
  rate?: string;
  reason?: string | null;
  external_ref?: string | null;
}

export const wageInputsApi = {
  list: (params: Params) => payrollApi.get<ListPage<WageInput>>("/payroll/wage-inputs", { params: cleanParams(params) }),
  get: (id: number | string) => payrollApi.get<WageInput>(`/payroll/wage-inputs/${id}`),
  create: (body: WageInputBody, idempotencyKey?: string) =>
    payrollApi.post<{ items: WageInputResult[] }>("/payroll/wage-inputs", body, { idempotencyKey }),
  update: (id: number, body: WageInputPatchBody) => payrollApi.patch<WageInputResult>(`/payroll/wage-inputs/${id}`, body, { idempotencyKey: false }),
  submit: (id: number) => payrollApi.post<WageInputResult>(`/payroll/wage-inputs/${id}/submit`),
  approve: (id: number, remarks?: string) => payrollApi.post<WageInputResult>(`/payroll/wage-inputs/${id}/approve`, { remarks: remarks || null }),
  reject: (id: number, remarks: string) => payrollApi.post<WageInputResult>(`/payroll/wage-inputs/${id}/reject`, { remarks }),
  cancel: (id: number, reason: string) => payrollApi.post<WageInputResult>(`/payroll/wage-inputs/${id}/cancel`, { reason }),
  dryRun: (file: File, onProgress?: (p: number) => void) => {
    const { body, config } = multipart(file, onProgress);
    return payrollApi.post<WageInputImport>("/payroll/wage-inputs/import", body, { config });
  },
  getImport: (id: number | string) => payrollApi.get<WageInputImport>(`/payroll/wage-input-imports/${id}`),
  commitImport: (id: number) => payrollApi.post<{ id: number; status: string; job_id: number | null }>(`/payroll/wage-input-imports/${id}/commit`),
  templateUrl: "/payroll/wage-input-imports/template",
  resultUrl: (id: number | string) => `/payroll/wage-input-imports/${id}/result`,
};

/* ------------------------------------------------------------------ approvals */

export const approvalsApi = {
  list: (params: Params) => payrollApi.get<ListPage<ApprovalRequest>>("/payroll/approvals", { params: cleanParams(params) }),
  get: (id: number | string) => payrollApi.get<ApprovalRequest>(`/payroll/approvals/${id}`),
  approve: (id: number, remarks?: string, expectedStep?: number | null) =>
    payrollApi.post(`/payroll/approvals/${id}/approve`, { remarks: remarks || null, expected_step: expectedStep ?? null }),
  reject: (id: number, remarks: string, expectedStep?: number | null) =>
    payrollApi.post(`/payroll/approvals/${id}/reject`, { remarks, expected_step: expectedStep ?? null }),
};

/* ------------------------------------------------------------------ loans */

export const loansApi = {
  list: (params: Params) => payrollApi.get<ListPage<Loan>>("/payroll/loans", { params: cleanParams(params) }),
  get: (id: number | string) => payrollApi.get<Loan>(`/payroll/loans/${id}`),
  create: (body: { employee_id: number; kind: string; amount: Money; tenure?: number; purpose?: string }) =>
    payrollApi.post<{ id: number; status: string; issues: string[] }>("/payroll/loans", body),
  approve: (id: number, remarks?: string) => payrollApi.post(`/payroll/loans/${id}/approve`, { remarks: remarks || null }),
  reject: (id: number, remarks: string) => payrollApi.post(`/payroll/loans/${id}/reject`, { remarks }),
  cancel: (id: number, reason: string) => payrollApi.post(`/payroll/loans/${id}/cancel`, { reason }),
  pause: (id: number, reason: string) => payrollApi.post(`/payroll/loans/${id}/pause`, { reason }),
  resume: (id: number, reason?: string) => payrollApi.post(`/payroll/loans/${id}/resume`, { reason: reason || null }),
  restructure: (id: number, tenure: number, reason: string) => payrollApi.post(`/payroll/loans/${id}/restructure`, { tenure, reason }),
  prepay: (id: number, amount: Money, reference?: string, reason?: string) =>
    payrollApi.post(`/payroll/loans/${id}/prepay`, { amount, reference: reference || null, reason: reason || null }),
  waive: (id: number, amount: Money, reason: string) => payrollApi.post(`/payroll/loans/${id}/waive`, { amount, reason }),
};

/* ------------------------------------------------------------------ reimbursement claims */

export const claimsApi = {
  list: (params: Params) => payrollApi.get<ListPage<Claim>>("/payroll/reimbursement-claims", { params: cleanParams(params) }),
  get: (id: number | string) => payrollApi.get<Claim>(`/payroll/reimbursement-claims/${id}`),
  create: (body: { employee_id: number; claim_type: string; expense_date: string; amount: Money; merchant?: string; description?: string }) =>
    payrollApi.post<{ id: number; status: string; flags: string[] }>("/payroll/reimbursement-claims", body),
  approve: (id: number, remarks?: string) => payrollApi.post(`/payroll/reimbursement-claims/${id}/approve`, { remarks: remarks || null }),
  reject: (id: number, remarks: string) => payrollApi.post(`/payroll/reimbursement-claims/${id}/reject`, { remarks }),
  addReceipt: (id: number, file: File, onProgress?: (p: number) => void) => {
    const { body, config } = multipart(file, onProgress);
    return payrollApi.post(`/payroll/reimbursement-claims/${id}/receipts`, body, { config });
  },
  receiptUrl: (id: number, receiptId: number) => `/payroll/reimbursement-claims/${id}/receipts/${receiptId}`,
};

/* ------------------------------------------------------------------ overtime */

export interface OvertimeBody {
  employee_id?: number;
  date: string;
  minutes: number;
  reason: string;
  start_at?: string;
  end_at?: string;
  comp_off?: boolean;
}

export const overtimeApi = {
  list: (params: Params) => payrollApi.get<ListPage<OvertimeEntry>>("/overtime/entries", { params: cleanParams(params) }),
  get: (id: number | string) => payrollApi.get<OvertimeEntry>(`/overtime/entries/${id}`),
  create: (body: OvertimeBody) => payrollApi.post<{ id: number; status: string }>("/overtime/entries", body),
  cancel: (id: number, remarks?: string) => payrollApi.post(`/overtime/entries/${id}/cancel`, { remarks: remarks || null }),
  approve: (id: number, body: { minutes_approved?: number; comp_off?: boolean; remarks?: string; expected_step?: number | null }) =>
    payrollApi.post(`/overtime/entries/${id}/approve`, body),
  reject: (id: number, remarks: string) => payrollApi.post(`/overtime/entries/${id}/reject`, { remarks }),
};

/* ------------------------------------------------------------------ tasks */

export interface TaskBody {
  title: string;
  task_type: string;
  quantity: string;
  unit: string;
  assignees: { employee_id: number; split_percent?: string }[];
  description?: string;
  project?: string;
  category?: string;
  rate?: Money;
  due_date?: string;
  completed_on?: string;
  external_ref?: string;
}

export const tasksApi = {
  list: (params: Params) => payrollApi.get<ListPage<Task>>("/tasks", { params: cleanParams(params) }),
  get: (id: number | string) => payrollApi.get<Task>(`/tasks/${id}`),
  create: (body: TaskBody) => payrollApi.post<{ id: number; status: string; row_version: number }>("/tasks", body),
  submit: (id: number) => payrollApi.post(`/tasks/${id}/submit`, {}),
  approve: (id: number, body: { accepted_quantity?: string; remarks?: string; expected_step?: number | null }) => payrollApi.post(`/tasks/${id}/approve`, body),
  reject: (id: number, remarks: string) => payrollApi.post(`/tasks/${id}/reject`, { remarks }),
  dispute: (id: number, reason: string) => payrollApi.post(`/tasks/${id}/dispute`, { reason }),
  addEvidence: (id: number, file: File, onProgress?: (p: number) => void) => {
    const { body, config } = multipart(file, onProgress);
    return payrollApi.post(`/tasks/${id}/evidence`, body, { config });
  },
  removeEvidence: (id: number, evidenceId: number) => payrollApi.delete(`/tasks/${id}/evidence/${evidenceId}`),
  evidenceUrl: (id: number, evidenceId: number) => `/tasks/${id}/evidence/${evidenceId}`,
};

/* ------------------------------------------------------------------ arrears proposals and retro runs */

export interface DetectBody {
  employee_id: number;
  from_date: string;
  to_date?: string;
  trigger: ArrearsTrigger;
  keys?: string[];
  policy_types?: string[];
  reason: string;
}

/** routes/corrections.py: list needs payroll:run:read, decide payroll:run:approve, detect and retro runs payroll:run:create. */
export const arrearsApi = {
  list: (params: Params) => payrollApi.get<ListPage<ArrearsProposal>>("/payroll/arrears-proposals", { params: cleanParams(params) }),
  get: (id: number | string) => payrollApi.get<ArrearsProposal>(`/payroll/arrears-proposals/${id}`),
  approve: (id: number, comment: string | undefined, rowVersion: number) =>
    payrollApi.post<ArrearsActionResult>(`/payroll/arrears-proposals/${id}/approve`, { comment: comment || null, row_version: rowVersion }),
  reject: (id: number, reason: string, rowVersion: number) =>
    payrollApi.post<ArrearsActionResult>(`/payroll/arrears-proposals/${id}/reject`, { reason, row_version: rowVersion }),
  /** Preview records nothing: the per-component differences of every finalized period the change reaches. */
  preview: (body: DetectBody) => payrollApi.post<{ items: ArrearsPreviewItem[] }>("/payroll/arrears-proposals/detect", { ...body, preview: true }),
  detect: (body: DetectBody, idempotencyKey?: string) =>
    payrollApi.post<{ items: ArrearsDetectOutcome[] }>("/payroll/arrears-proposals/detect", { ...body, preview: false }, { idempotencyKey }),
  retroRun: (body: { pay_group_id: number; pay_period_id: number; proposal_ids: number[]; label?: string }, idempotencyKey?: string) =>
    payrollApi.post<RetroRunResult>("/payroll/retro-runs", body, { idempotencyKey }),
  /** GET /payroll/pay-groups/{id}/periods (payroll calendars), for the retro run's paying period. */
  periods: (payGroupId: number) =>
    payrollApi.get<ListPage<PayPeriodOption>>(`/payroll/pay-groups/${payGroupId}/periods`, { params: { limit: 100 } }),
};

/* ------------------------------------------------------------------ settings and lookups */

export interface ResolvedSetting {
  key: string;
  value: unknown;
  level: string | null;
  valid: boolean;
}

export const lookupsApi = {
  /** GET /payroll/settings/resolve (needs payroll:configuration:read). */
  resolveSetting: (key: string) => payrollApi.get<ResolvedSetting>("/payroll/settings/resolve", { params: { key } }),
  /** GET /payroll/org/pay-groups (org:read, org:manage_dimensions or payroll:configuration:read). */
  payGroups: () => payrollApi.get<PayGroupOption[]>("/payroll/org/pay-groups"),
  /** GET /payroll/components (payroll:salary_structure:read). */
  components: () => payrollApi.get<ComponentOption[]>("/payroll/components"),
  /** GET /employees (employee:read), for pickers and names. */
  employees: (q: string, limit = 20) =>
    payrollApi.get<{ total: number; items: EmployeeOption[] }>("/employees", { params: cleanParams({ q, limit }) }),
};
