/**
 * Compensation endpoints (hrms-backend/app/payroll/routes/compensation.py), all through `payrollApi`
 * so every state-changing call carries an Idempotency-Key, 409s keep their body and STEP_UP_REQUIRED
 * opens the step-up prompt. Paths are relative to /api/v1.
 */

import { payrollApi } from "@/lib/payroll/api";
import type { Money } from "@/lib/money";

import type {
  Assignment,
  AssignmentReason,
  Breakdown,
  CompareResult,
  CompensationFilter,
  CompensationList,
  CycleMethod,
  CyclePopulation,
  EmployeeCompensation,
  Eligibility,
  FormulaCheck,
  ImportCommit,
  ImportDryRun,
  ImportRecord,
  MovePreviewResult,
  OrgOption,
  OverrideValue,
  PayComponent,
  RevisionCycle,
  SalaryStructure,
  StructureLine,
  TesterResult,
  TestVector,
  ValidationReport,
} from "./types";

const enc = encodeURIComponent;

export type ComponentPayload = Record<string, unknown>;

export interface LinePayload {
  component: string;
  method?: string | null;
  value?: string | null;
  formula?: string | null;
  params?: Record<string, unknown> | null;
  overridable: boolean;
  override_min?: string | null;
  override_max?: string | null;
  display_order?: number | null;
}

export function linePayload(line: StructureLine, index: number): LinePayload {
  return {
    component: line.component,
    method: line.method || null,
    value: line.value === "" ? null : line.value,
    formula: line.formula || null,
    params: line.params && Object.keys(line.params).length ? line.params : null,
    overridable: !!line.overridable,
    override_min: line.overridable && line.override_min ? line.override_min : null,
    override_max: line.overridable && line.override_max ? line.override_max : null,
    display_order: index,
  };
}

