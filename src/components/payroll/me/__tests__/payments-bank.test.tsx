import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";

import AddBankAccountPageRoute from "@/app/(app)/me/bank-accounts/new/page";
import MyBankAccountPageRoute from "@/app/(app)/me/bank-accounts/[id]/page";
import MyBankAccountsRoute from "@/app/(app)/me/bank-accounts/page";
import MyPaymentsRoute from "@/app/(app)/me/payments/page";
import { ConfirmProvider } from "@/components/ui/overlay";
import { payrollError } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { abaProblem, checkBankForm, EMPTY_BANK_FORM, ibanProblem, maskTail, serverField, toBankBody } from "../bankFormat";
import { account, change, claimTypes, conflict, me, notFound, payslip, period, plain, serverError, signIn } from "./fixtures";

const mockPush = jest.fn();
let mockSearch = new URLSearchParams();
let mockParams: Record<string, string> = {};
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/me/bank-accounts",
  useSearchParams: () => mockSearch,
  useParams: () => mockParams,
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("@/lib/payroll/api", () => {
  const actual = jest.requireActual("@/lib/payroll/api");
  return {
    ...actual,
    payrollApi: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
    // The real stepUpApi closes over the real payrollApi, so route it through the same mock.
    stepUpApi: { status: () => mockGet("/payroll/step-up", { stepUp: false }), emailCode: jest.fn(), verify: jest.fn() },
  };
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

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockParams = {};
});

/* ------------------------------------------------------------------ format checks */

