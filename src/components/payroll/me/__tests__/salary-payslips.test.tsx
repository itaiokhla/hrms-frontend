import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import MySalaryRoute from "@/app/(app)/me/salary/page";
import MyPayslipPageRoute from "@/app/(app)/me/payslips/[id]/page";
import MyPayslipsRoute from "@/app/(app)/me/payslips/page";
import MyTaxRoute from "@/app/(app)/me/tax/page";
import { P } from "@/lib/permissions.generated";

import { nextPayDate, paymentSteps } from "../MySalary";
import { payslipMarkers, shareOf } from "../shared";
import { content, me, notFound, payslip, payslipDetail, period, plain, SELF_GRANTS, serverError, signIn } from "./fixtures";

const mockPush = jest.fn();
let mockSearch = new URLSearchParams();
let mockParams: Record<string, string> = {};
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/me/payslips",
  useSearchParams: () => mockSearch,
  useParams: () => mockParams,
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
jest.mock("@/lib/payroll/api", () => {
  const actual = jest.requireActual("@/lib/payroll/api");
  return {
    ...actual,
    payrollApi: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), put: (...a: unknown[]) => mockPut(...a), patch: jest.fn(), delete: jest.fn() },
  };
});
const mockHttpGet = jest.fn();
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return { ...actual, http: { get: (...a: unknown[]) => mockHttpGet(...a) } };
});

type Routes = Record<string, unknown>;
/** Answer GETs by path; an Error value rejects. Unknown paths reject with 404 so nothing is invented. */
function serve(routes: Routes) {
  mockGet.mockImplementation((url: string) => {
    if (url in routes) {
      const value = routes[url];
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    return Promise.reject(notFound("Route"));
  });
}

const COMPENSATION = {
  employee: { id: 42, employee_code: "E0042", name: "Asha Rao" },
  current: {
    id: 1, employee_id: 42, assignment_id: 1,
    structure: { id: 2, code: "STD", name: "Standard IN", type: "CTC", version: 1, version_id: 2, version_status: "ACTIVE" },
    pay_basis_amount: { amount: "1200000.00", currency: "INR" }, currency: "INR", fx_rule: null,
    effective_from: "2026-04-01", effective_to: null, reason: "HIRE", status: "ACTIVE", note: null, split_period: false,
    previous_assignment_id: null, revision_cycle_id: null, legacy_salary_structure_id: null, row_version: 1,
    created_by_user_id: 1, approved_by_user_id: 1, approved_at: null, created_at: "2026-03-30T10:00:00",
  },
  breakdown: {
    currency: "INR", periods_per_year: 12, lines: [],
    totals: { ctc: { monthly: { amount: "100000.00", currency: "INR" }, annual: { amount: "1200000.00", currency: "INR" } } },
    statutory: { lines: [], verified: false, label: "Compliance not verified", note: "" }, issues: [], ok: true,
  },
  scheduled: [], pending: [], history: [], without_salary: false, self_service: true,
};

const SALARY_ROUTES: Routes = {
  "/me/payroll/payslips": { total: 1, items: [payslip()] },
  "/me/payroll/payslips/5": payslipDetail(),
  "/me/payroll/payments": { items: [period()], years: [2026] },
  "/payroll/employees/42/compensation": COMPENSATION,
  "/me/payroll/documents": { total: 0, items: [] },
  "/me/payroll/document-requests": { items: [] },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockParams = {};
});

/* ------------------------------------------------------------------ helpers */

describe("self-service helpers", () => {
  it("marks unopened payslips New, opened ones Viewed and corrections Revised", () => {
    expect(payslipMarkers(payslip())).toEqual(["NEW"]);
    expect(payslipMarkers(payslip({ status: "VIEWED", first_viewed_at: "2026-11-29T10:00:00" }))).toEqual(["VIEWED"]);
    expect(payslipMarkers(payslip({ version: 2, supersedes_document_id: 4 }))).toEqual(["NEW", "REVISED"]);
  });

  it("computes the take-home share from decimal strings without floating point money", () => {
    expect(shareOf("14590.00", "97000.00")).toBe(15);
    expect(shareOf("0.00", "97000.00")).toBe(0);
    expect(shareOf("5", "0")).toBe(0);
  });

  it("lights Paid only from verified evidence", () => {
    const unverified = period().instructions[0];
    expect(paymentSteps(unverified).map((s) => [s.key, s.done])).toEqual([["SCHEDULED", true], ["PROCESSING", true], ["PAID", false]]);
    expect(paymentSteps(unverified)[1].label).toBe("Submitted — unverified");
    const paid = { ...unverified, label: { key: "PAID", text: "Paid on 2026-11-30", badge: null }, settled_at: "2026-11-30T08:00:00" };
    expect(paymentSteps(paid)[2]).toMatchObject({ done: true, at: "2026-11-30T08:00:00" });
    expect(paymentSteps(undefined).map((s) => s.done)).toEqual([true, false, false]);
  });

  it("takes the next pay date only from a scheduled payment after today", () => {
    expect(nextPayDate([{ pay_date: "2026-10-31" }, { pay_date: "2026-11-30" }, { pay_date: "2026-09-30" }], "2026-10-22")).toBe("2026-10-31");
    expect(nextPayDate([{ pay_date: "2026-09-30" }, { pay_date: null }], "2026-10-22")).toBeNull();
  });
});

