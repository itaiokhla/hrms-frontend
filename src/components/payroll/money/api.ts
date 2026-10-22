/**
 * Requests of the bank-details, payout-file, reconciliation and funding-account pages. JSON calls go
 * through `payrollApi` (Idempotency-Key on writes, structured 409s, STEP_UP_REQUIRED → step-up and
 * one retry). Files (evidence, bank files) are fetched as blobs on the shared axios client and never
 * stored: the object URL lives only as long as the viewer.
 */

import { http, toApiError } from "@/lib/api";
import { payrollApi, payrollError } from "@/lib/payroll/api";

import type {
  AccountActionResult,
  BankAccount,
  BankAccountDetail,
  BankChangeRequest,
  BatchActionResult,
  BatchProposal,
  ChangeActionResult,
  CreateBatchesResult,
  CsvMapping,
  FundingAccount,
  FundingAccountInput,
  ImportStatementResult,
  InstructionDetail,
  LegalEntityOption,
  MatchQueue,
  OverdueResult,
  PageOf,
  PaymentBatch,
  PaymentBatchDetail,
  PaymentEvent,
  PaymentInstruction,
  ReconciliationMatch,
  RevealedAccount,
  RunOption,
  StatementImport,
  UserOption,
} from "./types";

/** Drop empty filter values so they are not sent as `?status=`. */
export function cleanParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v !== null && v !== undefined));
}

/* ------------------------------------------------------------------ files */

export interface FetchedFile {
  blob: Blob;
  filename: string | null;
  mime: string;
  /** `X-Content-SHA256` (bank files), so the UI can show the hash it received. */
  sha256: string | null;
}

function filenameOf(disposition: string | undefined): string | null {
  if (!disposition) return null;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return m ? decodeURIComponent(m[1]) : null;
}

/** GET a file as a blob; JSON error bodies (sent as blobs) are parsed into a PayrollApiError. */
export async function fetchFile(url: string): Promise<FetchedFile> {
  try {
    const response = await http.get<Blob>(url, { responseType: "blob" });
    const headers = (response.headers ?? {}) as Record<string, string | undefined>;
    return {
      blob: response.data,
      filename: filenameOf(headers["content-disposition"]),
      mime: headers["content-type"] ?? response.data?.type ?? "application/octet-stream",
      sha256: headers["x-content-sha256"] ?? null,
    };
  } catch (error) {
    const response = (error as { response?: { status: number; data?: unknown } }).response;
    if (response && response.data instanceof Blob) {
      try {
        const body = JSON.parse(await response.data.text());
        throw payrollError(response.status, body);
      } catch (parsed) {
        if (parsed instanceof Error && parsed.name !== "SyntaxError") throw parsed;
      }
    }
    throw toApiError(error);
  }
}