describe("bank format checks", () => {
  it("validates IBANs by country, length and checksum", () => {
    expect(ibanProblem("DE89 3704 0044 0532 0130 00", "DE")).toBeNull();
    expect(ibanProblem("DE89370400440532013001", "DE")).toMatch(/check digits don't match/);
    expect(ibanProblem("DE8937040044053201300", "DE")).toMatch(/22 characters/);
    expect(ibanProblem("GB82WEST12345698765432", "DE")).toMatch(/must start with DE/);
  });

  it("validates ABA routing numbers with the Federal Reserve prefix and check digit", () => {
    expect(abaProblem("021000021")).toBeNull();
    expect(abaProblem("021000022")).toMatch(/check digit/);
    expect(abaProblem("12345")).toMatch(/9 digits/);
  });

  it("checks Indian, UK and international fields and only requires on submit", () => {
    const india = { ...EMPTY_BANK_FORM, country: "IN", currency: "INR", ifsc: "HDFC001234" };
    expect(checkBankForm(india)).toEqual({ ifsc: expect.stringMatching(/IFSC is 4 letters/) });
    expect(Object.keys(checkBankForm(india, { submitting: true }))).toEqual(expect.arrayContaining(["holder_name", "account_number", "ifsc", "account_type"]));
    const uk = { ...EMPTY_BANK_FORM, country: "GB", currency: "GBP", holder_name: "A Rao", sort_code: "12-34-5", account_number: "1234567" };
    expect(checkBankForm(uk)).toEqual({ sort_code: "The sort code has 6 digits.", account_number: "UK account numbers have 8 digits." });
    const intl = { ...EMPTY_BANK_FORM, country: "SG", currency: "SGD", holder_name: "A Rao", bic: "DBSSSGSG", bank_address: "Singapore" };
    expect(checkBankForm(intl, { submitting: true })).toEqual({ account_number: "Enter the IBAN or the account number." });
  });

  it("sends only the fields the country uses, normalised", () => {
    const body = toBankBody({ ...EMPTY_BANK_FORM, country: "in", currency: "INR", holder_name: " Asha Rao ", account_number: "1234 5678 9012", ifsc: "hdfc0001234", account_type: "savings", iban: "DE89370400440532013000", bic: "X" });
    expect(body).toEqual({
      holder_name: "Asha Rao", country: "IN", currency: "INR", account_number: "123456789012", iban: null,
      routing: { ifsc: "HDFC0001234" }, account_type: "SAVINGS", bank_name: null, branch_name: null, bank_address: null,
    });
    expect(maskTail("123456789012")).toBe("••••9012");
    expect(serverField("body.routing.ifsc")).toBe("ifsc");
    expect(serverField("account")).toBe("account_number");
  });
});

/* ------------------------------------------------------------------ My Payments */

describe("My Payments", () => {
  const ROUTES = {
    "/me/payroll/payments": { items: [period()], years: [2026, 2025] },
    "/me/payroll/payslips": { total: 1, items: [payslip()] },
    "/me/payroll/documents": { total: 0, items: [] },
  };

  it("shows each payment with its evidence label and masked account, never as paid", async () => {
    signIn(me());
    serve(ROUTES);
    render(<MyPaymentsRoute />);
    const periods = await screen.findByRole("list", { name: "Payments by period" });
    expect(within(periods).getByText("Monthly IN · Nov 2026")).toBeInTheDocument();
    expect(within(periods).getByText("Submitted — unverified")).toBeInTheDocument();
    expect(within(periods).getAllByText("Submitted for manual payment — unverified").length).toBeGreaterThan(0);
    const text = plain(periods.textContent);
    expect(text).toMatch(/To HDFC Bank ••••4321/);
    expect(text).toMatch(/82,410\.00/);
    expect(text).not.toMatch(/Paid on/);
    expect(within(periods).getByRole("button", { name: /Download payslip November 2026/ })).toBeInTheDocument();
  });

  it("labels sandbox payments as moving no real money", async () => {
    signIn(me());
    const base = period();
    serve({ ...ROUTES, "/me/payroll/payments": { items: [{ ...base, instructions: [{ ...base.instructions[0], sandbox: true, label: { key: "PAID", text: "Paid on 2026-11-30", badge: "SANDBOX" } }] }], years: [2026] } });
    render(<MyPaymentsRoute />);
    expect(await screen.findByText("SANDBOX — no real money moved")).toBeInTheDocument();
  });

  it("filters by year", async () => {
    signIn(me());
    serve(ROUTES);
    render(<MyPaymentsRoute />);
    const year = await screen.findByLabelText("Year");
    fireEvent.change(year, { target: { value: "2025" } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/me/payroll/payments", { params: { year: 2025 } }));
  });

  it("explains an empty history with a next action", async () => {
    signIn(me());
    serve({ ...ROUTES, "/me/payroll/payments": { items: [], years: [] } });
    render(<MyPaymentsRoute />);
    expect(await screen.findByText("No payments yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My bank accounts" })).toHaveAttribute("href", "/me/bank-accounts");
  });

  it("offers Try again on a server error", async () => {
    signIn(me());
    serve({ ...ROUTES, "/me/payroll/payments": serverError() });
    render(<MyPaymentsRoute />);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ My Bank Accounts */

describe("My Bank Accounts", () => {
  const ROUTES = {
    "/me/payroll/bank-accounts": { total: 1, items: [account()] },
    "/me/payroll/bank-change-requests": { total: 0, items: [] },
    "/payroll/reimbursement-claim-types": claimTypes(),
    "/payroll/uploads/limits": { max_upload_bytes: 10485760, kinds: {} },
    "/payroll/step-up": { active: true, method: "TOTP", verified_at: null, expires_at: null, available_methods: ["TOTP"] },
  };

  it("lists masked accounts with status and verification chips", async () => {
    signIn(me());
    serve(ROUTES);
    render(<MyBankAccountsRoute />);
    const list = await screen.findByRole("list", { name: "Bank accounts" });
    expect(plain(list.textContent)).toMatch(/HDFC Bank ••••4321/);
    expect(within(list).getByText("Active")).toBeInTheDocument();
    expect(within(list).getByText("Verified")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add account/ })).toBeEnabled();
  });

  it("hides Add account from people who may only read their bank details", async () => {
    signIn(me({ [P.PAYROLL_BANK_DETAILS_READ_MASKED]: ["SELF"] }));
    serve(ROUTES);
    render(<MyBankAccountsRoute />);
    await screen.findByRole("list", { name: "Bank accounts" });
    expect(screen.queryByRole("button", { name: /Add account/ })).not.toBeInTheDocument();
  });

  it("shows the pending change and the cooling-off countdown, and blocks a second change", async () => {
    signIn(me());
    const usableFrom = new Date(Date.now() + (2 * 24 + 4) * 3600 * 1000 + 60000).toISOString();
    serve({
      ...ROUTES,
      "/me/payroll/bank-accounts": { total: 1, items: [account({ cooling_off: true, usable_from: usableFrom })] },
      "/me/payroll/bank-change-requests": { total: 1, items: [change()] },
    });
    renderWithConfirm(<MyBankAccountsRoute />);
    expect(await screen.findByText("Changing your salary account")).toBeInTheDocument();
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
    expect(plain(document.body.textContent)).toMatch(/ICICI Bank ••••9876/);
    expect(await screen.findByText(/Usable for salary in 2 d 4 h/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add account/ })).toBeDisabled();
  });

  it("cancels a pending change after confirmation and shows a 409 conflict banner", async () => {
    signIn(me());
    serve({ ...ROUTES, "/me/payroll/bank-change-requests": { total: 1, items: [change()] } });
    mockPost.mockRejectedValue(conflict("INVALID_TRANSITION", "The change was already decided."));
    renderWithConfirm(<MyBankAccountsRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel change" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel the change" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/me/payroll/bank-change-requests/12/cancel", { remarks: null }));
    expect(await screen.findByText("Someone else changed this")).toBeInTheDocument();
  });

  it("starts Add account with a step-up when none is fresh", async () => {
    signIn(me());
    mockSearch = new URLSearchParams("modal=add-bank");
    serve({ ...ROUTES, "/payroll/step-up": { active: false, method: null, verified_at: null, expires_at: null, available_methods: ["TOTP"] } });
    render(<MyBankAccountsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Add bank account" });
    expect(await within(dialog).findByText("First, confirm it's you")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Country of the bank account/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm it's you" }));
    expect(await screen.findByRole("dialog", { name: "Confirm it's you" })).toBeInTheDocument();
  });

  it("checks formats live, says format is not ownership, and submits after review", async () => {
    signIn(me());
    mockSearch = new URLSearchParams("modal=add-bank");
    serve(ROUTES);
    mockPost.mockResolvedValue({ id: 4, change_request_id: 13, bank_account_id: 4, status: "PENDING_APPROVAL", approval_request_id: 91, row_version: 1 });
    render(<MyBankAccountsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Add bank account" });
    const country = await within(dialog).findByLabelText(/Country of the bank account/);
    expect(within(dialog).getByText("Format checks aren't proof of ownership")).toBeInTheDocument();
    fireEvent.change(country, { target: { value: "IN" } });
    await waitFor(() => expect(within(dialog).getByLabelText(/Account currency/)).toHaveValue("INR"));

    const ifsc = within(dialog).getByLabelText(/^IFSC/);
    fireEvent.change(ifsc, { target: { value: "HDFC001234" } });
    fireEvent.blur(ifsc);
    expect(await within(dialog).findByText("An IFSC is 4 letters, then 0, then 6 letters or digits.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await within(dialog).findByText("Enter the account holder's name.")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/Account holder's name/), { target: { value: "Asha Rao" } });
    fireEvent.change(within(dialog).getByLabelText(/^Account number/), { target: { value: "123456789012" } });
    fireEvent.change(ifsc, { target: { value: "HDFC0001234" } });
    fireEvent.change(within(dialog).getByLabelText(/^Account type/), { target: { value: "SAVINGS" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    fireEvent.click(await within(dialog).findByRole("button", { name: "Skip and continue" }));
    expect(await within(dialog).findByText("What happens next")).toBeInTheDocument();
    expect(plain(dialog.textContent)).toMatch(/••••9012/);
    expect(plain(dialog.textContent)).not.toMatch(/123456789012/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit for approval" }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        "/me/payroll/bank-accounts",
        expect.objectContaining({ holder_name: "Asha Rao", country: "IN", currency: "INR", account_number: "123456789012", routing: { ifsc: "HDFC0001234" }, account_type: "SAVINGS", allocation: null }),
        { idempotencyKey: expect.any(String) },
      ),
    );
    expect(await within(dialog).findByText("Submitted for checking")).toBeInTheDocument();
  });

  it("maps a server 409 on submit to plain next steps", async () => {
    signIn(me());
    serve(ROUTES);
    mockPost.mockRejectedValue(payrollError(409, { detail: "Another bank account change for this person is still open.", code: "CHANGE_ALREADY_PENDING" }));
    render(<AddBankAccountPageRoute />);
    const country = await screen.findByLabelText(/Country of the bank account/);
    fireEvent.change(country, { target: { value: "AE" } });
    await waitFor(() => expect(screen.getByLabelText(/Account currency/)).toHaveValue("INR"));
    fireEvent.change(screen.getByLabelText(/Account currency/), { target: { value: "AED" } });
    fireEvent.change(screen.getByLabelText(/Account holder's name/), { target: { value: "Asha Rao" } });
    fireEvent.change(screen.getByLabelText(/^IBAN/), { target: { value: "AE07 0331 2345 6789 0123 456" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Skip and continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Submit for approval" }));
    expect(await screen.findByText("Someone else changed this")).toBeInTheDocument();
    expect(screen.getByText(/Cancel the open change on My Bank Accounts first/)).toBeInTheDocument();
  });

  it("shows one account with masked routing and stops using it after a reason", async () => {
    signIn(me());
    mockParams = { id: "3" };
    serve({ ...ROUTES, "/me/payroll/bank-accounts/3": account() });
    mockPost.mockResolvedValue(account({ status: "INACTIVE" }));
    render(<MyBankAccountPageRoute />);
    expect(await screen.findByText("HDFC0001234")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop using this account" }));
    const dialog = await screen.findByRole("dialog", { name: "Stop using this account?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop using it" }));
    expect(await within(dialog).findByText("Say why, for example: account closed.")).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Account closed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop using it" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/me/payroll/bank-accounts/3/deactivate", { reason: "Account closed", row_version: 2 }));
  });

  it("hides changes on an account from people who may only read it", async () => {
    signIn(me({ [P.PAYROLL_BANK_DETAILS_READ_MASKED]: ["SELF"] }));
    mockParams = { id: "3" };
    serve({ ...ROUTES, "/me/payroll/bank-accounts/3": account() });
    render(<MyBankAccountPageRoute />);
    expect(await screen.findByText("HDFC0001234")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop using this account" })).not.toBeInTheDocument();
    expect(screen.queryByText("Proof of account")).not.toBeInTheDocument();
  });

  it("shows someone else's (forbidden) account as not found", async () => {
    signIn(me());
    mockParams = { id: "99" };
    serve(ROUTES);
    render(<MyBankAccountPageRoute />);
    expect(await screen.findByText("Bank account not found")).toBeInTheDocument();
  });
});
