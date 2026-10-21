import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import RevisionsPage from "@/app/(app)/payroll/revisions/page";
import RevisionCyclePage from "@/app/(app)/payroll/revisions/[id]/page";
import { P } from "@/lib/permissions.generated";

import { compensationApi } from "../api";
import type { RevisionCycle } from "../types";
import { APPROVER, EDITOR, READER, nav, resetNav, signIn } from "./helpers";

jest.mock("next/navigation", () => require("./helpers").navigationMock());
jest.mock("@/components/shared/EmployeePicker", () => require("./helpers").employeePickerMock());
jest.mock("../api", () => {
  const actual = jest.requireActual("../api");
  const mocked = Object.fromEntries(Object.entries(actual.compensationApi).map(([k, v]) => [k, typeof v === "function" ? jest.fn() : v]));
  return { ...actual, compensationApi: mocked };
});

const api = compensationApi as unknown as Record<string, jest.Mock>;

function cycle(over: Partial<RevisionCycle> = {}): RevisionCycle {
  return {
    id: 3, name: "Annual 2027", population: { legal_entity_ids: [1] }, method: { type: "PERCENT", percent: "8" }, effective_from: "2027-04-01", status: "PREVIEWED",
    totals: { INR: { count: 2, old: "2400000.00", new: "2592000.00", increase: "192000.00", change_pct: "8.00" }, AED: { count: 1, old: "120000.00", new: "129600.00", increase: "9600.00", change_pct: "8.00" } },
    approval_request_id: null, row_version: 4, created_by_user_id: 9, applied_by_user_id: null, applied_at: null, created_at: "2026-10-01T00:00:00Z",
    items: [
      { id: 1, employee: { id: 42, employee_code: "E042", name: "Asha Rao" }, status: "PROPOSED", old_assignment_id: 5, new_assignment_id: null, proposed: { template_version_id: 102, currency: "INR", old_pay_basis_amount: "1200000.00", pay_basis_amount: "1296000.00", change_pct: "8.00", grade_range: "IN_RANGE", position_pct: "60.0" }, note: null },
      { id: 2, employee: { id: 43, employee_code: "E043", name: "Ravi K" }, status: "EXCLUDED", old_assignment_id: null, new_assignment_id: null, proposed: null, note: "No salary in force on the effective date." },
    ],
    ...over,
  };
}

beforeEach(() => {
  Object.values(api).forEach((fn) => typeof fn === "function" && "mockReset" in fn && fn.mockReset().mockResolvedValue(undefined));
  api.listStructures.mockResolvedValue([]);
});

