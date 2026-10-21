import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import StructuresPage from "@/app/(app)/payroll/structures/page";
import StructurePage from "@/app/(app)/payroll/structures/[id]/page";
import { PayrollApiError } from "@/lib/payroll/api";

import { compensationApi } from "../api";
import type { Breakdown, SalaryStructure, StructureVersion } from "../types";
import { EDITOR, READER, money, nav, resetNav, signIn } from "./helpers";

jest.mock("next/navigation", () => require("./helpers").navigationMock());
jest.mock("@/components/shared/EmployeePicker", () => require("./helpers").employeePickerMock());
jest.mock("../api", () => {
  const actual = jest.requireActual("../api");
  const mocked = Object.fromEntries(Object.entries(actual.compensationApi).map(([k, v]) => [k, typeof v === "function" ? jest.fn() : v]));
  return { ...actual, compensationApi: mocked };
});

const api = compensationApi as unknown as Record<string, jest.Mock>;

function ver(n: number, status: string, over: Partial<StructureVersion> = {}): StructureVersion {
  return {
    id: 100 + n, version: n, status, eligibility: {}, test_range: { min: "300000", max: "5000000" }, test_vectors: [], validation: null, effective_from: null, row_version: 3,
    created_by_user_id: 1, published_by_user_id: null, published_at: null, created_at: "2026-10-01T00:00:00Z",
    lines: [
      { id: 1, component: "BASIC", kind: "EARNING", method: "FORMULA", value: null, formula: "ctc.monthly * 0.5", params: {}, overridable: false, override_min: null, override_max: null, display_order: 0 },
      { id: 2, component: "FIXED_ALW", kind: "EARNING", method: "BALANCING", value: null, formula: null, params: {}, overridable: false, override_min: null, override_max: null, display_order: 1 },
    ],
    ...over,
  };
}

function structure(versions: StructureVersion[], over: Partial<SalaryStructure> = {}): SalaryStructure {
  return {
    id: 7, code: "IN_STAFF", name: "India Staff CTC", description: null, type: "CTC_BASED", currency: "INR", status: "ACTIVE",
    active_version: versions.find((v) => v.status === "ACTIVE")?.version ?? null, draft_version: versions.find((v) => v.status === "DRAFT")?.version ?? null,
    eligibility: {}, assignment_counts: { "1": 3, "2": 0 }, versions, ...over,
  };
}

const PREVIEW: Breakdown = {
  currency: "INR", periods_per_year: 12,
  lines: [
    { component: "BASIC", kind: "EARNING", method: "FORMULA", monthly: money("50000.00"), annual: money("600000.00"), explanation: "Half of the monthly CTC: 100,000.00 × 0.5" },
    { component: "FIXED_ALW", kind: "EARNING", method: "BALANCING", monthly: money("47000.00"), annual: money("564000.00"), explanation: "The rest of the CTC" },
  ],
  totals: { gross: { monthly: money("97000.00"), annual: money("1164000.00") }, ctc: { monthly: money("100000.00"), annual: money("1200000.00") } },
  statutory: { lines: [{ component: "EPF_ER", kind: "EMPLOYER_CONTRIBUTION", monthly: money("3000.00"), annual: money("36000.00"), verified: false, fixture: true, explanation: "12% of the PF wage" }], verified: false, label: "Compliance not verified", note: "Statutory estimates come from the country pack in preview mode and are not verified." },
  issues: [], ok: true,
};

beforeEach(() => {
  Object.values(api).forEach((fn) => typeof fn === "function" && "mockReset" in fn && fn.mockReset().mockResolvedValue(undefined));
  api.listComponents.mockResolvedValue([
    { id: 1, code: "BASIC", kind: "EARNING", category: "BASE", owner: "COMPANY", read_only: false, status: "ACTIVE", stage: 4, name: "Basic", current_version: null },
    { id: 2, code: "FIXED_ALW", kind: "EARNING", category: "FIXED_ALLOWANCE", owner: "COMPANY", read_only: false, status: "ACTIVE", stage: 4, name: "Fixed allowance", current_version: null },
    { id: 3, code: "HRA", kind: "EARNING", category: "FIXED_ALLOWANCE", owner: "COMPANY", read_only: false, status: "ACTIVE", stage: 4, name: "HRA", current_version: null },
  ]);
  api.previewStructure.mockResolvedValue(PREVIEW);
  api.validateFormula.mockResolvedValue({ errors: [], warnings: [], valid: true, dependencies: [], components: [], variables: [], type: "MONEY" });
});

