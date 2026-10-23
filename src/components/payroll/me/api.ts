/**
 * Self-service endpoint helpers on the shared `payrollApi` (Idempotency-Key on every state change,
 * structured 409s, STEP_UP_REQUIRED retry). Paths are relative to /api/v1 and match
 * hrms-backend/app/payroll/routes/*.py exactly. Only the caller's own records are reachable here.
 */

import type { AxiosProgressEvent } from "axios";

import { http, toApiError } from "@/lib/api";
import { payrollApi } from "@/lib/payroll/api";

import type {
  BankAccountIn,
  BankChangeResult,
  Claim,
  ClaimTypesResponse,
  DocumentRequestDto,
  DownloadLink,
  EmployeeCompensation,
  ListPage,
  Loan,
  LoanPolicyPreview,
  MyBankAccount,
  MyBankChange,
  MyPayslip,
  MyPayslipDetail,
  MyPaymentsResponse,
  MyPayslipQuestion,
  PayDocumentDto,
  PayrollPreferences,
  PayslipPasswordStatus,
  PayslipQuestionResult,
  UploadLimits,
} from "./types";

type Params = Record<string, unknown>;

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

/** Save a protected file through the session (receipts, signed document links). */
export async function saveFile(url: string, fallbackName: string): Promise<void> {
  // Signed links come back as "/api/v1/payroll/downloads/<token>"; the axios client already has /api/v1.
  const path = url.replace(/^\/api\/v1(?=\/)/, "");
  let response;
  try {
    response = await http.get<Blob>(path, { responseType: "blob" });
  } catch (error) {
    throw toApiError(error);
  }
  const disposition = response.headers?.["content-disposition"] as string | undefined;
  const match = disposition?.match(/filename="?([^";]+)"?/);
  const href = URL.createObjectURL(response.data);
  const a = document.createElement("a");
  a.href = href;
  a.download = match?.[1] || fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export const meApi = {
  /* own payroll context (routes/me_payroll.py): settings resolved for the caller's own employee */
  preferences: () => payrollApi.get<PayrollPreferences>("/me/payroll/preferences"),
  loanPolicy: () => payrollApi.get<LoanPolicyPreview>("/me/payroll/loan-policy"),

  /* payslip questions (routes/payslip_queries.py): own published payslips and own questions only */
  askQuestion: (documentId: number, question: string, idempotencyKey?: string) =>
    payrollApi.post<PayslipQuestionResult>(`/me/payroll/payslips/${documentId}/questions`, { question }, idempotencyKey ? { idempotencyKey } : undefined),
  questions: (params: { status?: string | null; document_id?: number | null; skip?: number; limit?: number } = {}) =>
    payrollApi.get<ListPage<MyPayslipQuestion>>("/me/payroll/payslip-questions", { params: cleanParams(params) }),
  question: (id: number | string) => payrollApi.get<MyPayslipQuestion>(`/me/payroll/payslip-questions/${encodeURIComponent(String(id))}`),
  closeQuestion: (id: number, rowVersion?: number) =>
    payrollApi.post<PayslipQuestionResult>(`/me/payroll/payslip-questions/${id}/close`, rowVersion ? { row_version: rowVersion } : {}),

  /* payslips (routes/payslips.py) */
  payslips: (params: { year?: number | null; skip?: number; limit?: number } = {}) =>
    payrollApi.get<ListPage<MyPayslip>>("/me/payroll/payslips", { params: cleanParams(params) }),
  payslip: (id: number | string) => payrollApi.get<MyPayslipDetail>(`/me/payroll/payslips/${encodeURIComponent(String(id))}`),
  payslipLink: (id: number) => payrollApi.get<DownloadLink>(`/me/payroll/payslips/${id}/download`),
  passwordStatus: () => payrollApi.get<PayslipPasswordStatus>("/me/payroll/payslip-password"),
  /** Needs a fresh step-up: payrollApi asks through StepUpProvider and retries once. */
  setPassword: (password: string) => payrollApi.put<{ set: boolean; set_at?: string | null }>("/me/payroll/payslip-password", { password }),

  /* other documents (routes/documents.py) */
  documents: (params: { doc_type?: string; skip?: number; limit?: number } = {}) =>
    payrollApi.get<ListPage<PayDocumentDto>>("/me/payroll/documents", { params: cleanParams(params) }),
  documentLink: (id: number) => payrollApi.get<DownloadLink>(`/me/payroll/documents/${id}/download`),
  documentRequests: () => payrollApi.get<{ items: DocumentRequestDto[] }>("/me/payroll/document-requests"),
  requestDocument: (body: { doc_type: string; include_amounts: boolean; purpose?: string | null }) =>
    payrollApi.post<DocumentRequestDto>("/me/payroll/document-requests", body),
  loanStatement: (loanId: number) => payrollApi.post<PayDocumentDto>(`/me/payroll/loans/${loanId}/statement`, {}),

  /* payments (routes/my_payments.py) */
  payments: (year?: number | null) => payrollApi.get<MyPaymentsResponse>("/me/payroll/payments", { params: cleanParams({ year }) }),

  /* compensation (routes/compensation.py; SELF scope of payroll:compensation:read) */
  compensation: (employeeId: number) => payrollApi.get<EmployeeCompensation>(`/payroll/employees/${employeeId}/compensation`),

  /* bank accounts (routes/bank_accounts.py) */
  bankAccounts: (params: { status?: string } = {}) =>
    payrollApi.get<ListPage<MyBankAccount>>("/me/payroll/bank-accounts", { params: cleanParams({ ...params, limit: 200 }) }),
  bankAccount: (id: number | string) => payrollApi.get<MyBankAccount>(`/me/payroll/bank-accounts/${encodeURIComponent(String(id))}`),
  bankChanges: (params: { status?: string } = {}) =>
    payrollApi.get<ListPage<MyBankChange>>("/me/payroll/bank-change-requests", { params: cleanParams({ ...params, limit: 200 }) }),
  submitBankAccount: (body: BankAccountIn, idempotencyKey?: string) =>
    payrollApi.post<BankChangeResult>("/me/payroll/bank-accounts", body, idempotencyKey ? { idempotencyKey } : undefined),
  addBankEvidence: (accountId: number, file: File, onProgress?: (percent: number) => void) => {
    const { body, config } = multipart(file, onProgress);
    return payrollApi.post<{ id: number; file_name: string }>(`/me/payroll/bank-accounts/${accountId}/evidence`, body, { config });
  },
  deactivateBankAccount: (accountId: number, reason: string, rowVersion: number) =>
    payrollApi.post<MyBankAccount>(`/me/payroll/bank-accounts/${accountId}/deactivate`, { reason, row_version: rowVersion }),
  cancelBankChange: (changeId: number, remarks?: string) =>
    payrollApi.post<BankChangeResult>(`/me/payroll/bank-change-requests/${changeId}/cancel`, { remarks: remarks || null }),

  /* loans (routes/loans.py) */
  loans: (params: { status?: string } = {}) => payrollApi.get<ListPage<Loan>>("/me/payroll/loans", { params: cleanParams({ ...params, limit: 200 }) }),
  loan: (id: number | string) => payrollApi.get<Loan>(`/me/payroll/loans/${encodeURIComponent(String(id))}`),
  applyLoan: (body: { kind: string; amount: { amount: string; currency: string }; tenure?: number | null; purpose?: string | null }) =>
    payrollApi.post<{ id: number; status: string; row_version: number; approval_request_id: number | null; issues: string[] }>("/me/payroll/loans", body),

  /* claims (routes/claims.py) */
  claims: (params: { status?: string } = {}) =>
    payrollApi.get<ListPage<Claim>>("/me/payroll/reimbursement-claims", { params: cleanParams({ ...params, limit: 200 }) }),
  claim: (id: number | string) => payrollApi.get<Claim>(`/me/payroll/reimbursement-claims/${encodeURIComponent(String(id))}`),
  claimTypes: () => payrollApi.get<ClaimTypesResponse>("/payroll/reimbursement-claim-types"),
  submitClaim: (body: { claim_type: string; expense_date: string; amount: { amount: string; currency: string }; merchant?: string | null; description?: string | null }) =>
    payrollApi.post<{ id: number; status: string; row_version: number; approval_request_id: number | null; flags: string[] }>("/me/payroll/reimbursement-claims", body),
  addReceipt: (claimId: number, file: File, onProgress?: (percent: number) => void) => {
    const { body, config } = multipart(file, onProgress);
    return payrollApi.post<{ id: number; file_name: string }>(`/me/payroll/reimbursement-claims/${claimId}/receipts`, body, { config });
  },
  receiptUrl: (claimId: number, receiptId: number) => `/me/payroll/reimbursement-claims/${claimId}/receipts/${receiptId}`,
  withdrawClaim: (claimId: number, remarks?: string) =>
    payrollApi.post<{ id: number; status: string }>(`/me/payroll/reimbursement-claims/${claimId}/withdraw`, { remarks: remarks || null }),

  /* upload limits (routes/uploads.py) */
  uploadLimits: () => payrollApi.get<UploadLimits>("/payroll/uploads/limits"),
};

/** Open a document through its five-minute signed link (EC-DOC-06); the file name comes from the server. */
export async function downloadDocument(getLink: () => Promise<DownloadLink>, fallbackName: string): Promise<void> {
  const link = await getLink();
  await saveFile(link.url, fallbackName);
}
