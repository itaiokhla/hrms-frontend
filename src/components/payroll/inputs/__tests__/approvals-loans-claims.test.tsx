import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import ApprovalsPage from "@/app/(app)/payroll/approvals/page";
import LoanPage from "@/app/(app)/payroll/loans/[id]/page";
import LoansPage from "@/app/(app)/payroll/loans/page";
import ClaimPage from "@/app/(app)/payroll/reimbursements/[id]/page";
import ReimbursementsPage from "@/app/(app)/payroll/reimbursements/page";
import { P } from "@/lib/permissions.generated";

import { approval, claim, conflict, loan, me, notFound, plain, signIn } from "./fixtures";

const mockPush = jest.fn();
let mockSearch = new URLSearchParams();
let mockParams: Record<string, string> = {};
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/payroll",
  useSearchParams: () => mockSearch,
  useParams: () => mockParams,
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("@/lib/payroll/api", () => {
  const actual = jest.requireActual("@/lib/payroll/api");
  return { ...actual, payrollApi: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), patch: jest.fn(), delete: jest.fn() } };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockParams = {};
});

/* ------------------------------------------------------------------ approvals */

describe("Approvals inbox", () => {
  const APPROVER = me({ [P.PAYROLL_INPUTS_APPROVE]: ["COMPANY"], [P.OVERTIME_APPROVE]: ["REPORTING_TREE"] });

  it("is denied to people who approve nothing", () => {
    signIn(me({ [P.PAYROLL_INPUTS_READ]: ["COMPANY"] }));
    render(<ApprovalsPage />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("groups requests by module with counts from the same response", async () => {
    signIn(APPROVER);
    mockGet.mockResolvedValue({
      total: 3,
      items: [
        approval(),
        approval({ id: 71, subject_id: 12 }),
        approval({ id: 72, module: "overtime", module_label: "overtime", subject_type: "overtime_entry", subject_id: 41, amount: null }),
      ],
    });
    render(<ApprovalsPage />);
    const group = await screen.findByRole("group", { name: "Filter by module" });
    expect(within(group).getByRole("button", { name: /All\s*3/ })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: /Wage inputs\s*2/ })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: /Overtime\s*1/ })).toBeInTheDocument();
    expect(plain(document.body.textContent)).toMatch(/12,500\.50/);
    expect(mockGet).toHaveBeenCalledWith("/payroll/approvals", { params: { mine: true, limit: 200 } });
    fireEvent.click(within(group).getByRole("button", { name: /Overtime\s*1/ }));
    expect(screen.queryByText("Request #70")).not.toBeInTheDocument();
    expect(screen.getByText("Request #72")).toBeInTheDocument();
  });

  it("shows an empty inbox calmly", async () => {
    signIn(APPROVER);
    mockGet.mockResolvedValue({ total: 0, items: [] });
    render(<ApprovalsPage />);
    expect(await screen.findByText("Nothing is waiting for you")).toBeInTheDocument();
  });

  it("opens the deep-linked reject modal, requires a reason and sends the expected step", async () => {
    signIn(APPROVER);
    mockSearch = new URLSearchParams("modal=reject&id=70");
    mockGet.mockResolvedValue({ total: 1, items: [approval()] });
    mockPost.mockResolvedValue({ id: 70, status: "REJECTED" });
    render(<ApprovalsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Reject" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(await within(dialog).findByText(/Give a reason/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Not in budget" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/approvals/70/reject", { remarks: "Not in budget", expected_step: 1 }));
  });

  it("shows the 409 conflict banner when the request moved on", async () => {
    signIn(APPROVER);
    mockSearch = new URLSearchParams("modal=approve&id=70");
    mockGet.mockResolvedValue({ total: 1, items: [approval()] });
    mockPost.mockRejectedValue(conflict());
    render(<ApprovalsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Approve" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    expect(await within(dialog).findByText("Someone else changed this")).toBeInTheDocument();
  });

  it("hides decision buttons on requests the caller cannot act on", async () => {
    signIn(APPROVER);
    mockGet.mockResolvedValue({ total: 1, items: [approval({ can_act: false, acting_as: null })] });
    render(<ApprovalsPage />);
    await screen.findByText("Asha Rao");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ loans */

describe("Loans & Advances", () => {
  const MANAGER = me({ [P.PAYROLL_LOANS_READ]: ["COMPANY"], [P.PAYROLL_LOANS_MANAGE]: ["COMPANY"] });
  const READER = me({ [P.PAYROLL_LOANS_READ]: ["LEGAL_ENTITY"] });

  it("lists loans with principal and balance as exact amounts", async () => {
    signIn(READER);
    mockGet.mockResolvedValue({ total: 1, items: [loan()] });
    render(<LoansPage />);
    await waitFor(() => expect(plain(document.body.textContent)).toMatch(/60,000\.00/));
    expect(plain(document.body.textContent)).toMatch(/40,000\.00/);
    expect(screen.queryByRole("button", { name: /New loan/ })).not.toBeInTheDocument();
  });

  it("offers New loan to managers and validates the amount", async () => {
    signIn(MANAGER);
    mockSearch = new URLSearchParams("modal=new-loan");
    mockGet.mockResolvedValue({ total: 0, items: [] });
    render(<LoansPage />);
    const dialog = await screen.findByRole("dialog", { name: "New loan or advance" });
    fireEvent.change(within(dialog).getByLabelText(/Employee ID/), { target: { value: "142" } });
    fireEvent.change(within(dialog).getByLabelText(/^Amount/), { target: { value: "12.345" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for approval" }));
    expect(await within(dialog).findAllByText(/at most 2 decimals/)).not.toHaveLength(0);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("shows the schedule with 'Why this amount?' and manage actions for an active loan", async () => {
    signIn(MANAGER);
    mockParams = { id: "21" };
    mockGet.mockResolvedValue(loan());
    render(<LoanPage />);
    expect(await screen.findByText("Why this amount?")).toBeInTheDocument();
    for (const name of ["Pause", "Restructure", "Record prepayment", "Waive"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(plain(document.body.textContent)).toMatch(/20,000\.00/);
  });

  it("hides manage actions from read-only users", async () => {
    signIn(READER);
    mockParams = { id: "21" };
    mockGet.mockResolvedValue(loan());
    render(<LoanPage />);
    await screen.findByText("Why this amount?");
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  });

  it("requires a reason to pause and posts it", async () => {
    signIn(MANAGER);
    mockParams = { id: "21" };
    mockGet.mockResolvedValue(loan());
    mockPost.mockResolvedValue({ id: 1, status: "PENDING_APPROVAL" });
    render(<LoanPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    const dialog = await screen.findByRole("dialog", { name: "Pause recovery?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Request pause" }));
    expect(await within(dialog).findByText(/Give a reason/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Medical leave" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Request pause" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/loans/21/pause", { reason: "Medical leave" }));
  });

  it("never says paid before disbursement evidence", async () => {
    signIn(MANAGER);
    mockParams = { id: "21" };
    mockGet.mockResolvedValue(loan({ status: "APPROVED", disbursed_on: null, transactions: [] }));
    render(<LoanPage />);
    expect(await screen.findByText("Approved — waiting for disbursement")).toBeInTheDocument();
  });

  it("shows a missing loan as not found", async () => {
    signIn(MANAGER);
    mockParams = { id: "999" };
    mockGet.mockRejectedValue(notFound());
    render(<LoanPage />);
    expect(await screen.findByText("Loan not found")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ reimbursements */

describe("Reimbursements", () => {
  const APPROVER = me({ [P.PAYROLL_REIMBURSEMENTS_READ]: ["COMPANY"], [P.PAYROLL_REIMBURSEMENTS_APPROVE]: ["COMPANY"] });

  it("lists claims with their status and amount", async () => {
    signIn(APPROVER);
    mockGet.mockResolvedValue({ total: 1, items: [claim()] });
    render(<ReimbursementsPage />);
    await waitFor(() => expect(plain(document.body.textContent)).toMatch(/1,840\.00/));
    expect(screen.getAllByText("Travel").length).toBeGreaterThan(0);
  });

  it("lets an approver approve a submitted claim and lists receipts for preview", async () => {
    signIn(APPROVER);
    mockParams = { id: "31" };
    mockGet.mockResolvedValue(claim());
    mockPost.mockResolvedValue({ id: 31, status: "APPROVED" });
    render(<ClaimPage />);
    expect(await screen.findByRole("button", { name: /cab\.pdf/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog", { name: "Approve" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/reimbursement-claims/31/approve", { remarks: null }));
  });

  it("does not offer decisions to read-only users", async () => {
    signIn(me({ [P.PAYROLL_REIMBURSEMENTS_READ]: ["COMPANY"] }));
    mockParams = { id: "31" };
    mockGet.mockResolvedValue(claim());
    render(<ClaimPage />);
    await screen.findByRole("button", { name: /cab\.pdf/ });
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("warns when a claim is marked paid without settlement evidence", async () => {
    signIn(APPROVER);
    mockParams = { id: "31" };
    mockGet.mockResolvedValue(claim({ status: "PAID", paid_ref: null }));
    render(<ClaimPage />);
    expect(await screen.findByText("Marked paid without a settlement reference")).toBeInTheDocument();
  });
});
