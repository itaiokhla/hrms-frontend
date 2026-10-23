/** Shared fixtures for the documents-area tests (not a test file: jest only runs *.test.tsx). */

import { act } from "@testing-library/react";

import { payrollError } from "@/lib/payroll/api";
import type { PermissionCode, Scope } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";
import { useSession } from "@/store/session";

import type {
  CatalogueReport,
  ComplianceOverview,
  DocumentExport,
  DownloadItem,
  EntityCompliance,
  Liability,
  PayslipDetail,
  PayslipSummary,
  ReportCatalogue,
  ReportExport,
  ReportPreview,
  StaffPayslipQuestion,
  StatutoryReport,
} from "../types";

export function me(permissions: Partial<Record<PermissionCode, Scope[]>>): Me {
  return {
    user: { id: 7, email: "hr@acme.io", full_name: "Hana Rao", mfa_enabled: true, permission_version: 1, last_login_at: null },
    company: { id: 1, name: "Acme", slug: "acme", timezone: "Asia/Kolkata", currency: "INR", subscription: { status: "active", plan: "pro", trial_ends_at: null, active: true } },
    employee: null,
    roles: [],
    permissions,
    is_company_admin: false,
    registry_version: "test",
  } as Me;
}

export function signIn(user: Me) {
  act(() => {
    useSession.setState({ me: user, status: "authenticated" });
  });
}

/** Strip the bidi and narrow-space characters Intl adds, for text assertions. */
export const plain = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/[‎‏؜⁦-⁩]/g, "");

export const conflict = () => payrollError(409, { detail: { message: "The report was changed by someone else; reload it and try again." }, code: "ROW_VERSION_CONFLICT" });
export const notFound = (what = "Payslip") => payrollError(404, { detail: `${what} not found` });
export const serverError = () => payrollError(400, { detail: "Database unavailable" });

export function payslip(overrides: Partial<PayslipSummary> = {}): PayslipSummary {
  return {
    id: 501,
    doc_type: "PAYSLIP_V2",
    number: "PS/ACME/2026-11/0001",
    title: "Payslip November 2026",
    version: 1,
    status: "GENERATED",
    draft: false,
    legal_entity_id: 1,
    employee_id: 42,
    run_id: 9,
    run_employee_id: 77,
    period_start: "2026-11-01",
    period_end: "2026-11-30",
    issue_date: "2026-11-30",
    published_at: null,
    first_viewed_at: null,
    supersedes_document_id: null,
    labels: [],
    languages: ["en"],
    sha256: "a".repeat(64),
    bytes: 2048,
    file_name: "payslip.pdf",
    row_version: 1,
    pay_group_id: 3,
    publish_trigger: null,
    publish_reason: null,
    period_label: "November 2026",
    currency: "INR",
    net: { amount: "82410.50", currency: "INR" },
    payment: "Scheduled",
    employee: { id: 42, name: "Asha Rao", employee_code: "E0042" },
    ...overrides,
  };
}

export function payslipDetail(overrides: Partial<PayslipDetail> = {}, content: Partial<PayslipDetail["content"]> = {}): PayslipDetail {
  return {
    ...payslip({ status: "PUBLISHED", published_at: "2026-11-30T10:00:00Z" }),
    content: {
      kind: "PAYSLIP",
      schema: 1,
      title_key: "PAYSLIP",
      replaces: null,
      version: 1,
      brand: null,
      employer: { legal_name: "Acme India Private Limited", trade_name: "Acme", code: "ACIN", country_code: "IN", address_line: "Bengaluru", registration_lines: [{ label: "PAN", value: "AAACA1234A" }] },
      employee: { id: 42, name: "Asha Rao", code: "E0042", designation: "Engineer", department: "R&D", branch: "Bengaluru", joining_date: "2024-04-01", pay_group: "Monthly", bank: "HDFC ••••4321" },
      period: { start: "2026-11-01", end: "2026-11-30", pay_date: "2026-11-30", label: "November 2026", tax_year: "2026-27" },
      run: { id: 9, number: "RUN-2026-11-001", run_type: "REGULAR" },
      currency: "INR",
      earnings: [
        { code: "BASIC", label: "Basic", amount: "50000.00", rate: null, units: null, period_ref_label: null, statutory: false, fixture: false, ytd: "400000.00" },
        { code: "HRA", label: "House rent allowance", amount: "20000.00", rate: null, units: null, period_ref_label: null, statutory: false, fixture: false, ytd: "160000.00" },
      ],
      deductions: [{ code: "PF_EE", label: "Provident fund", amount: "1800.00", rate: null, units: null, period_ref_label: null, statutory: true, fixture: true, ytd: "14400.00" }],
      reimbursements: [],
      employer_contributions: [{ code: "PF_ER", label: "Employer PF", amount: "1800.00", rate: null, units: null, period_ref_label: null, statutory: true, fixture: true }],
      employer_note: "Paid by your employer — not part of your take-home pay",
      totals: { gross: "84210.50", deductions: "1800.00", reimbursements: "0.00", net: "82410.50", net_words: "Eighty-two thousand four hundred ten rupees and fifty paise" },
      payment: { key: "SCHEDULED", text: "Scheduled", method: null, reference: null },
      attendance: { days_in_period: "30", paid_days: "29.5", lop_days: "0.5", overtime_hours: "7.75", leave_days: "1" },
      leave_balances: [],
      tax_summary: null,
      show_ytd: true,
      labels: ["FIXTURE — not law"],
      languages: ["en"],
      locale: "en-IN",
      template: { layout: "CLASSIC", sections: [], titles: {}, footer_note: "This is a computer-generated payslip.", signature: null, component_groups: [] },
      ...content,
    },
    ...overrides,
  };
}

