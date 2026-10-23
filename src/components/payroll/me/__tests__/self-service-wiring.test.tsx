import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import MyBankAccountsRoute from "@/app/(app)/me/bank-accounts/page";
import MyLoansRoute from "@/app/(app)/me/loans/page";
import MyPayslipPageRoute from "@/app/(app)/me/payslips/[id]/page";
import MyPayslipsRoute from "@/app/(app)/me/payslips/page";
import MySalaryRoute from "@/app/(app)/me/salary/page";
import { payrollError } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { account, content, loan, loanPolicy, me, myQuestion, notFound, payslip, payslipDetail, period, plain, preferences, serverError, signIn } from "./fixtures";

const mockPush = jest.fn();
let mockSearch = new URLSearchParams();
let mockParams: Record<string, string> = {};
let mockPath = "/me/payslips";
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
  return {
    ...actual,
    payrollApi: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
    stepUpApi: { status: () => mockGet("/payroll/step-up"), emailCode: jest.fn(), verify: jest.fn() },
  };
});

type Handler = unknown | ((params?: Record<string, unknown>) => unknown);
/** Answer GETs by path; an Error rejects; unknown paths reject with 404 so nothing is invented. */
function serve(routes: Record<string, Handler>) {
  mockGet.mockImplementation((url: string, options?: { params?: Record<string, unknown> }) => {
    if (url in routes) {
      const raw = routes[url];
      const value = typeof raw === "function" ? (raw as (p?: Record<string, unknown>) => unknown)(options?.params) : raw;
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    return Promise.reject(notFound("Route"));
  });
}

const PAYSLIPS = {
  "/me/payroll/payslips": { total: 1, items: [payslip()] },
  "/me/payroll/payslips/5": payslipDetail(),
  "/me/payroll/documents": { total: 0, items: [] },
  "/me/payroll/document-requests": { items: [] },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockParams = {};
  mockPath = "/me/payslips";
});

/* ------------------------------------------------------------------ preferences on My Payslips */