/* ------------------------------------------------------------------ My Salary */

describe("My Salary", () => {
  it("shows the net pay hero, gross and deductions as exact amounts with honesty badges", async () => {
    signIn(me());
    serve(SALARY_ROUTES);
    render(<MySalaryRoute />);
    expect(await screen.findByText("Net pay")).toBeInTheDocument();
    const text = plain(document.body.textContent);
    expect(text).toMatch(/82,410\.00/);
    expect(text).toMatch(/97,000\.00/);
    expect(text).toMatch(/14,590\.00/);
    expect(screen.getAllByText("FIXTURE — not law").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Hide amounts" })).toBeInTheDocument();
  });

  it("keeps employer contributions in their own expander, apart from net pay", async () => {
    signIn(me());
    serve(SALARY_ROUTES);
    render(<MySalaryRoute />);
    const toggle = await screen.findByRole("button", { name: /Paid by your employer \(not in net pay\)/ });
    expect(screen.queryByText("Employer PF")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(await screen.findByText("Employer PF")).toBeInTheDocument();
    expect(screen.getByText(/not part of your take-home pay/)).toBeInTheDocument();
  });

  it("shows the payment as unverified with the masked account, never as paid", async () => {
    signIn(me());
    serve(SALARY_ROUTES);
    render(<MySalaryRoute />);
    const payment = await screen.findByRole("region", { name: "Payment" });
    await waitFor(() => expect(within(payment).getAllByText(/Submitted for manual payment — unverified/).length).toBeGreaterThan(0));
    expect(plain(payment.textContent)).toMatch(/HDFC Bank ••••4321/);
    const progress = within(payment).getByRole("list", { name: "Payment progress" });
    expect(within(progress).getByText("Paid").parentElement).toHaveTextContent("(not yet)");
  });

  it("shows my package CTC from the compensation API", async () => {
    signIn(me());
    serve(SALARY_ROUTES);
    render(<MySalaryRoute />);
    expect(await screen.findByText("My package")).toBeInTheDocument();
    await waitFor(() => expect(plain(document.body.textContent)).toMatch(/12,00,000\.00|1,200,000\.00/));
    expect(screen.getByText(/Standard IN/)).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/payroll/employees/42/compensation");
  });

  it("skips the package for people without compensation access", async () => {
    signIn(me({ [P.PAYROLL_PAYSLIP_READ]: ["SELF"] }));
    serve(SALARY_ROUTES);
    render(<MySalaryRoute />);
    await screen.findByText("Net pay");
    expect(screen.queryByText("My package")).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalledWith("/payroll/employees/42/compensation");
  });

  it("explains an empty first month with a next action", async () => {
    signIn(me());
    serve({ ...SALARY_ROUTES, "/me/payroll/payslips": { total: 0, items: [] }, "/me/payroll/payments": { items: [], years: [] } });
    render(<MySalaryRoute />);
    expect(await screen.findByText("No payslip yet")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "My bank accounts" })[0]).toHaveAttribute("href", "/me/bank-accounts");
  });

  it("offers Try again when the payslips cannot load", async () => {
    signIn(me());
    serve({ ...SALARY_ROUTES, "/me/payroll/payslips": serverError() });
    render(<MySalaryRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mockGet.mock.calls.filter(([u]) => u === "/me/payroll/payslips")).toHaveLength(2));
  });

  it("explains a missing employee profile instead of denying access", () => {
    signIn(me(SELF_GRANTS, null));
    render(<MySalaryRoute />);
    expect(screen.getByText("No employee profile linked")).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("denies people without any pay self-service grant", () => {
    signIn(me({ [P.TASK_READ]: ["SELF"] }));
    render(<MySalaryRoute />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("links My Tasks and My Overtime only when they are enabled for the person", async () => {
    signIn(me({ [P.PAYROLL_PAYSLIP_READ]: ["SELF"], [P.TASK_READ]: ["SELF"] }));
    serve(SALARY_ROUTES);
    render(<MySalaryRoute />);
    await screen.findByText("Net pay");
    expect(screen.getByRole("link", { name: /My Tasks/ })).toHaveAttribute("href", "/tasks");
    expect(screen.queryByRole("link", { name: /My Overtime/ })).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ My Payslips */

describe("My Payslips", () => {
  it("lists payslips with New and Revised chips and exact net amounts", async () => {
    signIn(me());
    serve({ ...SALARY_ROUTES, "/me/payroll/payslips": { total: 2, items: [payslip(), payslip({ id: 4, period_label: "October 2026", status: "VIEWED", first_viewed_at: "2026-10-30T10:00:00", version: 2, supersedes_document_id: 2, net: { amount: "80000.50", currency: "INR" } })] } });
    render(<MyPayslipsRoute />);
    const list = await screen.findByRole("list", { name: "Payslips" });
    expect(within(list).getByText("New")).toBeInTheDocument();
    expect(within(list).getByText("Viewed")).toBeInTheDocument();
    expect(within(list).getByText("Revised")).toBeInTheDocument();
    expect(plain(list.textContent)).toMatch(/80,000\.50/);
    expect(within(list).getAllByRole("link", { name: /Full page/ })[0]).toHaveAttribute("href", "/me/payslips/5");
  });

  it("opens the deep-linked viewer modal with the payslip, full-page link and download", async () => {
    signIn(me());
    mockSearch = new URLSearchParams("modal=payslip&id=5");
    serve({ ...SALARY_ROUTES, "/me/payroll/payslips/5/download": { url: "/api/v1/payroll/downloads/tok", expires_at: "", expires_in_seconds: 300 } });
    render(<MyPayslipsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Payslip · November 2026" });
    await waitFor(() => expect(plain(dialog.textContent)).toMatch(/82,410\.00/));
    expect(within(dialog).getByRole("link", { name: /Open full page/ })).toHaveAttribute("href", "/me/payslips/5");
    expect(within(dialog).getByRole("heading", { name: "Paid by your employer" })).toBeInTheDocument();
    expect(plain(dialog.textContent)).toMatch(/HDFC Bank ••••4321/);

    mockHttpGet.mockResolvedValue({ data: new Blob(["%PDF"]), headers: { "content-disposition": 'attachment; filename="p.pdf"' } });
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = jest.fn(() => "blob:x");
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = jest.fn();
    fireEvent.click(within(dialog).getByRole("button", { name: /Download PDF/ }));
    await waitFor(() => expect(mockHttpGet).toHaveBeenCalledWith("/payroll/downloads/tok", { responseType: "blob" }));
    expect(mockGet).toHaveBeenCalledWith("/me/payroll/payslips/5/download");
  });

  it("shows an empty year with a next action", async () => {
    signIn(me());
    serve({ ...SALARY_ROUTES, "/me/payroll/payslips": { total: 0, items: [] } });
    render(<MyPayslipsRoute />);
    expect(await screen.findByText("No payslips yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Check your bank account" })).toHaveAttribute("href", "/me/bank-accounts");
  });

  it("validates the document password and saves it through the step-up aware API", async () => {
    signIn(me());
    mockSearch = new URLSearchParams("modal=payslip-password");
    serve({ ...SALARY_ROUTES, "/me/payroll/payslip-password": { set: false, set_at: null } });
    mockPut.mockResolvedValue({ set: true, set_at: "2026-11-30T10:00:00" });
    render(<MyPayslipsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Set document password" });
    expect(await within(dialog).findByText("No password is set yet.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/New password/), { target: { value: "short" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save password" }));
    expect(await within(dialog).findByText("Use 8 to 40 characters.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/New password/), { target: { value: "longenough1" } });
    fireEvent.change(within(dialog).getByLabelText(/Repeat the password/), { target: { value: "longenough1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save password" }));
    await waitFor(() => expect(mockPut).toHaveBeenCalledWith("/me/payroll/payslip-password", { password: "longenough1" }));
  });

  it("shows another person's (forbidden) payslip as not found on the full page", async () => {
    signIn(me());
    mockParams = { id: "99" };
    serve({});
    render(<MyPayslipPageRoute />);
    expect(await screen.findByText("Payslip not found")).toBeInTheDocument();
  });

  it("renders the full payslip page with a revised notice for a superseded payslip", async () => {
    signIn(me());
    mockParams = { id: "5" };
    serve({ "/me/payroll/payslips/5": payslipDetail({ status: "SUPERSEDED", content: content({ title_key: "REVISED_PAYSLIP", replaces: "PS/ACME/2026-27/0001" }) }) });
    render(<MyPayslipPageRoute />);
    expect(await screen.findByText("A revised payslip replaces this one")).toBeInTheDocument();
    expect(screen.getAllByText(/Revised payslip/).length).toBeGreaterThan(0);
    expect(plain(document.body.textContent)).toMatch(/Eighty-two thousand/);
  });

  it("is denied without payslip access", () => {
    signIn(me({ [P.PAYROLL_LOANS_READ]: ["SELF"] }));
    render(<MyPayslipsRoute />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ My Tax */

describe("My Tax", () => {
  it("says plainly that tax self-service is not available yet", () => {
    signIn(me());
    render(<MyTaxRoute />);
    expect(screen.getByText("Not available for your country yet")).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