describe("Revision cycles list", () => {
  it("shows the increase per currency without summing currencies", async () => {
    resetNav("/payroll/revisions");
    signIn(EDITOR);
    api.listCycles.mockResolvedValue([cycle({ items: undefined })]);
    render(<RevisionsPage />);
    expect((await screen.findAllByText("Annual 2027")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/INR\s*192,000\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AED\s*9,600\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Previewed").length).toBeGreaterThan(0);
  });

  it("creates a cycle from the deep-linked modal and opens it", async () => {
    resetNav("/payroll/revisions", "modal=new-cycle");
    signIn(EDITOR);
    api.listCycles.mockResolvedValue([]);
    api.createCycle.mockResolvedValue(cycle({ id: 8, status: "DRAFT" }));
    render(<RevisionsPage />);
    const dialog = await screen.findByRole("dialog", { name: "New revision cycle" });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: "Annual 2027" } });
    fireEvent.change(within(dialog).getByLabelText(/^Increase/), { target: { value: "8" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create cycle" }));
    });
    expect(api.createCycle).toHaveBeenCalledWith(expect.objectContaining({ name: "Annual 2027", method: { type: "PERCENT", percent: "8" } }));
    expect(nav.push).toHaveBeenCalledWith("/payroll/revisions/8");
  });

  it("is hidden from people who can neither edit nor approve compensation", () => {
    resetNav("/payroll/revisions");
    signIn(READER);
    render(<RevisionsPage />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });
});

describe("Revision cycle page", () => {
  it("previews old, new, change and range position with totals per currency, then submits", async () => {
    resetNav("/payroll/revisions/3", "", { id: "3" });
    signIn(EDITOR);
    api.getCycle.mockResolvedValue(cycle());
    api.submitCycle.mockResolvedValue({ ...cycle({ status: "PENDING_APPROVAL" }), items: undefined });
    render(<RevisionCyclePage />);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Annual 2027");
    expect(screen.getAllByText("₹1,296,000.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("▲ 8.0%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("In range").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No salary in force on the effective date.").length).toBeGreaterThan(0);
    expect(screen.getByText(/INR · 2 people/)).toBeInTheDocument();
    expect(screen.getByText(/AED · 1 person/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue to approval" }));
    api.getCycle.mockResolvedValue(cycle({ status: "PENDING_APPROVAL" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Submit for approval/ }));
    });
    expect(api.submitCycle).toHaveBeenCalledWith(3);
    expect(await screen.findByText(/Waiting for approval/)).toBeInTheDocument();
  });

  it("lets another approver approve, but not the person who prepared it", async () => {
    resetNav("/payroll/revisions/3", "", { id: "3" });
    signIn({ ...APPROVER }, 9);
    api.getCycle.mockResolvedValue(cycle({ status: "PENDING_APPROVAL" }));
    const { unmount } = render(<RevisionCyclePage />);
    expect(await screen.findByText(/You prepared this cycle/)).toBeInTheDocument();
    unmount();
    signIn({ ...APPROVER }, 2);
    api.approveCycle.mockResolvedValue({ ...cycle({ status: "APPROVED" }), items: undefined });
    render(<RevisionCyclePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog", { name: "Approve Annual 2027?" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    });
    expect(api.approveCycle).toHaveBeenCalledWith(3, undefined);
  });

  it("applies only after typing the cycle name", async () => {
    resetNav("/payroll/revisions/3", "", { id: "3" });
    signIn({ ...EDITOR, [P.PAYROLL_COMPENSATION_APPROVE]: ["COMPANY"] }, 9);
    api.getCycle.mockResolvedValue(cycle({ status: "APPROVED" }));
    api.applyCycle.mockResolvedValue(cycle({ status: "APPLIED", items: [{ ...cycle().items![0], status: "APPLIED", new_assignment_id: 70 }] }));
    render(<RevisionCyclePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Apply cycle/ }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Apply cycle" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Type “Annual 2027” to confirm/), { target: { value: "Annual 2027" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Apply cycle" }));
    });
    await waitFor(() => expect(api.applyCycle).toHaveBeenCalledWith(3));
    expect(await screen.findByText(/1 in force, 0 failed/)).toBeInTheDocument();
  });

  it("saves the population with the row version and reports a conflict", async () => {
    resetNav("/payroll/revisions/3", "", { id: "3" });
    signIn(EDITOR);
    api.getCycle.mockResolvedValue(cycle({ status: "DRAFT", totals: null, items: [] }));
    const { PayrollApiError } = jest.requireActual("@/lib/payroll/api");
    api.updateCycle.mockRejectedValue(new PayrollApiError(409, "This cycle changed since you loaded it.", "ROW_VERSION_CONFLICT", undefined, { message: "This cycle changed since you loaded it." }));
    render(<RevisionCyclePage />);
    const save = await screen.findByRole("button", { name: "Save and continue" });
    fireEvent.click(screen.getByRole("button", { name: "Pick Asha" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await act(async () => {
      fireEvent.click(save);
    });
    expect(api.updateCycle).toHaveBeenCalledWith(3, { row_version: 4, population: { legal_entity_ids: [1], employee_ids: [42] } });
    expect(await screen.findByText("Someone else changed this.")).toBeInTheDocument();
  });
});
