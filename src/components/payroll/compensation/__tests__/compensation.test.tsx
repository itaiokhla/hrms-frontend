import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import AssignSalaryPage from "@/app/(app)/payroll/compensation/page";
import EmployeeCompensationPage from "@/app/(app)/payroll/compensation/[employeeId]/page";
import { __resetHideAmounts } from "@/components/payroll/useHideAmounts";
import { PayrollApiError } from "@/lib/payroll/api";

import { compensationApi } from "../api";
import { BulkImport } from "../BulkImport";
import type { Assignment, Breakdown, CompensationList, EmployeeCompensation, SalaryStructure } from "../types";
import { APPROVER, EDITOR, READER, money, nav, resetNav, signIn } from "./helpers";

jest.mock("next/navigation", () => require("./helpers").navigationMock());
jest.mock("@/components/shared/EmployeePicker", () => require("./helpers").employeePickerMock());
jest.mock("@/components/payroll/JobProgress", () => ({
  JobProgress: ({ jobId, onFinished }: { jobId: number; onFinished?: (job: unknown) => void }) => (
    <button type="button" onClick={() => onFinished?.({ id: jobId, status: "SUCCEEDED" })}>
      Job {jobId} running
    </button>
  ),
}));
jest.mock("../api", () => {
  const actual = jest.requireActual("../api");
  const mocked = Object.fromEntries(Object.entries(actual.compensationApi).map(([k, v]) => [k, typeof v === "function" ? jest.fn() : v]));
  return { ...actual, compensationApi: mocked };
});

const api = compensationApi as unknown as Record<string, jest.Mock>;

function assignment(over: Partial<Assignment> = {}): Assignment {
  return {
    id: 5, employee_id: 42, assignment_id: 9, structure: { id: 7, code: "IN_STAFF", name: "India Staff CTC", type: "CTC_BASED", version: 2, version_id: 102, version_status: "ACTIVE" },
    pay_basis_amount: money("1200000.00"), currency: "INR", fx_rule: null, effective_from: "2026-04-01", effective_to: null, reason: "HIRE", status: "ACTIVE", note: null,
    split_period: false, previous_assignment_id: null, revision_cycle_id: null, legacy_salary_structure_id: null, row_version: 1, created_by_user_id: 9,
    approved_by_user_id: 8, approved_at: "2026-03-20T10:00:00Z", created_at: "2026-03-19T10:00:00Z", ...over,
  };
}

const LIST: CompensationList = {
  filter: "with",
  counts: { with: 409, without: 3, scheduled: 5, pending: 2, draft: 0 },
  total: 1,
  items: [{ employee: { id: 42, employee_code: "E042", name: "Asha Rao" }, legal_entity: { id: 1, code: "ACME_IN", name: "Acme India" }, pay_group: { id: 3, code: "MONTHLY", name: "Monthly staff", currency: "INR" }, compensation: assignment() }],
};

const BREAKDOWN: Breakdown = {
  currency: "INR", periods_per_year: 12,
  lines: [{ component: "BASIC", kind: "EARNING", method: "FORMULA", monthly: money("50000.00"), annual: money("600000.00"), explanation: "Half of the CTC" }],
  totals: { ctc: { monthly: money("100000.00"), annual: money("1200000.00") } },
  statutory: { lines: [], verified: false, label: "Compliance not verified", note: "" },
  issues: [], ok: true,
};

const STRUCTURE: SalaryStructure = {
  id: 7, code: "IN_STAFF", name: "India Staff CTC", description: null, type: "CTC_BASED", currency: "INR", status: "ACTIVE", active_version: 2, draft_version: null, eligibility: {}, assignment_counts: {},
  versions: [{ id: 102, version: 2, status: "ACTIVE", eligibility: {}, test_range: null, test_vectors: [], validation: null, effective_from: "2026-01-01", row_version: 1, created_by_user_id: 1, published_by_user_id: 1, published_at: null, created_at: "", lines: [{ component: "SPECIAL", method: "FIXED", value: "1000", formula: null, params: {}, overridable: true, override_min: "0", override_max: "5000", display_order: 0 }] }],
};

beforeEach(() => {
  Object.values(api).forEach((fn) => typeof fn === "function" && "mockReset" in fn && fn.mockReset().mockResolvedValue(undefined));
  window.localStorage.clear();
  __resetHideAmounts();
});

