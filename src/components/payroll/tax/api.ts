/**
 * Tax profile endpoint helpers on the shared `payrollApi` (Idempotency-Key on every state change, structured
 * 409s, STEP_UP_REQUIRED retry). Paths are relative to /api/v1 and match hrms-backend/app/payroll/routes/tax_profiles.py.
 */

import type { AxiosProgressEvent } from "axios";

import { payrollApi } from "@/lib/payroll/api";

import type { MyTaxProfile, StaffTaxList, StaffTaxVersion, TaxProof, TaxSubmitResult } from "./types";

function params(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.entries(values).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  });
  return out;
}

export const taxApi = {
  /* employee (own record only) */
  profile: () => payrollApi.get<MyTaxProfile>("/me/payroll/tax-profile"),
  /** A full replacement of the declarations. A tax identifier needs a step-up (payrollApi asks, then retries once). */
  submit: (body: { values: Record<string, string | number | boolean | null>; effective_from?: string | null }, idempotencyKey?: string) =>
    payrollApi.put<TaxSubmitResult>("/me/payroll/tax-profile", body, idempotencyKey ? { idempotencyKey } : undefined),
  withdraw: (id: number, rowVersion?: number) =>
    payrollApi.post<TaxSubmitResult>(`/me/payroll/tax-profile/versions/${id}/withdraw`, rowVersion ? { row_version: rowVersion } : {}),
  addProof: (versionId: number, fieldCode: string, file: File, onProgress?: (percent: number) => void) => {
    const form = new FormData();
    form.append("field_code", fieldCode);
    form.append("file", file);
    return payrollApi.post<TaxProof & { profile_id: number }>(`/me/payroll/tax-profile/versions/${versionId}/proofs`, form, {
      config: {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e: AxiosProgressEvent) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
      },
    });
  },
  proofPath: (versionId: number, proofId: number) => `/me/payroll/tax-profile/versions/${versionId}/proofs/${proofId}`,

  /* HR review (payroll:tax_profile:review, legal-entity scope) */
  list: (query: { status?: string | null; employee_id?: number | null; legal_entity_id?: number | null; skip?: number; limit?: number } = {}) =>
    payrollApi.get<StaffTaxList>("/payroll/tax-profiles", { params: params(query) }),
  get: (id: number) => payrollApi.get<StaffTaxVersion>(`/payroll/tax-profiles/${id}`),
  /** Needs a fresh step-up; never the submitter's own declarations. */
  approve: (id: number, body: { note?: string | null; row_version?: number }) =>
    payrollApi.post<TaxSubmitResult>(`/payroll/tax-profiles/${id}/approve`, { note: body.note || null, row_version: body.row_version }),
  reject: (id: number, body: { note: string; row_version?: number }) =>
    payrollApi.post<TaxSubmitResult>(`/payroll/tax-profiles/${id}/reject`, body),
  staffProofPath: (versionId: number, proofId: number) => `/payroll/tax-profiles/${versionId}/proofs/${proofId}`,
};
