/**
 * Response shapes of the payslip, document, download-center, report and compliance endpoints
 * (hrms-backend/app/payroll/routes/{payslips,documents,reports,compliance}.py and their services).
 * Amounts are always `{amount: "<decimal string>", currency}`: never JSON numbers.
 */

import type { Money } from "@/lib/money";

export interface ListPage<T> {
  total: number;
  items: T[];
}

/* ------------------------------------------------------------------ payslips (documents.document_json + _summary) */

export const PAYSLIP_STATUSES = ["GENERATED", "PUBLISHED", "VIEWED", "EMAIL_SENT", "EMAIL_FAILED", "SUPERSEDED", "REVERSED"] as const;
export type PayslipStatus = (typeof PAYSLIP_STATUSES)[number];

/** The statuses HR filters by (3.8 §5.14); EMAIL_SENT is a published state too. */
export const PAYSLIP_FILTER_STATUSES: PayslipStatus[] = ["GENERATED", "PUBLISHED", "VIEWED", "EMAIL_FAILED", "SUPERSEDED", "REVERSED"];

/** Statuses a resend is offered for (publication.PUBLISHED_STATES). */
export const PUBLISHED_STATES: string[] = ["PUBLISHED", "EMAIL_SENT", "EMAIL_FAILED", "VIEWED"];

export interface EmployeeBrief {
  id: number;
  name: string;
  employee_code: string | null;
}

export interface PayslipSummary {
  id: number;
  doc_type: string;
  number: string | null;
  title: string | null;
  version: number;
  status: PayslipStatus | string;
  draft: boolean;
  legal_entity_id: number | null;
  employee_id: number | null;
  run_id: number | null;
  run_employee_id: number | null;
  period_start: string | null;
  period_end: string | null;
  issue_date: string;
  published_at: string | null;
  first_viewed_at: string | null;
  supersedes_document_id: number | null;
  labels: string[];
  languages: string[];
  sha256: string;
  bytes: number;
  file_name: string;
  row_version: number;
  /* staff-only fields */
  pay_group_id?: number | null;
  publish_trigger?: string | null;
  publish_reason?: string | null;
  template_version?: string | null;
  superseded_at?: string | null;
  reversed_at?: string | null;
  /* _summary */
  period_label: string | null;
  currency: string | null;
  net: Money | null;
  payment: string | null;
  employee?: EmployeeBrief | null;
}

export interface PayslipLineItem {
  code: string;
  label: string;
  amount: string;
  rate: string | null;
  units: string | null;
  period_ref_label: string | null;
  statutory: boolean;
  fixture: boolean;
  ytd?: string | null;
  /**
   * The engine's plain-language explanation frozen on the payslip (employee-visible lines only; absent on
   * payslips generated before explanations were added). The trace itself needs payroll:run:read.
   */
  explanation?: string | null;
}

export interface PayslipContent {
  kind: "PAYSLIP" | string;
  schema: number;
  title_key: "PAYSLIP" | "REVISED_PAYSLIP" | string;
  replaces: string | null;
  version: number;
  brand?: { name?: string | null; logo_url?: string | null; [k: string]: unknown } | null;
  employer: {
    legal_name: string;
    trade_name: string | null;
    code: string | null;
    country_code: string | null;
    address_line: string | null;
    registration_lines: { label: string; value: string }[];
  };
  employee: {
    id: number;
    name: string;
    code: string | null;
    designation: string | null;
    department: string | null;
    branch: string | null;
    joining_date: string | null;
    pay_group: string | null;
    bank?: string | null;
  };
  period: { start: string; end: string; pay_date: string; label: string; tax_year: string | null };
  run: { id: number; number: string; run_type: string };
  currency: string;
  earnings: PayslipLineItem[];
  deductions: PayslipLineItem[];
  reimbursements: PayslipLineItem[];
  employer_contributions: PayslipLineItem[];
  employer_note: string;
  totals: { gross: string; deductions: string; reimbursements: string; net: string; net_words: string | null };
  payment: { key: string; text: string; method: string | null; reference: string | null; sandbox?: boolean };
  attendance: {
    days_in_period: string | null;
    paid_days: string | null;
    lop_days: string | null;
    overtime_hours: string | null;
    leave_days: string | null;
  } | null;
  leave_balances: { code: string; name: string; used: string; remaining: string | null }[];
  tax_summary: unknown;
  show_ytd: boolean;
  labels: string[];
  languages: string[];
  locale: string;
  template: {
    layout: string;
    sections: string[];
    titles: Record<string, string>;
    footer_note: string | null;
    signature: { name?: string | null; title?: string | null } | null;
    component_groups: unknown[];
  };
  verify_base?: string | null;
}

export interface PayslipDetail extends PayslipSummary {
  content: PayslipContent;
}

export interface SignedLink {
  url: string;
  expires_at: string;
  expires_in_seconds: number;
}

export interface BulkPublishResult {
  published: number[];
  skipped: number[];
}

export interface RunPublishResult {
  run_id: number;
  published: number;
  waiting: number;
  trigger?: string;
  published_manually: number;
}