/** Save a fetched file through a temporary link (no copy is kept by the page). */
export function saveFile(file: FetchedFile, fallbackName: string) {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ bank accounts (HR) */

export const bankApi = {
  accounts: (params: { employee_id?: number | string; status?: string; verification_status?: string; payment_hold?: boolean; skip?: number; limit?: number }) =>
    payrollApi.get<PageOf<BankAccount>>("/payroll/bank-accounts", { params: cleanParams(params) }),
  account: (id: number | string) => payrollApi.get<BankAccountDetail>(`/payroll/bank-accounts/${id}`),
  changes: (params: { status?: string; employee_id?: number | string; skip?: number; limit?: number }) =>
    payrollApi.get<PageOf<BankChangeRequest>>("/payroll/bank-change-requests", { params: cleanParams(params) }),
  change: (id: number | string) => payrollApi.get<BankChangeRequest>(`/payroll/bank-change-requests/${id}`),
  approveChange: (id: number, body: { remarks?: string; waive_cooling_off_reason?: string }) =>
    payrollApi.post<ChangeActionResult>(`/payroll/bank-change-requests/${id}/approve`, cleanParams(body)),
  rejectChange: (id: number, remarks: string) => payrollApi.post<ChangeActionResult>(`/payroll/bank-change-requests/${id}/reject`, { remarks }),
  securityReview: (id: number, decision: "RELEASE" | "REJECT", reason: string) =>
    payrollApi.post<ChangeActionResult>(`/payroll/bank-change-requests/${id}/security-review`, { decision, reason }),
  verify: (id: number, body: { method: string; decision?: "PASS" | "FAIL"; evidence_id?: number; reason?: string }, rowVersion?: number) =>
    payrollApi.post<AccountActionResult>(`/payroll/bank-accounts/${id}/verify`, cleanParams(body), { rowVersion }),
  review: (id: number, action: "CLEAR_REVIEW" | "MARK_VERIFIED" | "MARK_FAILED" | "RESUBMIT", reason: string, rowVersion?: number) =>
    payrollApi.post<AccountActionResult>(`/payroll/bank-accounts/${id}/review`, cleanParams({ action, reason }), { rowVersion }),
  waiveCoolingOff: (id: number, reason: string, rowVersion?: number) =>
    payrollApi.post<AccountActionResult>(`/payroll/bank-accounts/${id}/waive-cooling-off`, { reason }, { rowVersion }),
  /** Full number: read_full + reason + step-up, audited; never stored for idempotent replay. */
  reveal: (id: number, reason: string) => payrollApi.post<RevealedAccount>(`/payroll/bank-accounts/${id}/reveal`, { reason }, { idempotencyKey: false }),
  evidenceUrl: (accountId: number, verificationId: number) => `/payroll/bank-accounts/${accountId}/evidence/${verificationId}`,
};

/* ------------------------------------------------------------------ payments */

export const paymentsApi = {
  batches: (params: { run_id?: number | string; status?: string; limit?: number; offset?: number }) =>
    payrollApi.get<PageOf<PaymentBatch>>("/payroll/payment-batches", { params: cleanParams(params) }),
  batch: (id: number | string) => payrollApi.get<PaymentBatchDetail>(`/payroll/payment-batches/${id}`),
  propose: (body: { run_id: number; funding_account_id?: number | null; method?: string | null }) =>
    payrollApi.post<BatchProposal>("/payroll/payment-batches/proposal", cleanParams(body)),
  create: (body: { run_id: number; funding_account_id?: number | null; method?: string | null; value_date?: string | null }, idempotencyKey?: string) =>
    payrollApi.post<CreateBatchesResult>("/payroll/payment-batches", cleanParams(body), { idempotencyKey }),
  approve: (id: number, rowVersion: number) => payrollApi.post<BatchActionResult>(`/payroll/payment-batches/${id}/approve`, { row_version: rowVersion }),
  reject: (id: number, reason: string, rowVersion: number) =>
    payrollApi.post<BatchActionResult>(`/payroll/payment-batches/${id}/reject`, { reason, row_version: rowVersion }),
  cancel: (id: number, reason: string, rowVersion: number) =>
    payrollApi.post<BatchActionResult>(`/payroll/payment-batches/${id}/cancel`, { reason, row_version: rowVersion }),
  generateFile: (id: number, rowVersion: number) =>
    payrollApi.post<BatchActionResult>(`/payroll/payment-batches/${id}/generate-file`, { row_version: rowVersion }),
  fileUrl: (id: number) => `/payroll/payment-batches/${id}/file`,
  /** Mark as submitted (bank file; carries the hash the releaser saw) or submit to the SANDBOX payout adapter. */
  release: (id: number, rowVersion: number, fileSha256: string | null, idempotencyKey?: string) =>
    payrollApi.post<BatchActionResult>(`/payroll/payment-batches/${id}/release`, cleanParams({ row_version: rowVersion, file_sha256: fileSha256 }), { idempotencyKey }),
  resolveBankChanges: (id: number, decision: "PROCEED" | "RECREATE", reason: string, rowVersion: number) =>
    payrollApi.post<{ decision: string; batch: BatchActionResult; created: { id: number; reference: string; status: string }[] }>(
      `/payroll/payment-batches/${id}/bank-changes`,
      { decision, reason, row_version: rowVersion },
    ),
  instructions: (params: { run_id?: number | string; batch_id?: number | string; employee_id?: number | string; status?: string; limit?: number; offset?: number }) =>
    payrollApi.get<PageOf<PaymentInstruction>>("/payroll/payment-instructions", { params: cleanParams(params) }),
  instruction: (id: number | string) => payrollApi.get<InstructionDetail>(`/payroll/payment-instructions/${id}`),
  events: (id: number | string) => payrollApi.get<{ instruction: PaymentInstruction; events: PaymentEvent[] }>(`/payroll/payment-instructions/${id}/events`),
  releaseHold: (id: number, reason: string, rowVersion?: number) =>
    payrollApi.post<{ id: number; status: string }>(`/payroll/payment-instructions/${id}/release-hold`, cleanParams({ reason, row_version: rowVersion })),
  reissue: (id: number, reason: string, rowVersion?: number) =>
    payrollApi.post<{ status: string }>(`/payroll/payment-instructions/${id}/reissue`, cleanParams({ reason, row_version: rowVersion })),
  /** Finalized runs this person can see (to create batches from). */
  runs: (status?: string) => payrollApi.get<PageOf<RunOption>>("/payroll/runs", { params: cleanParams({ status, limit: 50 }) }),
  run: (id: number | string) => payrollApi.get<RunOption>(`/payroll/runs/${id}`),
};

/* ------------------------------------------------------------------ reconciliation */

export const reconApi = {
  statements: (params: { funding_account_id?: number | string; limit?: number; offset?: number }) =>
    payrollApi.get<PageOf<StatementImport>>("/payroll/bank-statements", { params: cleanParams(params) }),
  statement: (id: number | string) => payrollApi.get<StatementImport>(`/payroll/bank-statements/${id}`),
  statementMatches: (id: number | string, queue?: MatchQueue) =>
    payrollApi.get<PageOf<ReconciliationMatch>>(`/payroll/bank-statements/${id}/matches`, { params: cleanParams({ queue }) }),
  matches: (params: { queue?: MatchQueue; funding_account_id?: number | string; limit?: number; offset?: number }) =>
    payrollApi.get<PageOf<ReconciliationMatch>>("/payroll/reconciliation-matches", { params: cleanParams(params) }),
  overdue: (params: { funding_account_id?: number | string; grace?: number }) =>
    payrollApi.get<OverdueResult>("/payroll/reconciliation/overdue", { params: cleanParams(params) }),
  accept: (id: number, reason: string, rowVersion: number) =>
    payrollApi.post<{ id: number; status: string }>(`/payroll/reconciliation-matches/${id}/accept`, { reason, row_version: rowVersion }),
  link: (id: number, instructionId: number, reason: string, rowVersion: number) =>
    payrollApi.post<{ id: number; status: string }>(`/payroll/reconciliation-matches/${id}/link`, { instruction_id: instructionId, reason, row_version: rowVersion }),
  escalate: (id: number, reason: string, rowVersion: number) =>
    payrollApi.post<{ id: number; status: string }>(`/payroll/reconciliation-matches/${id}/escalate`, { reason, row_version: rowVersion }),
  /** Multipart import; idempotent on the server by file hash and line hash. */
  importStatement: (form: { funding_account_id: number; format: "CSV" | "CAMT053"; mapping?: CsvMapping | null; file: File }, idempotencyKey?: string) => {
    const data = new FormData();
    data.append("funding_account_id", String(form.funding_account_id));
    data.append("format", form.format);
    if (form.format === "CSV" && form.mapping) data.append("mapping", JSON.stringify(form.mapping));
    data.append("file", form.file);
    return payrollApi.post<ImportStatementResult>("/payroll/bank-statements/import", data, { idempotencyKey });
  },
};

/* ------------------------------------------------------------------ funding accounts */

export const fundingApi = {
  list: (params: { legal_entity_id?: number | string; status?: string; purpose?: string } = {}) =>
    payrollApi.get<{ items: FundingAccount[] }>("/payroll/funding-accounts", { params: cleanParams(params) }),
  get: (id: number | string) => payrollApi.get<FundingAccount>(`/payroll/funding-accounts/${id}`),
  create: (legalEntityId: number, body: FundingAccountInput, idempotencyKey?: string) =>
    payrollApi.post<FundingAccount>(`/payroll/legal-entities/${legalEntityId}/funding-accounts`, body, { idempotencyKey }),
  update: (id: number, body: Partial<FundingAccountInput>, rowVersion: number) =>
    payrollApi.patch<FundingAccount>(`/payroll/funding-accounts/${id}`, { ...body, row_version: rowVersion }),
  deactivate: (id: number, reason: string, rowVersion: number) =>
    payrollApi.post<FundingAccount>(`/payroll/funding-accounts/${id}/deactivate`, { reason, row_version: rowVersion }),
  reveal: (id: number, reason: string) => payrollApi.post<RevealedAccount>(`/payroll/funding-accounts/${id}/reveal`, { reason }, { idempotencyKey: false }),
};

/* ------------------------------------------------------------------ lookups */

export const moneyLookups = {
  /** GET /legal-entities (org:read or org:manage_entities). */
  entities: () => payrollApi.get<LegalEntityOption[]>("/legal-entities"),
  /** GET /users (user:read), for preparer / releaser / signatory names. */
  users: (q = "", limit = 200) => payrollApi.get<{ total: number; items: UserOption[] }>("/users", { params: cleanParams({ q, limit }) }),
};