describe("Assign salary list", () => {
  it("shows the segment counts and money from string amounts, and hides it with Hide amounts", async () => {
    resetNav("/payroll/compensation");
    signIn(EDITOR);
    api.listCompensation.mockResolvedValue(LIST);
    render(<AssignSalaryPage />);
    // Generous wait: the full jest run is slow on this machine; the assertion itself is unchanged.
    expect(await screen.findByRole("radio", { name: /Without salary\s*3/ }, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /With salary\s*409/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Pending approval\s*2/ })).toBeInTheDocument();
    expect(screen.getAllByText("₹1,200,000.00").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Hide amounts/ }));
    await waitFor(() => expect(document.querySelector("[data-masked]")).not.toBeNull());
    expect(screen.getAllByText("Amount hidden. Focus to reveal.").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("radio", { name: /Without salary/ }));
    await waitFor(() => expect(api.listCompensation).toHaveBeenLastCalledWith(expect.objectContaining({ filter: "without", offset: 0 })));
  });

  it("hides Assign and Bulk assign from a reader", async () => {
    resetNav("/payroll/compensation");
    signIn(READER);
    api.listCompensation.mockResolvedValue(LIST);
    render(<AssignSalaryPage />);
    await screen.findAllByText("Asha Rao");
    expect(screen.queryByRole("button", { name: /Assign salary/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bulk assign/ })).not.toBeInTheDocument();
  });

  it("opens Assign salary from its deep link, previews the breakdown and submits for approval", async () => {
    resetNav("/payroll/compensation", "modal=assign-salary&employee=42");
    signIn(EDITOR);
    api.listCompensation.mockResolvedValue(LIST);
    api.employeeCompensation.mockResolvedValue({ employee: { id: 42, employee_code: "E042", name: "Asha Rao" }, current: null, breakdown: null, scheduled: [], pending: [], history: [], without_salary: true, self_service: false, pay_group: { id: 3, code: "M", name: "Monthly", currency: "INR" } } satisfies EmployeeCompensation);
    api.listStructures.mockResolvedValue([STRUCTURE]);
    api.getStructure.mockResolvedValue(STRUCTURE);
    api.previewChange.mockResolvedValue({ assignment_id: null, employee_id: 42, structure_before: null, structure_after: STRUCTURE.versions![0], pay_basis: { before: null, after: money("1200000.00"), change_pct: null }, lines: [], before: null, after: BREAKDOWN, grade_range: { status: "IN_RANGE", grade: { id: 1, code: "G3", name: "G3" }, range: { min: "900000", max: "1500000", currency: "INR" }, position_pct: "50.0" } });
    api.assign.mockResolvedValue(assignment({ status: "PENDING_APPROVAL" }));
    render(<AssignSalaryPage />);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Asha Rao · E042/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("combobox", { name: /^Structure/ }), { target: { value: "7" } });
    fireEvent.change(await within(dialog).findByLabelText(/^SPECIAL/), { target: { value: "9000" } });
    fireEvent.change(within(dialog).getByLabelText(/^Annual CTC/), { target: { value: "1200000" } });
    expect(await within(dialog).findByText("At most 5000.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^SPECIAL/), { target: { value: "2000" } });
    await waitFor(() => expect(api.previewChange).toHaveBeenCalledWith(42, expect.objectContaining({ pay_basis_amount: money("1200000.00"), template_version_id: 102, overrides: { SPECIAL: { amount: "2000" } } }), expect.anything()), { timeout: 3000 });
    expect(await within(dialog).findByText("In range")).toBeInTheDocument();
    expect(within(dialog).getByText("₹50,000.00")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Submit for approval" }));
    });
    expect(api.assign).toHaveBeenCalledWith(42, expect.objectContaining({ template_version_id: 102, pay_basis_amount: money("1200000.00"), reason: "HIRE", submit: true, overrides: { SPECIAL: { amount: "2000" } } }), expect.any(String));
  });

  it("shows the minimum pay basis when the balancing line would be negative", async () => {
    resetNav("/payroll/compensation", "modal=assign-salary&employee=42");
    signIn(EDITOR);
    api.listCompensation.mockResolvedValue(LIST);
    api.employeeCompensation.mockResolvedValue({ employee: { id: 42, employee_code: "E042", name: "Asha Rao" }, current: null, breakdown: null, scheduled: [], pending: [], history: [], without_salary: true, self_service: false });
    api.listStructures.mockResolvedValue([STRUCTURE]);
    api.getStructure.mockResolvedValue(STRUCTURE);
    api.previewChange.mockResolvedValue({ assignment_id: null, employee_id: 42, structure_before: null, structure_after: {}, pay_basis: { before: null, after: money("100.00"), change_pct: null }, lines: [], before: null, after: BREAKDOWN, grade_range: { status: "NO_RANGE", grade: null, range: null, position_pct: null } });
    api.assign.mockRejectedValue(new PayrollApiError(400, "The balancing component would be negative: the minimum for this structure is 420000.00 INR.", "BALANCING_NEGATIVE", undefined, { message: "x", minimum_pay_basis: money("420000.00") }));
    render(<AssignSalaryPage />);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/Asha Rao · E042/);
    fireEvent.change(within(dialog).getByRole("combobox", { name: /^Structure/ }), { target: { value: "7" } });
    await within(dialog).findByLabelText(/^SPECIAL/);
    fireEvent.change(within(dialog).getByLabelText(/^Annual CTC/), { target: { value: "100" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Submit for approval" }));
    });
    expect((await within(dialog).findAllByText(/minimum for this structure is 420000.00 INR/)).length).toBeGreaterThan(0);
  });
});