describe("My Payslips with the employee's preferences", () => {
  it("offers Set document password only when PDFs are protected with the employee's secret", async () => {
    signIn(me());
    serve({ ...PAYSLIPS, "/me/payroll/preferences": preferences(), "/me/payroll/payslip-questions": { total: 0, items: [] } });
    const first = render(<MyPayslipsRoute />);
    expect(await screen.findByRole("button", { name: /Set document password/ })).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/me/payroll/preferences");
    first.unmount();

    serve({ ...PAYSLIPS, "/me/payroll/preferences": preferences({ payslip: { queries_enabled: false, pdf_protection: "NONE" } }) });
    render(<MyPayslipsRoute />);
    await screen.findAllByText("November 2026");
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/me/payroll/preferences"));
    expect(screen.queryByRole("button", { name: /Set document password/ })).not.toBeInTheDocument();
    // Questions are off and none exist: no "My questions" section either.
    expect(screen.queryByRole("heading", { name: "My questions" })).not.toBeInTheDocument();
  });

  it("keeps the password option when the preferences can't be read, but not for a 404", async () => {
    signIn(me());
    serve({ ...PAYSLIPS, "/me/payroll/preferences": serverError() });
    const first = render(<MyPayslipsRoute />);
    expect(await screen.findByRole("button", { name: /Set document password/ })).toBeInTheDocument();
    first.unmount();

    serve({ ...PAYSLIPS, "/me/payroll/preferences": notFound("Employee") });
    render(<MyPayslipsRoute />);
    await screen.findAllByText("November 2026");
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/me/payroll/preferences"));
    expect(screen.queryByRole("button", { name: /Set document password/ })).not.toBeInTheDocument();
  });

  it("says when PDFs are not protected in a deep-linked password dialog", async () => {
    signIn(me());
    mockSearch = new URLSearchParams("modal=payslip-password");
    serve({ ...PAYSLIPS, "/me/payroll/preferences": preferences({ payslip: { queries_enabled: false, pdf_protection: "NONE" } }), "/me/payroll/payslip-password": { set: false, set_at: null } });
    render(<MyPayslipsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Set document password" });
    expect(await within(dialog).findByText("Payslip PDFs aren't password-protected right now")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ payslip questions */

describe("Payslip questions (employee)", () => {
  it("asks a question about a published payslip from the viewer, sent once with an idempotency key", async () => {
    signIn(me());
    mockSearch = new URLSearchParams("modal=payslip&id=5");
    let questions = { total: 0, items: [] as unknown[] };
    serve({ ...PAYSLIPS, "/me/payroll/preferences": preferences(), "/me/payroll/payslip-questions": () => questions });
    mockPost.mockImplementation(async () => {
      questions = { total: 1, items: [myQuestion({ status: "OPEN", answer: null, answered_at: null, row_version: 1 })] };
      return { id: 7, document_id: 5, status: "OPEN", row_version: 1 };
    });
    render(<MyPayslipsRoute />);
    const dialog = await screen.findByRole("dialog", { name: /Payslip · November 2026/ });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Ask a question about this payslip" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send question" }));
    expect(await within(dialog).findByText("Write your question.")).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Your question/), { target: { value: "  Why is my HRA lower than last month?  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send question" }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/me/payroll/payslips/5/questions", { question: "Why is my HRA lower than last month?" }, { idempotencyKey: expect.any(String) }),
    );
    expect(await within(dialog).findByText("Waiting for an answer")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/me/payroll/payslip-questions", { params: { document_id: 5, limit: 50 } });
  });

  it("does not offer questions when the employer turned them off", async () => {
    signIn(me());
    mockSearch = new URLSearchParams("modal=payslip&id=5");
    serve({ ...PAYSLIPS, "/me/payroll/preferences": preferences({ payslip: { queries_enabled: false, pdf_protection: "NONE" } }), "/me/payroll/payslip-questions": { total: 0, items: [] } });
    render(<MyPayslipsRoute />);
    const dialog = await screen.findByRole("dialog", { name: /Payslip · November 2026/ });
    await within(dialog).findByText("Net pay");
    expect(within(dialog).queryByRole("button", { name: "Ask a question about this payslip" })).not.toBeInTheDocument();
  });

  it("does not offer a question on a superseded payslip", async () => {
    signIn(me());
    mockParams = { id: "5" };
    serve({ ...PAYSLIPS, "/me/payroll/payslips/5": payslipDetail({ status: "SUPERSEDED" }), "/me/payroll/preferences": preferences(), "/me/payroll/payslip-questions": { total: 0, items: [] } });
    render(<MyPayslipPageRoute />);
    expect(await screen.findByText("A revised payslip replaces this one")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask a question about this payslip" })).not.toBeInTheDocument();
  });

  it("explains the server's refusals in plain words", async () => {
    signIn(me());
    mockParams = { id: "5" };
    serve({ ...PAYSLIPS, "/me/payroll/preferences": preferences(), "/me/payroll/payslip-questions": { total: 0, items: [] } });
    mockPost.mockRejectedValueOnce(payrollError(409, { detail: "This payslip already has 5 open questions; wait for an answer first.", code: "TOO_MANY_OPEN_QUESTIONS" }));
    mockPost.mockRejectedValueOnce(payrollError(409, { detail: "Payslip questions are switched off. Contact HR directly.", code: "QUERIES_DISABLED" }));
    render(<MyPayslipPageRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "Ask a question about this payslip" }));
    fireEvent.change(screen.getByLabelText(/Your question/), { target: { value: "Why?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    expect(await screen.findByText("Too many open questions on this payslip")).toBeInTheDocument();
    expect(screen.getByText("This payslip already has 5 open questions; wait for an answer first.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    expect(await screen.findByText("Payslip questions are turned off")).toBeInTheDocument();
  });

  it("lists my questions with the answer and marks an answered one as resolved", async () => {
    signIn(me());
    let items = [myQuestion()];
    serve({ ...PAYSLIPS, "/me/payroll/preferences": preferences(), "/me/payroll/payslip-questions": () => ({ total: items.length, items }) });
    mockPost.mockImplementation(async () => {
      items = [myQuestion({ status: "CLOSED", closed_at: "2026-12-03T10:00:00", row_version: 3 })];
      return { id: 7, document_id: 5, status: "CLOSED", row_version: 3 };
    });
    render(<MyPayslipsRoute />);
    const section = (await screen.findByRole("heading", { name: "My questions" })).closest("section") as HTMLElement;
    expect(await within(section).findByText("HRA was prorated for 2 days of unpaid leave.")).toBeInTheDocument();
    expect(within(section).getByText("Answered", { selector: "span" })).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "November 2026" })).toHaveAttribute("href", "/me/payslips/5");
    fireEvent.click(within(section).getByRole("button", { name: /Close question/ }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/me/payroll/payslip-questions/7/close", { row_version: 2 }));
    expect(await within(section).findByText("Closed", { selector: "span" })).toBeInTheDocument();
  });

  it("filters my questions by status", async () => {
    signIn(me());
    serve({ ...PAYSLIPS, "/me/payroll/preferences": preferences(), "/me/payroll/payslip-questions": { total: 1, items: [myQuestion()] } });
    render(<MyPayslipsRoute />);
    const section = (await screen.findByRole("heading", { name: "My questions" })).closest("section") as HTMLElement;
    fireEvent.change(within(section).getByLabelText("Show"), { target: { value: "OPEN" } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/me/payroll/payslip-questions", { params: { status: "OPEN", skip: 0, limit: 20 } }));
  });

  it("shows a deep-linked question that isn't mine as not found", async () => {
    signIn(me());
    mockSearch = new URLSearchParams("modal=payslip-question&id=99");
    serve({ ...PAYSLIPS, "/me/payroll/preferences": preferences(), "/me/payroll/payslip-questions": { total: 0, items: [] }, "/me/payroll/payslip-questions/99": notFound("Question") });
    render(<MyPayslipsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Payslip question" });
    expect(await within(dialog).findByText("Question not found")).toBeInTheDocument();
  });

  it("surfaces a stale close with the conflict banner", async () => {
    signIn(me());
    serve({ ...PAYSLIPS, "/me/payroll/preferences": preferences(), "/me/payroll/payslip-questions": { total: 1, items: [myQuestion()] } });
    mockPost.mockRejectedValue(payrollError(409, { detail: "The question was changed by someone else. Reload it.", code: "ROW_VERSION_CONFLICT" }));
    render(<MyPayslipsRoute />);
    fireEvent.click(await screen.findByRole("button", { name: /Close question/ }));
    expect(await screen.findByText("Someone else changed this")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ "Why this amount?" */

describe("Why this amount? on the employee's payslip", () => {
  it("shows the engine's explanation for lines that have one, and nothing for lines without", async () => {
    signIn(me());
    mockParams = { id: "5" };
    const base = content();
    const detail = payslipDetail({
      content: content({ earnings: [{ ...base.earnings[0], explanation: "Monthly basic for 30 of 30 paid days." }, { ...base.earnings[1], explanation: null }] }),
    });
    serve({ ...PAYSLIPS, "/me/payroll/payslips/5": detail, "/me/payroll/preferences": preferences() , "/me/payroll/payslip-questions": { total: 0, items: [] } });
    render(<MyPayslipPageRoute />);
    const why = await screen.findByRole("button", { name: "Why this amount? Basic" });
    expect(screen.queryByRole("button", { name: "Why this amount? House rent allowance" })).not.toBeInTheDocument();
    expect(screen.queryByText("Monthly basic for 30 of 30 paid days.")).not.toBeInTheDocument();
    fireEvent.click(why);
    expect(why).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Monthly basic for 30 of 30 paid days.")).toBeInTheDocument();
  });

  it("explains lines in the My Salary breakdown too", async () => {
    signIn(me({ [P.PAYROLL_PAYSLIP_READ]: ["SELF"] }));
    mockPath = "/me/salary";
    const base = content();
    serve({
      "/me/payroll/payslips": { total: 1, items: [payslip()] },
      "/me/payroll/payslips/5": payslipDetail({ content: content({ deductions: [{ ...base.deductions[1], explanation: "Tax on projected annual income." }] }) }),
      "/me/payroll/payments": { items: [period()], years: [2026] },
      "/me/payroll/preferences": preferences(),
    });
    render(<MySalaryRoute />);
    fireEvent.click(await screen.findByRole("button", { name: /^Deductions/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Why this amount? Income tax" }));
    expect(screen.getByText("Tax on projected annual income.")).toBeInTheDocument();
  });

  it("takes the next pay date from the pay calendar in the preferences", async () => {
    signIn(me({ [P.PAYROLL_PAYSLIP_READ]: ["SELF"] }));
    mockPath = "/me/salary";
    serve({
      "/me/payroll/payslips": { total: 1, items: [payslip()] },
      "/me/payroll/payslips/5": payslipDetail(),
      "/me/payroll/payments": { items: [], years: [] },
      "/me/payroll/preferences": preferences(),
    });
    render(<MySalaryRoute />);
    const line = await screen.findByText(/Next pay date:/);
    expect(plain(line.textContent)).toMatch(/31.*\(pay calendar\)/);
  });
});

/* ------------------------------------------------------------------ bank wizard */

describe("Bank accounts with the employer's bank settings", () => {
  const BANK = {
    "/me/payroll/bank-accounts": { total: 1, items: [account()] },
    "/me/payroll/bank-change-requests": { total: 0, items: [] },
    "/payroll/uploads/limits": { max_upload_bytes: 10485760, kinds: {} },
    "/payroll/step-up": { active: true, method: "TOTP", verified_at: null, expires_at: null, available_methods: ["TOTP"] },
  };
  beforeEach(() => {
    mockPath = "/me/bank-accounts";
  });

  it("hides Add account and says HR maintains it when self-service is off", async () => {
    signIn(me());
    const prefs = preferences();
    serve({ ...BANK, "/me/payroll/preferences": { ...prefs, bank_accounts: { ...prefs.bank_accounts, self_service_enabled: false } } });
    render(<MyBankAccountsRoute />);
    expect(await screen.findByText("HR updates your bank account")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add account/ })).not.toBeInTheDocument();
  });

  it("pre-fills the country and pay currency and asks which account to replace at the maximum", async () => {
    signIn(me());
    mockSearch = new URLSearchParams("modal=add-bank");
    const prefs = preferences();
    serve({
      ...BANK,
      "/me/payroll/bank-accounts": { total: 2, items: [account(), account({ id: 6, account_masked: "••••1111", bank_name: "Axis Bank", allocation: { type: "PERCENT", value: "30", order: 1 } })] },
      "/me/payroll/preferences": { ...prefs, bank_accounts: { ...prefs.bank_accounts, split_payments_enabled: true, max_accounts_per_payee: 2, effective_max_accounts: 2 } },
    });
    render(<MyBankAccountsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Add bank account" });
    await waitFor(() => expect(within(dialog).getByLabelText(/Country of the bank account/)).toHaveValue("IN"));
    expect(within(dialog).getByLabelText(/Account currency/)).toHaveValue("INR");
    fireEvent.change(within(dialog).getByLabelText(/Account holder's name/), { target: { value: "Asha Rao" } });
    fireEvent.change(within(dialog).getByLabelText(/^Account number/), { target: { value: "123456789012" } });
    fireEvent.change(within(dialog).getByLabelText(/^IFSC/), { target: { value: "HDFC0001234" } });
    fireEvent.change(within(dialog).getByLabelText(/^Account type/), { target: { value: "SAVINGS" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await within(dialog).findByText(/You already have 2 accounts, the most your employer allows/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Replaces/), { target: { value: "6" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await within(dialog).findByRole("button", { name: "Skip and continue" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Skip and continue" }));
    expect(await within(dialog).findByText(/cooling-off\) period of 48 hours/)).toBeInTheDocument();
  });

  it("never offers a split when the employer turned split payments off", async () => {
    signIn(me());
    mockSearch = new URLSearchParams("modal=add-bank");
    serve({
      ...BANK,
      "/me/payroll/bank-accounts": { total: 1, items: [account({ allocation: { type: "PERCENT", value: "100", order: 0 } })] },
      "/me/payroll/preferences": preferences(),
    });
    render(<MyBankAccountsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Add bank account" });
    await waitFor(() => expect(within(dialog).getByLabelText(/Country of the bank account/)).toHaveValue("IN"));
    expect(within(dialog).queryByText("How much goes to this account?")).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ loan limits */

describe("Loan application with the live policy limits", () => {
  const LOANS = { "/me/payroll/loans": { total: 1, items: [loan()] } };
  beforeEach(() => {
    mockPath = "/me/loans";
  });

  it("shows the limits and the person's usage, and checks amount and term as they type", async () => {
    signIn(me());
    mockSearch = new URLSearchParams("modal=new-loan");
    serve({ ...LOANS, "/me/payroll/loan-policy": loanPolicy() });
    mockPost.mockResolvedValue({ id: 9, status: "PENDING_APPROVAL", row_version: 1, approval_request_id: 1, issues: [] });
    render(<MyLoansRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Apply for a loan or advance" });
    const limits = await within(dialog).findByRole("region", { name: "Your limits" });
    expect(plain(limits.textContent)).toMatch(/2,00,000\.00|200,000\.00/);
    expect(within(limits).getByText("24 months")).toBeInTheDocument();
    expect(within(limits).getByText("6 months (you: 18)")).toBeInTheDocument();
    expect(within(limits).getByText("0 of 1")).toBeInTheDocument();
    expect(within(limits).getByText("None")).toBeInTheDocument();
    expect(within(dialog).getByText(/At least 50% of your net pay/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/^Amount \(INR\)/), { target: { value: "250000" } });
    expect(await within(dialog).findByText(/The most you can apply for is/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Repay over/), { target: { value: "30" } });
    expect(within(dialog).getByText("Your policy allows at most 24 months.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(mockPost).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/^Amount \(INR\)/), { target: { value: "150000" } });
    fireEvent.change(within(dialog).getByLabelText(/Repay over/), { target: { value: "12" } });
    expect(within(dialog).queryByText(/The most you can apply for is/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/me/payroll/loans", { kind: "LOAN", amount: { amount: "150000.00", currency: "INR" }, tenure: 12, purpose: null }));
  });

  it("says when advances are switched off and sends nothing", async () => {
    signIn(me());
    mockSearch = new URLSearchParams("modal=new-loan");
    serve({ ...LOANS, "/me/payroll/loan-policy": loanPolicy() });
    render(<MyLoansRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Apply for a loan or advance" });
    await within(dialog).findByRole("region", { name: "Your limits" });
    fireEvent.click(within(dialog).getByRole("radio", { name: /Salary advance/ }));
    expect(await within(dialog).findByText("Not offered right now")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Amount \(INR\)/), { target: { value: "1000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("warns about service length and open loans, and states an unknown maximum honestly", async () => {
    signIn(me());
    mockSearch = new URLSearchParams("modal=new-loan");
    const policy = loanPolicy();
    serve({
      ...LOANS,
      "/me/payroll/loan-policy": {
        ...policy,
        loan: { ...policy.loan, limits: { ...policy.loan.limits!, max_amount: null }, usage: { open: 1, service_months: 3 } },
      },
    });
    render(<MyLoansRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Apply for a loan or advance" });
    const limits = await within(dialog).findByRole("region", { name: "Your limits" });
    expect(within(limits).getByText("Worked out from your pay when you apply")).toBeInTheDocument();
    expect(within(limits).getByText("You need 6 months of service to apply.")).toBeInTheDocument();
    expect(within(limits).getByText("You already have the most open loans your policy allows.")).toBeInTheDocument();
  });

  it("falls back to the server's answer when the policy preview can't be read", async () => {
    signIn(me());
    mockSearch = new URLSearchParams("modal=new-loan");
    serve({ ...LOANS, "/me/payroll/loan-policy": serverError(), "/payroll/reimbursement-claim-types": { employee_id: 42, date: "2026-10-22", enabled: true, currency: "INR", status: null, policy: null, claim_types: [] } });
    render(<MyLoansRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Apply for a loan or advance" });
    await waitFor(() => expect(within(dialog).getByLabelText(/^Amount \(INR\)/)).toBeInTheDocument());
    expect(within(dialog).queryByRole("region", { name: "Your limits" })).not.toBeInTheDocument();
  });
});
