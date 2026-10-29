/**
 * Team payroll (managers prepare and submit, payroll commits), contractor invoices and payroll-cost invoices
 * (backend app/routes/team_payroll.py, app/payroll/routes/invoices.py). Writes carry an Idempotency-Key and
 * prompt for step-up where payroll asks for it (payrollApi).
 */
import { http } from "./api";
import { payrollApi } from "./payroll/api";

export type BatchStatus = "DRAFT" | "SUBMITTED" | "RETURNED" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface TeamMember {
  employee_id: number; name: string; employee_code: string | null; position: string | null; pending_lines: number;
  amounts_visible: boolean;
  last_run: { run_id: number; run_status: string; line_status: string; currency: string; finalized: boolean;
    gross?: string | null; net?: string | null } | null;
}
export interface TeamView { items: TeamMember[]; can_submit: boolean; amounts: boolean; can_approve: boolean }
export interface InputComponent { code: string; name: string; kind: string; units_based: boolean }
export interface BatchLine {
  id?: number; employee_id: number; employee_name?: string | null; component_code: string; amount?: string | null;
  units?: string | null; rate?: string | null; reason: string; wage_input_id?: number | null; problem?: string | null;
}
export interface BatchFile { id: number; file_name: string; size_bytes: number; content_type: string }
export interface Batch {
  id: number; title: string; period_start: string; period_end: string; status: BatchStatus; notes: string | null;
  prepared_by_user_id: number; approval_request_id: number | null; submitted_at: string | null; decided_at: string | null;
  decision_note: string | null; line_count: number; total_amount: string; file_count: number; row_version: number;
  lines?: BatchLine[]; files?: BatchFile[];
  can?: { edit: boolean; submit: boolean; withdraw: boolean; decide: boolean };
}
export interface BatchBody { title: string; period_start: string; period_end: string; notes?: string | null; lines: BatchLine[] }

export interface Money { amount: string; currency: string }
export interface ContractorInvoice {
  id: number; kind: string; mode: string; status: string; number: string | null; external_number: string | null;
  payee_employee_id: number; payee_name?: string | null; currency: string; total: Money; subtotal: Money;
  tax_total: Money; lines: { description: string; quantity: string; unit?: string; rate?: string; amount: string }[];
  issue_date: string | null; document_id: number | null; created_by_user_id?: number; issued_by_user_id?: number | null;
  row_version: number;
}
export interface TimesheetOption { id: number; period_start: string; period_end: string }

export interface CostGroup { group_id: number | null; label: string; employees: number; gross: string; employer: string; cost: string }
export interface CostInvoice {
  id: number; run_id: number; group_by: string; group_id: number | null; group_label: string; number: string | null;
  status: "DRAFT" | "ISSUED" | "VOID"; currency: string; bill_to: Record<string, string | null>;
  lines: { employee_id: number; employee_code: string | null; name: string; gross: string; employer: string; cost: string }[];
  taxes: { label: string; rate_percent: string; amount: string }[]; employee_count: number; gross_total: string;
  employer_total: string; fee_percent: string; fee_total: string; subtotal: string; tax_total: string; total: string;
  issue_date: string | null; due_date: string | null; notes: string | null; created_by_user_id: number;
  issued_by_user_id: number | null; void_reason: string | null; row_version: number;
}
export const COST_GROUPS = ["COMPANY", "LEGAL_ENTITY", "BRANCH", "DEPARTMENT", "TEAM", "PAY_GROUP"] as const;

