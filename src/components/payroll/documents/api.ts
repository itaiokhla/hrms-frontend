/**
 * Endpoint helpers for payslips (HR), the download center, reports and compliance, on the shared
 * `payrollApi` (Idempotency-Key on every state change, structured 409s, STEP_UP_REQUIRED retry).
 * Paths are relative to /api/v1 and match hrms-backend/app/payroll/routes/{payslips,documents,
 * reports,compliance}.py exactly.
 */

import { http, toApiError } from "@/lib/api";
import { payrollApi } from "@/lib/payroll/api";

import type {
  BulkPublishResult,
  CatalogueReport,
  ComplianceOverview,
  DocumentExport,
  GenerationStatus,
  Liability,
  LiabilityPage,
  ListPage,
  Option,
  PayslipDetail,
  PayslipSummary,
  ReportCatalogue,
  ReportExport,
  ReportFilters,
  ReportPreview,
  RunOption,
  RunPublishResult,
  SignedLink,
  StatutoryReport,
  TransitionResult,
} from "./types";

type Params = Record<string, unknown>;

/** Drop empty filter values so the API sees only what the person chose. */
export function cleanParams<T extends object>(params: T): Params {
  const out: Params = {};
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  });
  return out;
}

/* ------------------------------------------------------------------ files */

/**
 * Follow a signed link (`{url}` from a `…/download` endpoint). The URL is same-origin, bound to this
 * user and session and valid for five minutes, so the browser downloads it directly.
 */
