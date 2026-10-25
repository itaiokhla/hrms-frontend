/**
 * Endpoint helpers for legal holds and retention on the shared `payrollApi` (Idempotency-Key on every state
 * change, structured 409s, STEP_UP_REQUIRED retry). Paths are relative to /api/v1 and match
 * hrms-backend/app/payroll/routes/legal_holds.py exactly.
 */

import { payrollApi } from "@/lib/payroll/api";

import type { ErasureResult, HoldInput, HoldPage, HoldScope, HoldStatus, HoldSummary, LegalHold, SweepCounts, SweepRow } from "./types";

export interface HoldQuery {
  status?: HoldStatus | null;
  scope?: HoldScope | null;
  skip?: number;
  limit?: number;
}

function params(query: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  });
  return out;
}

export const holdsApi = {
  list: (query: HoldQuery = {}) => payrollApi.get<HoldPage>("/payroll/legal-holds", { params: params(query) }),
  get: (id: number | string) => payrollApi.get<LegalHold>(`/payroll/legal-holds/${encodeURIComponent(String(id))}`),
  summary: () => payrollApi.get<HoldSummary>("/payroll/legal-holds/summary"),
  sweeps: (limit = 20) => payrollApi.get<{ items: SweepRow[] }>("/payroll/legal-holds/sweeps", { params: { limit } }),
  /** 201; foreign or unknown targets are 404, a wrong target for the scope is 400 INVALID_TARGET. */
  place: (input: HoldInput) => payrollApi.post<LegalHold>("/payroll/legal-holds", input),
  /** Another person than the creator, with a step-up (403 MAKER_CHECKER_REQUIRED / STEP_UP_REQUIRED). */
  release: (id: number, body: { reason: string; row_version?: number }) =>
    payrollApi.post<LegalHold>(`/payroll/legal-holds/${id}/release`, body),
  /** Run the retention sweep now (step-up): counts only. */
  sweep: () => payrollApi.post<SweepCounts>("/payroll/legal-holds/sweeps", {}),
  /** 409 LEGAL_HOLD while a hold covers the employee's data. */
  erase: (employeeId: number, reason: string) =>
    payrollApi.post<ErasureResult>("/payroll/legal-holds/erasure-requests", { employee_id: employeeId, reason }),
};