export const teamPayrollApi = {
  team: () => payrollApi.get<TeamView>("/payroll/team"),
  components: () => payrollApi.get<{ items: InputComponent[] }>("/payroll/team/components"),
  batches: (box: "mine" | "approvals" | "all", status?: string) =>
    payrollApi.get<{ items: Batch[] }>("/payroll/team/batches", { params: { box, status } }),
  batch: (id: number) => payrollApi.get<Batch>(`/payroll/team/batches/${id}`),
  create: (body: BatchBody) => payrollApi.post<Batch>("/payroll/team/batches", body),
  update: (id: number, body: Partial<BatchBody>) => payrollApi.patch<Batch>(`/payroll/team/batches/${id}`, body),
  submit: (id: number) => payrollApi.post<Batch>(`/payroll/team/batches/${id}/submit`, {}),
  withdraw: (id: number) => payrollApi.post<Batch>(`/payroll/team/batches/${id}/withdraw`, {}),
  decide: (id: number, decision: "approve" | "reject" | "return", note?: string) =>
    payrollApi.post<Batch>(`/payroll/team/batches/${id}/${decision}`, { note: note || null }),
  addFile: async (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return (await http.post<BatchFile>(`/payroll/team/batches/${id}/files`, form)).data;
  },
  fileUrl: (id: number, fileId: number) => `/api/v1/payroll/team/batches/${id}/files/${fileId}`,
  removeFile: (id: number, fileId: number) => payrollApi.delete<void>(`/payroll/team/batches/${id}/files/${fileId}`),

  teamInvoices: () => payrollApi.get<{ items: ContractorInvoice[] }>("/payroll/team/invoices"),
  timesheets: (employeeId: number) =>
    payrollApi.get<{ items: TimesheetOption[] }>(`/payroll/team/contractors/${employeeId}/timesheets`),
  createInvoice: (body: {
    mode: "INVOICE" | "SELF_BILLED"; payee_employee_id: number; timesheet_ids?: number[]; task_ids?: number[];
    hourly_rate?: string; currency?: string; external_number?: string | null; notes?: string | null;
  }) => payrollApi.post<ContractorInvoice>("/payroll/invoices", body),
  invoices: (status?: string) =>
    payrollApi.get<{ total: number; items: ContractorInvoice[] }>("/payroll/invoices", { params: { status, limit: 200 } }),
  issueInvoice: (id: number, rowVersion?: number) =>
    payrollApi.post<ContractorInvoice>(`/payroll/invoices/${id}/issue`, { row_version: rowVersion }),
  approveInvoice: (id: number, rowVersion?: number) =>
    payrollApi.post<ContractorInvoice>(`/payroll/invoices/${id}/approve`, { row_version: rowVersion }),
  creditInvoice: (id: number, reason: string) =>
    payrollApi.post<ContractorInvoice>(`/payroll/invoices/${id}/credit`, { reason }),
  invoiceLink: (id: number) => payrollApi.get<{ url: string }>(`/payroll/invoices/${id}/download`),

  costPreview: (runId: number, groupBy: string) =>
    payrollApi.get<{ run_id: number; currency: string; group_by: string; groups: CostGroup[] }>(
      "/payroll/cost-invoices/preview", { params: { run_id: runId, group_by: groupBy } }),
  costInvoices: (runId?: number) =>
    payrollApi.get<{ items: CostInvoice[] }>("/payroll/cost-invoices", { params: { run_id: runId } }),
  createCost: (body: {
    run_id: number; group_by: string; group_id: number | null; fee_percent?: string | null;
    taxes: { label: string; rate_percent: string }[]; bill_to: Record<string, string | null>; due_date?: string | null;
    notes?: string | null;
  }) => payrollApi.post<CostInvoice>("/payroll/cost-invoices", body),
  issueCost: (id: number, rowVersion?: number) =>
    payrollApi.post<CostInvoice>(`/payroll/cost-invoices/${id}/issue`, { row_version: rowVersion }),
  voidCost: (id: number, reason: string) => payrollApi.post<CostInvoice>(`/payroll/cost-invoices/${id}/void`, { reason }),
  costPdfUrl: (id: number) => `/api/v1/payroll/cost-invoices/${id}/pdf`,
};

export const BATCH_STATUS: Record<BatchStatus, { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SUBMITTED: { label: "Waiting for payroll", tone: "info" },
  RETURNED: { label: "Returned to you", tone: "warning" },
  APPROVED: { label: "Committed to payroll", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  CANCELLED: { label: "Withdrawn", tone: "neutral" },
};
