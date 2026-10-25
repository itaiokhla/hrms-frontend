/**
 * Response shapes of /api/v1/payroll/legal-holds (hrms-backend/app/payroll/routes/legal_holds.py,
 * services/legal_holds.py). Counts only: no response carries employee pay or file paths.
 */

export const HOLD_SCOPES = ["EMPLOYEE", "LEGAL_ENTITY", "DOCUMENT_TYPE", "DOCUMENT"] as const;
export type HoldScope = (typeof HOLD_SCOPES)[number];
export type HoldStatus = "ACTIVE" | "RELEASED";

export const SCOPE_LABEL: Record<HoldScope, string> = {
  EMPLOYEE: "Employee",
  LEGAL_ENTITY: "Legal entity",
  DOCUMENT_TYPE: "Document type",
  DOCUMENT: "One document",
};

export const SCOPE_HELP: Record<HoldScope, string> = {
  EMPLOYEE: "The employee's payslips and the registers of runs that include them.",
  LEGAL_ENTITY: "Every payroll document of the legal entity.",
  DOCUMENT_TYPE: "Every document of one type, in the whole company.",
  DOCUMENT: "A single document.",
};

/** Document types a hold or the retention sweep can concern (the backend's DOC_TYPES), with plain labels. */
export const DOC_TYPE_LABEL: Record<string, string> = {
  PAYSLIP_V2: "Payslip",
  REVERSAL_STATEMENT: "Reversal statement",
  PAYMENT_ADVICE: "Payment advice",
  INVOICE: "Invoice",
  SELF_BILLED_INVOICE: "Self-billed invoice",
  CREDIT_NOTE: "Credit note",
  PAYROLL_REGISTER: "Payroll register",
  BANK_TRANSFER_REPORT: "Bank transfer report",
  FUNDING_REQUEST: "Funding request",
  FINAL_SETTLEMENT_STATEMENT: "Final settlement statement",
  SALARY_CERTIFICATE: "Salary certificate",
  EMPLOYMENT_LETTER: "Employment letter",
  INCREMENT_LETTER: "Increment letter",
  LOAN_STATEMENT: "Loan statement",
  REIMBURSEMENT_STATEMENT: "Reimbursement statement",
};

export interface LegalHold {
  id: number;
  scope: HoldScope;
  employee_id: number | null;
  legal_entity_id: number | null;
  doc_type: string | null;
  document_id: number | null;
  reference: string | null;
  reason: string;
  status: HoldStatus;
  created_by_user_id: number;
  created_at: string | null;
  released_by_user_id: number | null;
  released_at: string | null;
  release_reason: string | null;
  row_version: number;
  /** Present on reads of ACTIVE holds and right after creation. */
  documents_covered?: number;
}

export interface HoldPage {
  total: number;
  items: LegalHold[];
}

export interface SweepCounts {
  as_of: string | null;
  trigger: "JOB" | "MANUAL" | "ERASURE" | null;
  due: number | null;
  held: number | null;
  redacted: number | null;
  remaining: number | null;
  not_due: number | null;
  no_retention_date: number | null;
  more: boolean | null;
}

export interface SweepRow extends SweepCounts {
  at: string | null;
  action: string;
}

export interface HoldSummary {
  active_holds: number;
  released_holds: number;
  documents_under_hold: number;
  documents_due: number;
  documents_due_held: number;
  documents_due_deletable: number;
  documents_redacted: number;
  as_of: string;
  sweep_types: string[];
  sweep_limit: number;
  last_sweep: SweepRow | null;
}

export interface HoldInput {
  scope: HoldScope;
  employee_id?: number;
  legal_entity_id?: number;
  doc_type?: string;
  document_id?: number;
  reason: string;
  reference?: string;
}

export interface ErasureResult {
  employee_id: number;
  redacted: number;
  kept_until_retention_ends: number;
  more: boolean;
}
