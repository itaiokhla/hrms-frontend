import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";

import MyClaimPageRoute from "@/app/(app)/me/claims/[id]/page";
import MyClaimsRoute from "@/app/(app)/me/claims/page";
import MyLoanPageRoute from "@/app/(app)/me/loans/[id]/page";
import NewLoanPageRoute from "@/app/(app)/me/loans/new/page";
import MyLoansRoute from "@/app/(app)/me/loans/page";
import { ConfirmProvider } from "@/components/ui/overlay";
import { payrollError } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { claim, claimTypes, conflict, loan, me, notFound, plain, signIn } from "./fixtures";

const mockPush = jest.fn();
let mockSearch = new URLSearchParams();
let mockParams: Record<string, string> = {};
let mockPath = "/me/loans";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  usePathname: () => mockPath,
  useSearchParams: () => mockSearch,
  useParams: () => mockParams,
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("@/lib/payroll/api", () => {
  const actual = jest.requireActual("@/lib/payroll/api");
  return { ...actual, payrollApi: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});

function serve(routes: Record<string, unknown>) {
  mockGet.mockImplementation((url: string) => {
    if (url in routes) {
      const value = routes[url];
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    return Promise.reject(notFound("Route"));
  });
}

const renderWithConfirm = (ui: ReactElement) => render(<ConfirmProvider>{ui}</ConfirmProvider>);
const BOTH = me();

const ROUTES = {
  "/me/payroll/loans": { total: 1, items: [loan()] },
  "/me/payroll/loans/8": loan(),
  "/me/payroll/reimbursement-claims": { total: 1, items: [claim()] },
  "/me/payroll/reimbursement-claims/21": claim(),
  "/payroll/reimbursement-claim-types": claimTypes(),
  "/payroll/uploads/limits": { max_upload_bytes: 10485760, kinds: { claim_receipt: { max_bytes: 5242880, max_files: 5, mime_types: ["application/pdf"] } } },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockParams = {};
  mockPath = "/me/loans";
});

/* ------------------------------------------------------------------ loans */

describe("My Loans", () => {
  it("lists loans with exact principal and balance and switches to Claims", async () => {
    signIn(BOTH);
    serve(ROUTES);
    render(<MyLoansRoute />);
    const list = await screen.findByRole("list", { name: "Loans and advances" });
    const text = plain(list.textContent);
    expect(text).toMatch(/60,000\.00/);
    expect(text).toMatch(/40,000\.00/);
    expect(within(list).getByText("Active")).toBeInTheDocument();
    expect(within(list).getByRole("link")).toHaveAttribute("href", "/me/loans/8");
    const nav = screen.getByRole("navigation", { name: "Loans and claims" });
    expect(within(nav).getByRole("link", { name: "Loans & advances" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Claims" })).toHaveAttribute("href", "/me/claims");
  });

  it("validates the amount in the deep-linked apply modal before sending", async () => {
    signIn(BOTH);
    mockSearch = new URLSearchParams("modal=new-loan");
    serve(ROUTES);
    render(<MyLoansRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Apply for a loan or advance" });
    await waitFor(() => expect(within(dialog).getByLabelText(/^Amount \(INR\)/)).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText(/^Amount/), { target: { value: "12.345" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(await within(dialog).findByText("INR amounts have at most 2 decimals.")).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("link", { name: /Open full page/ })).toHaveAttribute("href", "/me/loans/new");
  });

  it("shows the policy's reason when the application doesn't fit", async () => {
    signIn(BOTH);
    serve(ROUTES);
    mockPost.mockRejectedValue(payrollError(409, { detail: "The most you can borrow is 50,000.00 INR.", code: "LOAN_LIMIT_EXCEEDED" }));
    render(<NewLoanPageRoute />);
    await waitFor(() => expect(screen.getByLabelText(/^Amount \(INR\)/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "75000" } });
    fireEvent.change(screen.getByLabelText(/Repay over/), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/me/payroll/loans", { kind: "LOAN", amount: { amount: "75000.00", currency: "INR" }, tenure: 12, purpose: null }));
    expect(await screen.findByText("This doesn't fit your policy")).toBeInTheDocument();
    expect(screen.getByText("The most you can borrow is 50,000.00 INR.")).toBeInTheDocument();
  });

  it("shows the repayment schedule and history of one loan", async () => {
    signIn(BOTH);
    mockParams = { id: "8" };
    serve(ROUTES);
    render(<MyLoanPageRoute />);
    const table = await screen.findByRole("table", { name: "Repayment schedule" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(plain(table.textContent)).toMatch(/50,000\.00/);
    expect(screen.getByText("6 equal monthly instalments, no interest.")).toBeInTheDocument();
    expect(screen.getByText(/Paid out to you/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Statement/ })).toBeInTheDocument();
  });

  it("shows someone else's loan as not found", async () => {
    signIn(BOTH);
    mockParams = { id: "99" };
    serve(ROUTES);
    render(<MyLoanPageRoute />);
    expect(await screen.findByText("Loan not found")).toBeInTheDocument();
  });

  it("is denied without loan access", () => {
    signIn(me({ [P.PAYROLL_PAYSLIP_READ]: ["SELF"] }));
    render(<MyLoansRoute />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ claims */

describe("My Claims", () => {
  beforeEach(() => {
    mockPath = "/me/claims";
  });

  it("lists claims with exact amounts and receipt counts", async () => {
    signIn(BOTH);
    serve(ROUTES);
    render(<MyClaimsRoute />);
    const list = await screen.findByRole("list", { name: "Claims" });
    expect(plain(list.textContent)).toMatch(/1,250\.50/);
    expect(within(list).getByText(/1 receipt/)).toBeInTheDocument();
    expect(within(list).getByText("Submitted")).toBeInTheDocument();
  });

  it("shows policy limits live and enforces the per-claim limit and receipt rule", async () => {
    signIn(BOTH);
    mockSearch = new URLSearchParams("modal=new-claim");
    serve({ ...ROUTES, "/me/payroll/reimbursement-claims": { total: 0, items: [] } });
    render(<MyClaimsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "New claim" });
    fireEvent.change(await within(dialog).findByLabelText(/^Type/), { target: { value: "TRAVEL" } });
    expect(within(dialog).getByText("Your policy for Travel")).toBeInTheDocument();
    expect(plain(dialog.textContent)).toMatch(/Up to ₹5,000\.00 per claim/);
    expect(within(dialog).getByText("Claim within 60 days of the expense.")).toBeInTheDocument();

    const amount = within(dialog).getByLabelText(/^Amount/);
    fireEvent.change(amount, { target: { value: "6000" } });
    expect(plain(dialog.textContent)).toMatch(/Above the ₹5,000\.00 limit per claim/);

    fireEvent.change(amount, { target: { value: "800" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit claim" }));
    expect(await within(dialog).findByText("Attach the receipt: it's required for this amount.")).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();

    fireEvent.change(amount, { target: { value: "450" } });
    mockPost.mockResolvedValue({ id: 22, status: "SUBMITTED", row_version: 1, approval_request_id: 81, flags: [] });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit claim" }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/me/payroll/reimbursement-claims", expect.objectContaining({ claim_type: "TRAVEL", amount: { amount: "450.00", currency: "INR" }, merchant: null, description: null })),
    );
  });

  it("says plainly when claims are not switched on", async () => {
    signIn(BOTH);
    mockSearch = new URLSearchParams("modal=new-claim");
    serve({ ...ROUTES, "/payroll/reimbursement-claim-types": claimTypes({ enabled: false, claim_types: [] }) });
    render(<MyClaimsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "New claim" });
    expect(await within(dialog).findByText("Claims aren't switched on for you")).toBeInTheDocument();
  });

  it("withdraws a submitted claim and shows a 409 conflict banner", async () => {
    signIn(BOTH);
    mockParams = { id: "21" };
    serve(ROUTES);
    mockPost.mockRejectedValue(conflict("INVALID_TRANSITION", "The claim was already approved."));
    renderWithConfirm(<MyClaimPageRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "Withdraw this claim?" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/me/payroll/reimbursement-claims/21/withdraw", { remarks: null }));
    expect(await screen.findByText("Someone else changed this")).toBeInTheDocument();
    // The page stays aria-hidden until the confirm dialog has finished closing.
    expect(await screen.findByRole("button", { name: /Download uber\.pdf/ })).toBeInTheDocument();
  });

  it("hides Withdraw once the claim is decided", async () => {
    signIn(BOTH);
    mockParams = { id: "21" };
    serve({ ...ROUTES, "/me/payroll/reimbursement-claims/21": claim({ status: "APPROVED", approved: { amount: "1250.50", currency: "INR" } }) });
    render(<MyClaimPageRoute />);
    await screen.findByText("Claimed");
    expect(document.querySelector('[data-status="APPROVED"]')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
  });
});