describe("Salary structures list", () => {
  it("shows versions and salary counts and opens the builder", async () => {
    resetNav("/payroll/structures");
    signIn(READER);
    api.listStructures.mockResolvedValue([structure([ver(1, "ACTIVE"), ver(2, "DRAFT")])]);
    render(<StructuresPage />);
    expect((await screen.findAllByText("India Staff CTC")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("v1 published").length).toBeGreaterThan(0);
    expect(screen.getAllByText("v2 draft").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /New structure/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText("India Staff CTC")[0]);
    expect(nav.push).toHaveBeenCalledWith("/payroll/structures/7");
  });
});

describe("Structure builder", () => {
  it("previews with string amounts, labels unverified statutory estimates and explains an amount", async () => {
    resetNav("/payroll/structures/7", "", { id: "7" });
    signIn(EDITOR);
    api.getStructure.mockResolvedValue(structure([ver(1, "ACTIVE"), ver(2, "DRAFT")]));
    render(<StructurePage />);
    expect((await screen.findAllByText("v2 · Draft")).length).toBeGreaterThan(0);
    await waitFor(() => expect(api.previewStructure).toHaveBeenCalledWith(7, { pay_basis_amount: money("1200000.00"), version: 2 }, expect.anything()), { timeout: 2000 });
    expect(await screen.findByText("₹1,200,000.00")).toBeInTheDocument();
    expect(screen.getByText("Compliance not verified")).toBeInTheDocument();
    expect(screen.getByText("FIXTURE — not law")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Why this amount? Basic" }));
    expect(screen.getByText(/Half of the monthly CTC/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Monthly" }));
    expect(screen.getByText("₹50,000.00")).toBeInTheDocument();
  });

  it("validates and shows the negative-balancing error on its line with the minimum pay basis", async () => {
    resetNav("/payroll/structures/7", "", { id: "7" });
    signIn(EDITOR);
    api.getStructure.mockResolvedValue(structure([ver(1, "ACTIVE"), ver(2, "DRAFT")]));
    api.validateStructure.mockResolvedValue({
      ok: false, currency: "INR", warnings: [], vectors: [], minimum_pay_basis: money("420000.00"),
      errors: [{ code: "NEGATIVE_BALANCING", message: "The balancing component FIXED_ALW is negative below 420000.00 INR", component: "FIXED_ALW" }],
    });
    render(<StructurePage />);
    await screen.findAllByText("v2 · Draft");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Validate/ }));
    });
    const problems = await screen.findByRole("list", { name: "Problems with FIXED_ALW" });
    expect(within(problems).getByText(/negative below 420000.00 INR/)).toBeInTheDocument();
    expect(screen.getByText("₹420,000.00")).toBeInTheDocument();
    expect(screen.getByText(/1 problem to fix before publishing/)).toBeInTheDocument();
  });

  it("saves the reordered draft with its row version and shows a conflict on a stale draft", async () => {
    resetNav("/payroll/structures/7", "", { id: "7" });
    signIn(EDITOR);
    api.getStructure.mockResolvedValue(structure([ver(1, "ACTIVE"), ver(2, "DRAFT")]));
    api.updateStructureVersion.mockRejectedValue(new PayrollApiError(409, "This draft changed since you loaded it; reload and try again.", "ROW_VERSION_CONFLICT", undefined, { message: "This draft changed since you loaded it; reload and try again." }));
    render(<StructurePage />);
    await screen.findAllByText("v2 · Draft");
    fireEvent.click(screen.getByRole("button", { name: "Move FIXED_ALW up" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    });
    expect(api.updateStructureVersion).toHaveBeenCalledWith(7, 2, expect.objectContaining({ row_version: 3, lines: [expect.objectContaining({ component: "FIXED_ALW", display_order: 0 }), expect.objectContaining({ component: "BASIC", display_order: 1 })] }));
    expect(await screen.findByText("Someone else changed this.")).toBeInTheDocument();
  });

  it("opens Publish from its deep link with the consequences and publishes", async () => {
    resetNav("/payroll/structures/7", "modal=publish&version=2", { id: "7" });
    signIn(EDITOR);
    api.getStructure.mockResolvedValue(structure([ver(1, "ACTIVE"), ver(2, "DRAFT")]));
    api.publishStructure.mockResolvedValue(structure([ver(1, "ARCHIVED"), ver(2, "ACTIVE")]));
    render(<StructurePage />);
    const dialog = await screen.findByRole("dialog", { name: "Publish version 2?" });
    expect(within(dialog).getByText(/The 3 salaries on it keep it until you move them/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Publish v2" }));
    });
    expect(api.publishStructure).toHaveBeenCalledWith(7, { version: 2, effective_from: undefined });
  });

  it("is read-only for a reader: no save, validate or publish", async () => {
    resetNav("/payroll/structures/7", "", { id: "7" });
    signIn(READER);
    api.getStructure.mockResolvedValue(structure([ver(1, "ACTIVE")]));
    render(<StructurePage />);
    expect(await screen.findByText("v1 · Published")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save draft/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Publish/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit as new version/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Move .* salaries/ })).not.toBeInTheDocument();
  });

  it("previews moving salaries to the published version before sending them for approval", async () => {
    resetNav("/payroll/structures/7", "modal=move", { id: "7" });
    signIn(EDITOR);
    api.getStructure.mockResolvedValue(structure([ver(1, "ARCHIVED"), ver(2, "ACTIVE")], { assignment_counts: { "1": 1, "2": 0 } }));
    api.moveAssignments
      .mockResolvedValueOnce({
        dry_run: true, to_version: 2, effective_from: "2026-11-01", count: 1,
        items: [{ assignment_id: 9, employee_id: 42, structure_before: { version: 1 }, structure_after: { version: 2 }, pay_basis: { before: money("1200000.00"), after: money("1200000.00"), change_pct: "0.00" }, lines: [{ component: "BASIC", before_monthly: money("40000.00"), after_monthly: money("50000.00"), before_annual: null, after_annual: null, change_pct: "25.00" }], before: null, after: PREVIEW, grade_range: { status: "NO_RANGE", grade: null, range: null, position_pct: null } }],
      })
      .mockResolvedValueOnce({ dry_run: false, to_version: 2, effective_from: "2026-11-01", count: 1, items: [], created: [77] });
    render(<StructurePage />);
    const dialog = await screen.findByRole("dialog", { name: "Move salaries to version 2" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Preview the move" }));
    });
    expect(await within(dialog).findByText("₹40,000.00")).toBeInTheDocument();
    expect(within(dialog).getByText("₹50,000.00")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Send 1 for approval" }));
    });
    expect(api.moveAssignments).toHaveBeenLastCalledWith(7, expect.objectContaining({ dry_run: false, assignment_ids: [9], to_version: 2 }));
  });
});