export function documentExport(overrides: Partial<DocumentExport> = {}): DocumentExport {
  return {
    id: 31,
    kind: "PAYSLIPS_ZIP",
    params: { run_id: 9 },
    status: "READY",
    item_count: 120,
    file_name: "payslips.zip",
    bytes: 2_400_000,
    sha256: "b".repeat(64),
    watermark: "Confidential — exported by hr@acme.io at 2026-11-30 10:00 UTC",
    error: null,
    job_id: 900,
    created_at: "2026-11-30T10:00:00Z",
    ready_at: "2026-11-30T10:01:00Z",
    expires_at: "2026-12-01T10:01:00Z",
    row_version: 2,
    ...overrides,
  };
}

export function reportExport(overrides: Partial<ReportExport> = {}): ReportExport {
  return {
    id: 44,
    report_code: "payroll_register",
    format: "XLSX",
    filters: { period_from: "2026-11-01" },
    status: "GENERATING",
    file_name: null,
    rows: null,
    bytes: null,
    masked: true,
    expires_at: null,
    created_at: "2026-11-30T11:00:00Z",
    error: null,
    ...overrides,
  };
}

export function catalogueReport(overrides: Partial<CatalogueReport> = {}): CatalogueReport {
  return {
    code: "payroll_register",
    name: "Payroll register",
    description: "Every employee of the selected runs with gross, deductions and net.",
    filters: ["period", "legal_entity", "pay_group", "department", "cost_center", "currency", "status"],
    analytics: false,
    available: true,
    unavailable_reason: null,
    exportable: true,
    formats: ["CSV", "XLSX", "PDF"],
    columns: [
      { key: "employee", label: "Employee", type: "text", sensitive: false },
      { key: "net", label: "Net", type: "money", sensitive: false },
    ],
    ...overrides,
  };
}

export function catalogue(): ReportCatalogue {
  return {
    preview_rows: 50,
    groups: [
      { name: "Payroll", reports: [catalogueReport()] },
      { name: "Cost", reports: [catalogueReport({ code: "employer_cost", name: "Employer cost", analytics: true, description: "Employer cost by group." })] },
      { name: "Money out", reports: [catalogueReport({ code: "payment_register", name: "Payment register", available: false, unavailable_reason: "Payments are not available yet." })] },
    ],
  };
}

export function preview(overrides: Partial<ReportPreview> = {}): ReportPreview {
  return {
    report: { code: "payroll_register", name: "Payroll register", group: "Payroll", analytics: false },
    filters: {},
    columns: [
      { key: "employee", label: "Employee", type: "text", sensitive: false },
      { key: "period_end", label: "Period end", type: "date", sensitive: false },
      { key: "net", label: "Net", type: "money", sensitive: false },
    ],
    rows: [
      { employee: "Asha Rao", period_end: "2026-11-30", net: { amount: "82410.50", currency: "INR" } },
      { employee: "Omar Ali", period_end: "2026-11-30", net: { amount: "4100.250", currency: "KWD" } },
    ],
    row_count: 120,
    truncated: true,
    totals: { INR: { net: "82410.50" }, KWD: { net: "4100.250" } },
    converted: null,
    suppressed_groups: 0,
    notes: [],
    watermark: null,
    ...overrides,
  };
}

export function statutoryReport(overrides: Partial<StatutoryReport> = {}): StatutoryReport {
  return {
    id: 61,
    legal_entity_id: 1,
    pack_code: "IN",
    pack_version: "2026.09.17",
    report_code: "PF_ECR",
    report_name: "PF electronic challan cum return",
    frequency: "MONTHLY",
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    due_date: "2026-11-15",
    status: "READY_TO_FILE",
    version: 1,
    amends_report_id: null,
    is_fixture: true,
    watermark: "FIXTURE — not law",
    row_count: 120,
    content_hash: "c".repeat(64),
    generated_at: "2026-11-02T10:00:00Z",
    verified_at: "2026-11-03T10:00:00Z",
    exported_at: "2026-11-04T10:00:00Z",
    export_sha256: "d".repeat(64),
    filing_ref: null,
    submitted_at: null,
    acknowledgement_ref: null,
    acknowledged_at: null,
    authority_response: null,
    rejected_at: null,
    amended_at: null,
    status_reason: null,
    row_version: 4,
    available_actions: ["MARK_SUBMITTED", "REGENERATE"],
    lifecycle_note: "Exporting a file makes the report ready to file; it is filed only when you record the filing reference.",
    ...overrides,
  };
}