export function openSignedLink(link: { url: string }) {
  const a = document.createElement("a");
  a.href = link.url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Download a protected file as a Blob (report exports, statutory files): errors stay in the page. */
export async function fetchBlob(url: string): Promise<Blob> {
  try {
    const response = await http.get<Blob>(url, { responseType: "blob" });
    return response.data;
  } catch (error) {
    throw toApiError(error);
  }
}

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

/* ------------------------------------------------------------------ payslips (HR) */

export interface PayslipQuery {
  run_id?: number | null;
  employee_id?: number | null;
  legal_entity_id?: number | null;
  pay_group_id?: number | null;
  status?: string | null;
  period_from?: string | null;
  period_to?: string | null;
  latest_only?: boolean;
  skip?: number;
  limit?: number;
}

export const payslipsApi = {
  list: (query: PayslipQuery) => payrollApi.get<ListPage<PayslipSummary>>("/payroll/payslips", { params: cleanParams(query) }),
  get: (id: number | string) => payrollApi.get<PayslipDetail>(`/payroll/payslips/${encodeURIComponent(String(id))}`),
  /** A signed five-minute link to the PDF. */
  downloadLink: (id: number | string) => payrollApi.get<SignedLink>(`/payroll/payslips/${encodeURIComponent(String(id))}/download`),
  publishOne: (id: number, reason: string, rowVersion?: number) =>
    payrollApi.post<PayslipSummary>(`/payroll/payslips/${id}/publish`, { reason, ...(rowVersion ? { row_version: rowVersion } : {}) }),
  publishBulk: (documentIds: number[], reason: string) =>
    payrollApi.post<BulkPublishResult>("/payroll/payslips/publish", { document_ids: documentIds, reason }),
  resend: (id: number) => payrollApi.post<{ document_id: number; queued: boolean }>(`/payroll/payslips/${id}/resend`),
  /** Queues a ZIP of a finalized run's payslips in the download center (202). */
  zip: (runId: number) => payrollApi.post<DocumentExport>("/payroll/payslips/zip", { run_id: runId }),
  publishRun: (runId: number, reason: string) => payrollApi.post<RunPublishResult>(`/payroll/runs/${runId}/publish`, { reason }),
  generation: (runId: number) => payrollApi.get<GenerationStatus>(`/payroll/runs/${runId}/payslips/generation`),
  retryFailed: (runId: number) => payrollApi.post<{ run_id: number; requeued: number }>(`/payroll/runs/${runId}/payslips/retry-failed`),
};

/* ------------------------------------------------------------------ download center */

export const exportsApi = {
  list: (skip = 0, limit = 50) => payrollApi.get<ListPage<DocumentExport>>("/payroll/exports", { params: { skip, limit } }),
  /** POST: a signed link for a READY export (409 EXPORT_NOT_READY otherwise). */
  link: (id: number) => payrollApi.post<SignedLink>(`/payroll/exports/${id}/download`),
  reportList: (limit = 50) => payrollApi.get<{ items: ReportExport[] }>("/payroll/report-exports", { params: { limit } }),
  reportFileUrl: (id: number) => `/payroll/report-exports/${id}/download`,
};

/* ------------------------------------------------------------------ reports */

export const reportsApi = {
  catalogue: () => payrollApi.get<ReportCatalogue>("/payroll/reports"),
  preview: (code: string, filters: ReportFilters) =>
    payrollApi.get<ReportPreview>(`/payroll/reports/${encodeURIComponent(code)}/preview`, { params: cleanParams(filters) }),
  export: (code: string, format: string, filters: ReportFilters) =>
    payrollApi.post<{ id: number; job_id: number; status: string; report_code: string; format: string }>(
      `/payroll/reports/${encodeURIComponent(code)}/exports`,
      { format, filters: cleanParams(filters) },
    ),
};

export function findReport(catalogue: ReportCatalogue | undefined, code: string | null | undefined): CatalogueReport | undefined {
  if (!catalogue || !code) return undefined;
  for (const group of catalogue.groups) {
    const found = group.reports.find((r) => r.code === code);
    if (found) return found;
  }
  return undefined;
}

/* ------------------------------------------------------------------ compliance */

export interface LiabilityQuery {
  legal_entity_id?: number | null;
  status?: string | null;
  scheme?: string | null;
  currency?: string | null;
  overdue?: boolean | null;
  skip?: number;
  limit?: number;
}

export const complianceApi = {
  overview: (legalEntityId?: number | null) =>
    payrollApi.get<ComplianceOverview>("/payroll/compliance", { params: cleanParams({ legal_entity_id: legalEntityId }) }),
  report: (id: number | string) => payrollApi.get<StatutoryReport>(`/payroll/statutory-reports/${encodeURIComponent(String(id))}`),
  createReport: (legalEntityId: number, reportCode: string, periodStart: string) =>
    payrollApi.post<TransitionResult>("/payroll/statutory-reports", { legal_entity_id: legalEntityId, report_code: reportCode, period_start: periodStart }),
  /** Lifecycle actions; `body` carries row_version and the action's own fields. */
  transition: (id: number, action: string, body: Record<string, unknown>) =>
    payrollApi.post<TransitionResult>(`/payroll/statutory-reports/${id}/${ACTION_PATH[action] ?? action.toLowerCase().replace(/_/g, "-")}`, body),
  reportFileUrl: (id: number) => `/payroll/statutory-reports/${id}/file`,
  liabilities: (query: LiabilityQuery) => payrollApi.get<LiabilityPage>("/payroll/liabilities", { params: cleanParams(query) }),
  liability: (id: number | string) => payrollApi.get<Liability>(`/payroll/liabilities/${encodeURIComponent(String(id))}`),
  remit: (id: number, body: { remittance_ref: string; remitted_on?: string | null; note?: string | null; row_version?: number }) =>
    payrollApi.post<TransitionResult>(`/payroll/liabilities/${id}/remit`, cleanParams(body)),
  reconcile: (id: number, body: { note?: string | null; row_version?: number }) =>
    payrollApi.post<TransitionResult>(`/payroll/liabilities/${id}/reconcile`, cleanParams(body)),
};

/** Statutory-report action → route segment (compliance.py). */
export const ACTION_PATH: Record<string, string> = {
  GENERATE: "generate",
  REGENERATE: "regenerate",
  SUBMIT_FOR_REVIEW: "submit-for-review",
  VERIFY: "verify",
  EXPORT: "export",
  MARK_SUBMITTED: "mark-submitted",
  RECORD_ACCEPTED: "record-accepted",
  RECORD_REJECTED: "record-rejected",
  AMEND: "amend",
};

/* ------------------------------------------------------------------ lookups (each degrades to an id field without access) */

export const lookupsApi = {
  /** GET /legal-entities (org:read or org:manage_entities). */
  legalEntities: () =>
    payrollApi.get<{ id: number; code: string; legal_name: string }[]>("/legal-entities").then((rows) => rows.map((r) => ({ id: r.id, name: r.legal_name }) as Option)),
  /** GET /payroll/org/pay-groups (org:read, org:manage_dimensions or payroll:configuration:read). */
  payGroups: () =>
    payrollApi.get<{ id: number; name: string; legal_entity_id: number | null }[]>("/payroll/org/pay-groups").then((rows) => rows.map((r) => ({ id: r.id, name: r.name, legal_entity_id: r.legal_entity_id }) as Option)),
  /** GET /payroll/org/cost-centers (org:read or org:manage_dimensions). */
  costCenters: () =>
    payrollApi.get<{ id: number; name: string; legal_entity_id: number | null }[]>("/payroll/org/cost-centers").then((rows) => rows.map((r) => ({ id: r.id, name: r.name, legal_entity_id: r.legal_entity_id }) as Option)),
  /** GET /departments (any signed-in user; scoped by the server). */
  departments: () => payrollApi.get<{ id: number; name: string }[]>("/departments").then((rows) => rows.map((r) => ({ id: r.id, name: r.name }) as Option)),
  /** GET /payroll/runs (payroll:run:read). Finalized runs first is the server's order. */
  runs: (limit = 100) => payrollApi.get<ListPage<RunOption>>("/payroll/runs", { params: { limit } }),
};