export const compensationApi = {
  /* components */
  listComponents: (params: { kind?: string; include_archived?: boolean } = {}) =>
    payrollApi.get<PayComponent[]>("/payroll/components", { params }),
  seedComponents: () => payrollApi.post<{ created: unknown }>("/payroll/components/seed", {}),
  getComponent: (code: string) => payrollApi.get<PayComponent>(`/payroll/components/${enc(code)}`),
  createComponent: (body: ComponentPayload) => payrollApi.post<PayComponent>("/payroll/components", body),
  createComponentVersion: (code: string, body: ComponentPayload) =>
    payrollApi.post<PayComponent>(`/payroll/components/${enc(code)}/versions`, body),
  patchComponent: (code: string, body: { code?: string; status?: "ACTIVE" | "ARCHIVED" }) =>
    payrollApi.patch<PayComponent>(`/payroll/components/${enc(code)}`, body),
  validateFormula: (body: { formula: string; currency?: string; component?: string; kind?: string; expect?: "AMOUNT" | "NUMBER" | "BOOLEAN" | "ANY" }, signal?: AbortSignal) =>
    payrollApi.post<FormulaCheck>("/payroll/components/validate-formula", body, { idempotencyKey: false, signal }),
  testComponent: (code: string, body: { formula?: string; currency?: string; sample?: Record<string, unknown>; employee_id?: number; period_start?: string; period_end?: string }) =>
    payrollApi.post<TesterResult>(`/payroll/components/${enc(code)}/test`, body, { idempotencyKey: false }),

  /* structures */
  listStructures: (include_archived = false) => payrollApi.get<SalaryStructure[]>("/payroll/salary-structures", { params: { include_archived } }),
  getStructure: (id: number | string) => payrollApi.get<SalaryStructure>(`/payroll/salary-structures/${enc(String(id))}`),
  createStructure: (body: { code: string; name: string; type: string; description?: string | null; currency?: string | null; eligibility?: Eligibility; lines: LinePayload[] }) =>
    payrollApi.post<SalaryStructure>("/payroll/salary-structures", body),
  createStructureVersion: (id: number, from_version?: number) =>
    payrollApi.post<SalaryStructure>(`/payroll/salary-structures/${id}/versions`, from_version ? { from_version } : {}),
  updateStructureVersion: (id: number, version: number, body: { row_version?: number; name?: string; description?: string | null; eligibility?: Eligibility; lines?: LinePayload[]; test_range?: { min: string; max: string } | null; test_vectors?: TestVector[] }) =>
    payrollApi.put<SalaryStructure>(`/payroll/salary-structures/${id}/versions/${version}`, body),
  validateStructure: (id: number, version?: number) =>
    payrollApi.post<ValidationReport>(`/payroll/salary-structures/${id}/validate`, version ? { version } : {}, { idempotencyKey: false }),
  previewStructure: (id: number, body: { pay_basis_amount: Money; version?: number; overrides?: Record<string, OverrideValue> }, signal?: AbortSignal) =>
    payrollApi.post<Breakdown>(`/payroll/salary-structures/${id}/preview`, body, { idempotencyKey: false, signal }),
  publishStructure: (id: number, body: { version: number; effective_from?: string }) =>
    payrollApi.post<SalaryStructure>(`/payroll/salary-structures/${id}/publish`, body),
  moveAssignments: (id: number, body: { to_version?: number; effective_from: string; assignment_ids?: number[]; dry_run: boolean; note?: string }) =>
    payrollApi.post<MovePreviewResult>(`/payroll/salary-structures/${id}/move-assignments`, body, body.dry_run ? { idempotencyKey: false } : undefined),
  archiveStructure: (id: number) => payrollApi.post<SalaryStructure>(`/payroll/salary-structures/${id}/archive`, {}),

  /* compensation */
  listCompensation: (params: { filter: CompensationFilter; q?: string; legal_entity_id?: number; limit?: number; offset?: number }) =>
    payrollApi.get<CompensationList>("/payroll/compensation", { params }),
  employeeCompensation: (employeeId: number | string) =>
    payrollApi.get<EmployeeCompensation>(`/payroll/employees/${enc(String(employeeId))}/compensation`),
  previewChange: (employeeId: number, body: { pay_basis_amount: Money; effective_from: string; template_version_id?: number; overrides?: Record<string, OverrideValue> }, signal?: AbortSignal) =>
    payrollApi.post<CompareResult>(`/payroll/employees/${employeeId}/compensation/preview`, body, { idempotencyKey: false, signal }),
  assign: (employeeId: number, body: { template_version_id: number; pay_basis_amount: Money; effective_from: string; reason: AssignmentReason; overrides?: Record<string, OverrideValue>; note?: string; submit?: boolean }, idempotencyKey?: string) =>
    payrollApi.post<Assignment>(`/payroll/employees/${employeeId}/compensation`, body, { idempotencyKey }),
  getAssignment: (id: number) => payrollApi.get<Assignment>(`/payroll/compensation/${id}`),
  submitAssignment: (id: number) => payrollApi.post<Assignment>(`/payroll/compensation/${id}/submit`, {}),
  approveAssignment: (id: number, remarks?: string) => payrollApi.post<Assignment>(`/payroll/compensation/${id}/approve`, remarks ? { remarks } : {}),
  rejectAssignment: (id: number, remarks: string) => payrollApi.post<Assignment>(`/payroll/compensation/${id}/reject`, { remarks }),
  importTemplateUrl: "/api/v1/payroll/compensation/import-template",
  importDryRun: (csv: string, file_name?: string) =>
    payrollApi.post<ImportDryRun>("/payroll/compensation/import", { mode: "dry_run", csv, file_name }),
  importCommit: (import_id: number, idempotencyKey?: string) =>
    payrollApi.post<ImportCommit>("/payroll/compensation/import", { mode: "commit", import_id }, { idempotencyKey }),
  getImport: (id: number) => payrollApi.get<ImportRecord>(`/payroll/compensation/imports/${id}`),

  /* revision cycles */
  listCycles: () => payrollApi.get<RevisionCycle[]>("/payroll/revision-cycles"),
  getCycle: (id: number | string) => payrollApi.get<RevisionCycle>(`/payroll/revision-cycles/${enc(String(id))}`),
  createCycle: (body: { name: string; population?: CyclePopulation; method: CycleMethod; effective_from: string }) =>
    payrollApi.post<RevisionCycle>("/payroll/revision-cycles", body),
  updateCycle: (id: number, body: { row_version?: number; name?: string; population?: CyclePopulation; method?: CycleMethod; effective_from?: string }) =>
    payrollApi.put<RevisionCycle>(`/payroll/revision-cycles/${id}`, body),
  previewCycle: (id: number) => payrollApi.post<RevisionCycle>(`/payroll/revision-cycles/${id}/preview`, {}),
  submitCycle: (id: number) => payrollApi.post<RevisionCycle>(`/payroll/revision-cycles/${id}/submit`, {}),
  approveCycle: (id: number, remarks?: string) => payrollApi.post<RevisionCycle>(`/payroll/revision-cycles/${id}/approve`, remarks ? { remarks } : {}),
  rejectCycle: (id: number, remarks: string) => payrollApi.post<RevisionCycle>(`/payroll/revision-cycles/${id}/reject`, { remarks }),
  applyCycle: (id: number, idempotencyKey?: string) => payrollApi.post<RevisionCycle>(`/payroll/revision-cycles/${id}/apply`, {}, { idempotencyKey }),

  /* org options (names for ids); these need org:read, so callers degrade to ids on failure */
  legalEntities: () => payrollApi.get<{ id: number; code: string; legal_name: string; base_currency?: string }[]>("/legal-entities"),
  orgDimension: (path: "pay-groups" | "grades" | "employment-types") => payrollApi.get<OrgOption[]>(`/payroll/org/${path}`, { params: { status: "ACTIVE" } }),
  departments: () => payrollApi.get<{ id: number; name: string }[]>("/departments"),
};