export function liability(overrides: Partial<Liability> = {}): Liability {
  return {
    id: 81,
    run_id: 9,
    run_number: "RUN-2026-10-001",
    run_status: "FINALIZED",
    legal_entity_id: 1,
    scheme: "PF",
    payee: "EPFO",
    employee_amount: { amount: "216000.00", currency: "INR" },
    employer_amount: { amount: "216000.00", currency: "INR" },
    total: { amount: "432000.00", currency: "INR" },
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    pay_date: "2026-10-31",
    due_date: "2026-11-15",
    status: "OPEN",
    remittance_ref: null,
    remitted_on: null,
    overdue: true,
    fixture: true,
    watermark: "FIXTURE — not law",
    row_version: 1,
    ...overrides,
  };
}

export function entity(overrides: Partial<EntityCompliance> = {}): EntityCompliance {
  return {
    legal_entity: { id: 1, code: "ACIN", legal_name: "Acme India Private Limited", status: "ACTIVE", base_currency: "INR", country_confirmed: true },
    country: { code: "IN", name: "India" },
    capability: {
      level: "CALC_SUPPORTED",
      label: "Calculation supported",
      kind: "FIXTURE",
      tone: "warning",
      note: "FIXTURE — not law: statutory lines use test data.",
      from_packs: "CALC_SUPPORTED",
      recorded: null,
      recorded_note: null,
      environment: "TEST",
    },
    active_pack: {
      code: "IN",
      version: "2026.09.17",
      status: "UNDER_REVIEW",
      effective_from: "2026-04-01",
      effective_to: null,
      usage: "FIXTURE",
      usage_message: "Fixture pack: test data only.",
      is_fixture: true,
      reviewer: "R. Mehta",
      reviewed_on: "2026-09-17",
      next_review_due: "2027-03-31",
      watermark: "FIXTURE — not law",
    },
    pack_versions: [],
    attestation: { required: false, status: "NOT_REQUIRED", active: null, pending: null, message: null, blocks_finalization: false },
    registrations: [{ label: "PF establishment", value: "BGBNG0012345000" }],
    liabilities: {
      per_currency: { INR: { open: "432000.00", remitted: "0.00", reconciled: "0.00", overdue: "432000.00", overdue_count: 1, count: 1 } },
      open_count: 1,
      overdue_count: 1,
      next_due_date: "2026-12-15",
    },
    report_definitions: [{ code: "PF_ECR", name: "PF electronic challan cum return", frequency: "MONTHLY", due_rule: "15th of next month", note: null }],
    statutory_reports: [statutoryReport()],
    due_calendar: {
      available: true,
      reason: null,
      pack_version: "2026.09.17",
      watermark: "FIXTURE — not law",
      items: [
        { kind: "REPORT", report_code: "PF_ECR", name: "PF electronic challan cum return", report_id: null, period_start: "2026-11-01", period_end: "2026-11-30", due_date: "2026-12-15", rule: "15th of next month", status: "NOT_STARTED", overdue: false },
      ],
    },
    ...overrides,
  };
}

export function overview(entities: EntityCompliance[] = [entity()]): ComplianceOverview {
  return { as_of: "2026-11-20", environment: "TEST", entities };
}

/** One row of GET /payroll/downloads/mine (services/downloads.py `_center_*_item`). */
export function downloadItem(overrides: Partial<DownloadItem> = {}): DownloadItem {
  return {
    source: "EXPORT",
    id: 31,
    kind: "PAYSLIPS_ZIP",
    title: "Payslips (ZIP)",
    format: "ZIP",
    run_id: 9,
    report_code: null,
    status: "READY",
    file_name: "payslips.zip",
    bytes: 2_400_000,
    items: 120,
    error: null,
    created_at: "2026-11-30T10:00:00Z",
    expires_at: "2026-12-01T10:01:00Z",
    link_endpoint: "/api/v1/payroll/exports/31/download",
    download: { url: "/api/v1/payroll/downloads/tok-31", expires_at: new Date(Date.now() + 300_000).toISOString(), expires_in_seconds: 300 },
    ...overrides,
  };
}

/** One question in the HR inbox (services/payslip_queries.py `query_json(as_staff=True)`). */
export function staffQuestion(overrides: Partial<StaffPayslipQuestion> = {}): StaffPayslipQuestion {
  return {
    id: 71,
    document_id: 501,
    payslip: { id: 501, number: "PS-2026-11-0042", version: 1, period_label: "November 2026", period_start: "2026-11-01", period_end: "2026-11-30" },
    question: "Why is my HRA lower than last month?",
    status: "OPEN",
    answer: null,
    answered_at: null,
    closed_at: null,
    created_at: "2026-12-01T09:00:00Z",
    row_version: 1,
    employee_id: 42,
    employee: { id: 42, name: "Asha Rao", employee_code: "E0042" },
    run_id: 9,
    run_employee_id: 77,
    legal_entity_id: 1,
    pay_group_id: 3,
    asked_by_user_id: 90,
    answered_by_user_id: null,
    closed_by_user_id: null,
    ...overrides,
  };
}