describe("Employee compensation page", () => {
  const data: EmployeeCompensation = {
    employee: { id: 42, employee_code: "E042", name: "Asha Rao" },
    legal_entity: { id: 1, code: "ACME_IN", name: "Acme India" },
    pay_group: { id: 3, code: "M", name: "Monthly staff", currency: "INR" },
    current: assignment(),
    breakdown: BREAKDOWN,
    scheduled: [],
    pending: [assignment({ id: 6, status: "PENDING_APPROVAL", reason: "REVISION", pay_basis_amount: money("1320000.00"), effective_from: "2026-11-01", created_by_user_id: 9 })],
    history: [assignment({ id: 6, status: "PENDING_APPROVAL", reason: "REVISION", pay_basis_amount: money("1320000.00"), change: { from_assignment_id: 5, pay_basis_before: money("1200000.00"), change_pct: "10.00" } }), assignment()],
    without_salary: false,
    self_service: false,
    grade_range: { status: "IN_RANGE", grade: { id: 1, code: "G3", name: "G3" }, range: { min: "900000", max: "1500000", currency: "INR" }, position_pct: "50.0" },
  };

  it("shows the package, breakdown, history with the change, and lets an approver decide", async () => {
    resetNav("/payroll/compensation/42", "", { employeeId: "42" });
    signIn(APPROVER, 1);
    api.employeeCompensation.mockResolvedValue(data);
    api.approveAssignment.mockResolvedValue(assignment({ id: 6, status: "SCHEDULED" }));
    render(<EmployeeCompensationPage />);
    expect(await screen.findByRole("heading", { name: "Asha Rao", level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText("₹1,200,000.00").length).toBeGreaterThan(0);
    expect(screen.getByText("▲ 10.0%")).toBeInTheDocument();
    expect(screen.getByText("Grade G3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Revise salary/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    const dialog = await screen.findByRole("dialog", { name: "Approve this salary?" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    });
    expect(api.approveAssignment).toHaveBeenCalledWith(6, undefined);
  });

  it("doesn't let the maker approve their own change", async () => {
    resetNav("/payroll/compensation/42", "", { employeeId: "42" });
    signIn({ ...EDITOR, ...APPROVER }, 9);
    api.employeeCompensation.mockResolvedValue(data);
    render(<EmployeeCompensationPage />);
    expect(await screen.findByText(/You proposed this change/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve$/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Revise salary/ })).toBeDisabled();
  });

  it("shows someone outside the viewer's scope as not found", async () => {
    resetNav("/payroll/compensation/99", "", { employeeId: "99" });
    signIn(READER);
    api.employeeCompensation.mockRejectedValue(new PayrollApiError(404, "Employee not found", undefined, undefined, "Employee not found"));
    render(<EmployeeCompensationPage />);
    expect(await screen.findByText("Employee not found")).toBeInTheDocument();
  });

  it("explains that an employee without salary is excluded, never paid zero", async () => {
    resetNav("/payroll/compensation/42", "", { employeeId: "42" });
    signIn(EDITOR);
    api.employeeCompensation.mockResolvedValue({ ...data, current: null, breakdown: null, pending: [], history: [], without_salary: true, grade_range: undefined });
    render(<EmployeeCompensationPage />);
    expect(await screen.findByText("No salary in force")).toBeInTheDocument();
    expect(screen.getByText(/never paid zero/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Assign salary/ })[0]);
    expect(nav.push).toHaveBeenCalledWith("/payroll/compensation/42?modal=assign-salary&employee=42");
  });
});

describe("Bulk assign (CSV)", () => {
  it("runs template → upload and dry run with per-row errors → commit job", async () => {
    signIn(EDITOR);
    api.importDryRun.mockResolvedValue({
      import_id: 11,
      summary: { rows: 2, valid: 1, invalid: 1 },
      rows: [
        { row: 2, employee_code: "E042", ok: true, errors: [], warnings: [], values: {} },
        { row: 3, employee_code: "E999", ok: false, errors: ["employee_code: unknown employee."], warnings: [], values: {} },
      ],
    });
    api.importCommit.mockResolvedValue({ import_id: 11, status: "QUEUED", job: { id: 31 } });
    api.getImport.mockResolvedValue({ import_id: 11, status: "COMMITTED", file_name: "s.csv", summary: null, result: { rows: [{ row: 2, ok: true, compensation_id: 70 }], created_count: 1, failed_count: 0 }, job_id: 31, created_at: "" });
    render(<BulkImport />);
    expect(screen.getByRole("link", { name: /Download template/ })).toHaveAttribute("href", "/api/v1/payroll/compensation/import-template");
    fireEvent.click(screen.getByRole("button", { name: "Next: upload" }));
    const file = new File(["employee_code,structure_code,pay_basis_amount,effective_from\r\nE042,IN_STAFF,1200000,2026-11-01\r\n"], "s.csv", { type: "text/csv" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Upload the CSV"), { target: { files: [file] } });
    });
    expect(await screen.findByText("employee_code: unknown employee.")).toBeInTheDocument();
    expect(api.importDryRun).toHaveBeenCalledWith(expect.stringContaining("E042,IN_STAFF"), "s.csv");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Commit 1 row" }));
    });
    expect(api.importCommit).toHaveBeenCalledWith(11, expect.any(String));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Job 31 running" }));
    });
    expect(await screen.findByText(/1 proposed for approval · 0 failed/)).toBeInTheDocument();
  });
});