export interface GenerationStatus {
  run_id: number;
  total: number;
  counts: { QUEUED: number; GENERATED: number; FAILED: number };
  failed: { task_id: number; run_employee_id: number; employee: EmployeeBrief | null; attempts: number; retries: number; error: string | null }[];
  published: number;
}

/* ------------------------------------------------------------------ download center */

export const EXPORT_STATUSES = ["QUEUED", "GENERATING", "READY", "FAILED", "EXPIRED"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/** `downloads.export_json` (GET /payroll/exports). */
export interface DocumentExport {
  id: number;
  kind: "PAYSLIPS_ZIP" | "REGISTER_CSV" | "REGISTER_XLSX" | string;
  params: { run_id?: number };
  status: ExportStatus | string;
  item_count: number | null;
  file_name: string | null;
  bytes: number | null;
  sha256: string | null;
  watermark: string | null;
  error: string | null;
  job_id: number | null;
  created_at: string | null;
  ready_at: string | null;
  expires_at: string | null;
  row_version: number;
}

/** `reports.export_json` (GET /payroll/report-exports). */
export interface ReportExport {
  id: number;
  report_code: string | null;
  format: "CSV" | "XLSX" | "PDF" | string | null;
  filters: Record<string, unknown>;
  status: ExportStatus | string;
  file_name: string | null;
  rows: number | null;
  bytes: number | null;
  masked: boolean | null;
  expires_at: string | null;
  created_at: string | null;
  error: string | null;
}

/* ------------------------------------------------------------------ reports */

export interface ReportColumn {
  key: string;
  label: string;
  type: "text" | "int" | "decimal" | "money" | "date" | "datetime" | "bool" | string;
  sensitive: boolean;
}

export interface CatalogueReport {
  code: string;
  name: string;
  description: string;
  filters: string[];
  analytics: boolean;
  available: boolean;
  unavailable_reason: string | null;
  exportable: boolean;
  formats: string[];
  columns: ReportColumn[];
}

export interface ReportCatalogue {
  groups: { name: string; reports: CatalogueReport[] }[];
  preview_rows: number;
}

export interface ConvertedTotal {
  currency: string;
  available: boolean;
  date: string;
  message?: string;
  issues?: { currency: string; code: string; message: string }[];
  totals?: Record<string, Money>;
  label?: string | null;
  rates?: { base: string; quote: string; rate: string; source: string; as_of: string }[];
}

export interface ReportPreview {
  report: { code: string; name: string; group: string; analytics: boolean };
  filters: Record<string, unknown>;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  row_count: number;
  truncated: boolean;
  totals: Record<string, Record<string, string>>;
  converted: ConvertedTotal | null;
  suppressed_groups: number;
  notes: string[];
  watermark: string | null;
}

export interface ReportFilters {
  period_from?: string;
  period_to?: string;
  legal_entity_id?: number;
  pay_group_id?: number;
  department_id?: number;
  cost_center_id?: number;
  branch_id?: number;
  currency?: string;
  status?: string;
  group_by?: string;
  convert_to?: string;
  fx_date?: string;
  tax_year?: string;
}

/* ------------------------------------------------------------------ compliance */

export interface CapabilityBadge {
  level: string;
  label: string;
  kind: "PRODUCTION" | "FIXTURE" | "UNSUPPORTED" | "NOT_VERIFIED" | string;
  tone: "success" | "warning" | "danger" | string;
  note: string;
  from_packs: string;
  recorded: string | null;
  recorded_note: string | null;
  environment: string;
}

export interface PackVersion {
  code: string;
  version: string;
  name: string;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
  covers_today: boolean;
  usage: string;
  usage_message: string | null;
  is_fixture: boolean;
  capability: string;
  reviewer: string | null;
  reviewed_on: string | null;
  next_review_due: string | null;
  watermark: string | null;
  defines_reports: boolean;
}

export interface Attestation {
  required: boolean;
  status: "ACTIVE" | "PENDING_APPROVAL" | "MISSING" | "NOT_REQUIRED" | string;
  active: AttestationBrief | null;
  pending: AttestationBrief | null;
  message: string | null;
  blocks_finalization: boolean;
}

export interface AttestationBrief {
  id: number;
  status: string;
  schemes: string[];
  effective_from: string;
  effective_to: string | null;
  attested_by_user_id: number | null;
  approved_by_user_id: number | null;
  approved_at: string | null;
}

export interface StatutoryReport {
  id: number;
  legal_entity_id: number;
  pack_code: string;
  pack_version: string;
  report_code: string;
  report_name: string;
  frequency: string;
  period_start: string;
  period_end: string;
  due_date: string | null;
  status: string;
  version: number;
  amends_report_id: number | null;
  is_fixture: boolean;
  watermark: string | null;
  row_count: number | null;
  content_hash: string | null;
  generated_at: string | null;
  verified_at: string | null;
  exported_at: string | null;
  export_sha256: string | null;
  filing_ref: string | null;
  submitted_at: string | null;
  acknowledgement_ref: string | null;
  acknowledged_at: string | null;
  authority_response: string | null;
  rejected_at: string | null;
  amended_at: string | null;
  status_reason: string | null;
  row_version: number;
  available_actions: string[];
  lifecycle_note: string;
  /* detail only */
  content?: unknown;
  totals?: Record<string, unknown> | null;
  run_ids?: number[] | null;
  amended_by_report_id?: number | null;
}

export interface LiabilitySummary {
  per_currency: Record<string, { open: string; remitted: string; reconciled: string; overdue: string; overdue_count: number; count: number }>;
  open_count: number;
  overdue_count: number;
  next_due_date: string | null;
}

export interface DueItem {
  kind: "CONTRIBUTION" | "REPORT";
  scheme?: string;
  payee?: string;
  components?: string[];
  report_code?: string;
  name?: string;
  report_id?: number | null;
  period_start: string;
  period_end: string;
  due_date: string;
  rule: string;
  status: string;
  overdue: boolean;
}

export interface EntityCompliance {
  legal_entity: { id: number; code: string; legal_name: string; status: string; base_currency: string; country_confirmed: boolean };
  country: { code: string; name: string };
  capability: CapabilityBadge;
  active_pack: (Omit<PackVersion, "name" | "covers_today" | "capability" | "defines_reports">) | null;
  pack_versions: PackVersion[];
  attestation: Attestation;
  registrations: { label: string; value: string }[];
  liabilities: LiabilitySummary;
  report_definitions: { code: string; name: string; frequency: string; due_rule: string | null; note: string | null }[];
  statutory_reports: StatutoryReport[];
  due_calendar: { available: boolean; reason: string | null; items: DueItem[]; pack_version?: string; watermark: string | null };
}

export interface ComplianceOverview {
  as_of: string;
  environment: string;
  entities: EntityCompliance[];
}

export interface Liability {
  id: number;
  run_id: number;
  run_number: string;
  run_status: string;
  legal_entity_id: number;
  scheme: string;
  payee: string | null;
  employee_amount: Money;
  employer_amount: Money;
  total: Money;
  period_start: string;
  period_end: string;
  pay_date: string;
  due_date: string | null;
  status: "OPEN" | "REMITTED" | "RECONCILED" | string;
  remittance_ref: string | null;
  remitted_on: string | null;
  overdue: boolean;
  fixture: boolean;
  watermark: string | null;
  row_version: number;
}

export interface LiabilityPage extends ListPage<Liability> {
  totals: Record<string, Record<string, string>>;
}

export interface TransitionResult {
  id: number;
  status: string;
  version?: number;
  row_version: number;
  amendment?: { id: number; status: string; version: number; amends_report_id: number; row_version: number };
}

/* ------------------------------------------------------------------ lookups */

export interface Option {
  id: number;
  name: string;
  legal_entity_id?: number | null;
}

export interface RunOption {
  id: number;
  number: string;
  label: string | null;
  status: string;
  legal_entity_id: number;
  run_type: string;
  pay_group: { id: number; code: string; name: string };
  period: { start: string; end: string; pay_date: string } | null;
}

/* ------------------------------------------------------------------ payslip questions (staff) */

export const PAYSLIP_QUESTION_STATUSES = ["OPEN", "ANSWERED", "CLOSED"] as const;

/** services/payslip_queries.py `query_json(as_staff=True)`. */
export interface StaffPayslipQuestion {
  id: number;
  document_id: number;
  payslip: { id: number; number: string | null; version: number; period_label: string | null; period_start: string | null; period_end: string | null } | null;
  question: string;
  status: "OPEN" | "ANSWERED" | "CLOSED" | string;
  answer: string | null;
  answered_at: string | null;
  closed_at: string | null;
  created_at: string | null;
  row_version: number;
  employee_id: number;
  employee: EmployeeBrief | null;
  run_id: number | null;
  run_employee_id: number | null;
  legal_entity_id: number;
  pay_group_id: number | null;
  asked_by_user_id: number | null;
  answered_by_user_id: number | null;
  closed_by_user_id: number | null;
}

/* ------------------------------------------------------------------ unified download center */

/** services/downloads.py `_center_export_item` / `_center_report_item`. */
export interface DownloadItem {
  source: "EXPORT" | "REPORT_EXPORT";
  id: number;
  kind: string;
  title: string;
  format: string | null;
  run_id: number | null;
  report_code: string | null;
  status: ExportStatus | string;
  file_name: string | null;
  bytes: number | null;
  /** Payslips in a ZIP, rows in a register or report. */
  items: number | null;
  error: string | null;
  created_at: string | null;
  expires_at: string | null;
  /** POST here (with /api/v1) for a fresh signed link when `download` has expired. */
  link_endpoint: string;
  /** A signed, user-bound five-minute link for a READY file the caller may download; null otherwise. */
  download: SignedLink | null;
}

export interface DownloadPage {
  total: number;
  skip: number;
  limit: number;
  items: DownloadItem[];
}
