/**
 * Pay-run endpoints on the shared `payrollApi` (Idempotency-Key on every state change, structured 409s,
 * STEP_UP_REQUIRED retry through StepUpProvider). Paths are relative to /api/v1 and match
 * hrms-backend/app/payroll/routes/{runs,run_calculation,run_approvals,overview,corrections,payments,payslips}.py.
 */

import { payrollApi } from "@/lib/payroll/api";

import type {
  ApprovalRequestDetail,
  Attestation,
  BranchOption,
  CalculateResult,
  EntityOption,
  FinalizationStatus,
  GenerationStatus,
  ListPage,
  Overview,
  OverviewList,
  PayGroupOption,
  PayPeriodOption,
  PaymentBatchBrief,
  PopulationPreview,
  PrecheckResult,
  Reversal,
  Run,
  RunActionResult,
  RunApprovals,
  RunEmployeeDetail,
  RunEmployeesPage,
  RunException,
  RunSummary,
  StaleInfo,
  VariancePage,
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

const run = (id: number | string) => `/payroll/runs/${encodeURIComponent(String(id))}`;

export const runsApi = {
  /* ---------------------------------------------------------------- overview */
  overview: (params: Params) => payrollApi.get<Overview>("/payroll/overview", { params: cleanParams(params) }),
  /** The drill-down list of one count KPI: the same population query as the count (EC-UX-03). */
  overviewList: (kpi: string, params: Params) =>
    payrollApi.get<OverviewList>(`/payroll/overview/${encodeURIComponent(kpi)}`, { params: cleanParams({ limit: 500, ...params }) }),

  /* ---------------------------------------------------------------- runs */
  list: (params: Params) => payrollApi.get<ListPage<Run>>("/payroll/runs", { params: cleanParams(params) }),
  get: (id: number | string) => payrollApi.get<Run>(run(id)),
  populationPreview: (payGroupId: number, payPeriodId: number) =>
    payrollApi.get<PopulationPreview>("/payroll/run-population-preview", { params: { pay_group_id: payGroupId, pay_period_id: payPeriodId } }),
  create: (body: { run_type: string; pay_group_id: number; pay_period_id: number; label?: string | null; employee_ids?: number[] }, idempotencyKey?: string) =>
    payrollApi.post<RunActionResult & { population: Record<string, unknown> }>("/payroll/runs", body, { idempotencyKey }),
  precheck: (id: number, rowVersion?: number) => payrollApi.post<PrecheckResult>(`${run(id)}/precheck`, { row_version: rowVersion }),
  calculate: (id: number, body: { employee_ids?: number[]; row_version?: number }, idempotencyKey?: string) =>
    payrollApi.post<CalculateResult>(`${run(id)}/calculate`, body, { idempotencyKey }),
  cancel: (id: number, reason: string, rowVersion?: number) => payrollApi.post<RunActionResult>(`${run(id)}/cancel`, { reason, row_version: rowVersion }),
  submit: (id: number, comment: string | null, rowVersion?: number) =>
    payrollApi.post<RunActionResult>(`${run(id)}/submit`, { comment: comment || null, row_version: rowVersion }),
  approve: (id: number, body: { row_version: number; comment?: string | null; expected_step?: number | null }) =>
    payrollApi.post<RunActionResult & { self_line_pending?: unknown }>(`${run(id)}/approve`, cleanParams(body)),
  reject: (id: number, body: { row_version: number; reason: string; expected_step?: number | null }) =>
    payrollApi.post<RunActionResult>(`${run(id)}/reject`, cleanParams(body)),
  rework: (id: number, note: string | null, rowVersion?: number) =>
    payrollApi.post<RunActionResult>(`${run(id)}/rework`, { note: note || null, row_version: rowVersion }),
  reopen: (id: number, body: { reason: string; target?: "REVIEW_REQUIRED" | "DRAFT"; row_version?: number }) =>
    payrollApi.post<RunActionResult>(`${run(id)}/reopen`, cleanParams(body)),
  finalize: (id: number, confirmLabel: string, rowVersion: number | undefined, idempotencyKey: string) =>
    payrollApi.post<RunActionResult & { finalized_at: string | null }>(`${run(id)}/finalize`, { confirm_label: confirmLabel, row_version: rowVersion }, { idempotencyKey }),
  close: (id: number, note: string | null, rowVersion?: number) =>
    payrollApi.post<RunActionResult>(`${run(id)}/close`, { note: note || null, row_version: rowVersion }),
  finalization: (id: number) => payrollApi.get<FinalizationStatus>(`${run(id)}/finalization`),
  approvals: (id: number) => payrollApi.get<RunApprovals>(`${run(id)}/approvals`),
  approveSelfLine: (id: number, runEmployeeId: number, comment?: string | null) =>
    payrollApi.post<{ id: number; row_version: number }>(`${run(id)}/employees/${runEmployeeId}/approve-self-line`, { comment: comment || null }),
  approvalRequest: (requestId: number) => payrollApi.get<ApprovalRequestDetail>(`/payroll/approvals/${requestId}`),

  /* ---------------------------------------------------------------- review */
  summary: (id: number | string) => payrollApi.get<RunSummary>(`${run(id)}/summary`),
  employees: (id: number | string, params: Params) => payrollApi.get<RunEmployeesPage>(`${run(id)}/employees`, { params: cleanParams(params) }),
  employee: (id: number | string, runEmployeeId: number | string) => payrollApi.get<RunEmployeeDetail>(`${run(id)}/employees/${encodeURIComponent(String(runEmployeeId))}`),
  variance: (id: number, params: Params) => payrollApi.get<VariancePage>(`${run(id)}/variance`, { params: cleanParams(params) }),
  acknowledge: (id: number, runEmployeeId: number, comment: string | null) =>
    payrollApi.post<{ remaining: number }>(`${run(id)}/variance/${runEmployeeId}/acknowledge`, { comment: comment || null }),
  stale: (id: number) => payrollApi.get<StaleInfo>(`${run(id)}/stale`),

  /* ---------------------------------------------------------------- holds and exceptions */
  hold: (id: number, runEmployeeId: number, body: { hold_type: string; reason_code: string; note: string; row_version?: number }) =>
    payrollApi.post<{ id: number; status: string; hold_type: string | null }>(`${run(id)}/employees/${runEmployeeId}/hold`, body),
  release: (id: number, runEmployeeId: number, note: string, rowVersion?: number) =>
    payrollApi.post<{ id: number; status: string }>(`${run(id)}/employees/${runEmployeeId}/release`, { note, row_version: rowVersion }),
  exceptions: (id: number | string, params: Params = {}) =>
    payrollApi.get<ListPage<RunException>>(`${run(id)}/exceptions`, { params: cleanParams({ limit: 1000, ...params }) }),
  waive: (exceptionId: number, reason: string, rowVersion?: number) =>
    payrollApi.post<{ id: number; status: string }>(`/payroll/exceptions/${exceptionId}/waive`, { reason, row_version: rowVersion }),
  defer: (exceptionId: number, to: "NEXT_PERIOD" | "RETRO", reason: string, rowVersion?: number) =>
    payrollApi.post<{ id: number; status: string }>(`/payroll/exceptions/${exceptionId}/defer`, { to, reason, row_version: rowVersion }),
  fix: (exceptionId: number, note: string | null) =>
    payrollApi.post<{ id: number; status: string }>(`/payroll/exceptions/${exceptionId}/fix`, { note: note || null }),

  /* ---------------------------------------------------------------- attestations (I-15) */
  attestations: (legalEntityId: number) =>
    payrollApi.get<ListPage<Attestation>>("/payroll/statutory-attestations", { params: { legal_entity_id: legalEntityId } }),
  createAttestation: (body: { legal_entity_id: number; effective_from: string; effective_to?: string | null; reason: string; schemes: string[]; evidence_ref?: string | null }) =>
    payrollApi.post<Attestation>("/payroll/statutory-attestations", cleanParams(body)),
  approveAttestation: (attestationId: number, rowVersion?: number) =>
    payrollApi.post<Attestation>(`/payroll/statutory-attestations/${attestationId}/approve`, { row_version: rowVersion }),

  /* ---------------------------------------------------------------- corrections */
  reversals: (runId: number) => payrollApi.get<ListPage<Reversal>>("/payroll/reversals", { params: { run_id: runId } }),
  reverse: (runId: number, reason: string, rowVersion?: number) =>
    payrollApi.post<{ id: number; status: string; reversal_run_id: number | null }>(`${run(runId)}/reverse`, { reason, row_version: rowVersion }),
  approveReversal: (reversalId: number, comment: string | null, rowVersion?: number) =>
    payrollApi.post<{ id: number; status: string; reversal_run_id: number | null }>(`/payroll/reversals/${reversalId}/approve`, { comment: comment || null, row_version: rowVersion }),
  rejectReversal: (reversalId: number, reason: string, rowVersion?: number) =>
    payrollApi.post<{ id: number; status: string }>(`/payroll/reversals/${reversalId}/reject`, { reason, row_version: rowVersion }),

  /* ---------------------------------------------------------------- after finalize */
  batches: (runId: number) => payrollApi.get<ListPage<PaymentBatchBrief>>("/payroll/payment-batches", { params: { run_id: runId } }),
  generation: (runId: number) => payrollApi.get<GenerationStatus>(`${run(runId)}/payslips/generation`),
  retryFailedPayslips: (runId: number) => payrollApi.post<{ job_id?: number }>(`${run(runId)}/payslips/retry-failed`, {}),

  /* ---------------------------------------------------------------- lookups (may be forbidden: callers degrade) */
  legalEntities: () => payrollApi.get<EntityOption[]>("/legal-entities"),
  payGroups: () => payrollApi.get<PayGroupOption[]>("/payroll/org/pay-groups"),
  branches: () => payrollApi.get<BranchOption[]>("/branches"),
  periods: (payGroupId: number, params: Params = {}) =>
    payrollApi.get<ListPage<PayPeriodOption>>(`/payroll/pay-groups/${payGroupId}/periods`, { params: cleanParams({ limit: 100, ...params }) }),
};
