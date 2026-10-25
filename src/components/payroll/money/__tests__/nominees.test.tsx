import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import NomineesPage from "@/app/(app)/payroll/payments/nominees/page";
import { P } from "@/lib/permissions.generated";

import { formatShare, validateNomineeDraft, accountState, type CaseNominees, type Nominee } from "../NomineesApi";
import { account, change, conflict, me, notFound, routes, signIn } from "./fixtures";

const mockPush = jest.fn();
let mockSearch = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/payroll/payments/nominees",
  useSearchParams: () => mockSearch,
  useParams: () => ({}),
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
jest.mock("@/lib/payroll/api", () => {
  const actual = jest.requireActual("@/lib/payroll/api");
  return {
    ...actual,
    payrollApi: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), patch: (...a: unknown[]) => mockPatch(...a), delete: jest.fn() },
  };
});

const READER = me({ [P.PAYROLL_BANK_DETAILS_READ_MASKED]: ["COMPANY"] });
const EDITOR = me({ [P.PAYROLL_BANK_DETAILS_READ_MASKED]: ["COMPANY"], [P.PAYROLL_BANK_DETAILS_EDIT]: ["COMPANY"] });

function nominee(overrides: Partial<Nominee> = {}): Nominee {
  return {
    id: 11,
    employee_id: 142,
    final_settlement_case_id: 5,
    kind: "NOMINEE",
    name: "Asha Nair",
    relationship: "Spouse",
    proof_ref: "Succession certificate SC/2026/114",
    share_percent: "60",
    country: "IN",
    email_masked: null,
    status: "ACTIVE",
    ended_at: null,
    ended_reason: null,
    created_by_user_id: 9,
    created_at: "2026-10-22T09:00:00",
    row_version: 2,
    bank_accounts: [],
    has_usable_account: false,
    ...overrides,
  };
}

function caseView(overrides: Partial<CaseNominees> = {}): CaseNominees {
  return {
    case: { id: 5, employee_id: 142, termination_type: "DEATH", status: "READY", currency: "INR", run_id: null },
    summary: { active: 1, share_total: "60", complete: false, issues: [{ code: "SHARES_INCOMPLETE", message: "the shares add up to 60 percent, not 100" }], editable: true },
    items: [nominee()],
    ...overrides,
  };
}

const nomineeAccount = (over = {}) => account({ id: 41, payee_type: "NOMINEE", payee_id: 11, employee_id: null, nominee_id: 11, holder_name: "Asha Nair", account_masked: "••••6789", status: "ACTIVE", verification_status: "VERIFIED", ...over });

const caseRoutes = (view: CaseNominees, extra: Record<string, unknown> = {}) => ({
  "/payroll/nominees/cases/5": view,
  "/payroll/nominees/bank-change-requests": { total: 0, items: [] },
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
});

describe("validateNomineeDraft and helpers", () => {
  const ok = { name: "Asha Nair", relationship: "Spouse", proof_ref: "Form 2", share_percent: "40", country: "IN", email: "" };
  it("accepts a complete draft and explains each problem", () => {
    expect(validateNomineeDraft(ok, 60)).toEqual({});
    expect(Object.keys(validateNomineeDraft({ ...ok, name: "A", relationship: "", proof_ref: "x", share_percent: "abc", country: "India", email: "no" }, 0)).sort()).toEqual([
      "country",
      "email",
      "name",
      "proof_ref",
      "relationship",
      "share_percent",
    ]);
  });
  it("keeps the shares of one settlement at 100 percent, to six decimals", () => {
    expect(validateNomineeDraft({ ...ok, share_percent: "40.000001" }, 60).share_percent).toMatch(/at most 100 percent/);
    expect(validateNomineeDraft({ ...ok, share_percent: "33.333334" }, 66.666666)).toEqual({});
    expect(validateNomineeDraft({ ...ok, share_percent: "0" }, 0).share_percent).toMatch(/more than 0/);
    expect(validateNomineeDraft({ ...ok, share_percent: "10.1234567" }, 0).share_percent).toMatch(/6 decimals/);
    expect(validateNomineeDraft({ ...ok, share_percent: "100.5" }, 0).share_percent).toMatch(/at most 100/);
  });
  it("prints shares without trailing zeros and describes an account's state", () => {
    expect(formatShare("33.333300")).toBe("33.3333");
    expect(formatShare("100.000000")).toBe("100");
    expect(accountState(nomineeAccount()).label).toBe("Ready to pay");
    expect(accountState(nomineeAccount({ status: "PENDING_APPROVAL", verification_status: "PENDING" })).label).toBe("Awaiting approval");
    expect(accountState(nomineeAccount({ cooling_off: true })).label).toBe("Cooling-off");
    expect(accountState(nomineeAccount({ payment_hold: true })).tone).toBe("danger");
    expect(accountState(nomineeAccount({ verification_status: "PENDING" })).label).toBe("Not verified yet");
  });
});

describe("Nominees page", () => {
  it("is denied without a bank-details permission", () => {
    signIn(me({ [P.PAYROLL_PAYMENT_PREPARE]: ["COMPANY"] }));
    render(<NomineesPage />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("lists only settlements after a death and links to each case", async () => {
    signIn(READER);
    const row = (id: number, type: string, name: string) => ({ id, employee: { id: 100 + id, code: `E${id}`, name }, termination_type: type, status: "READY", last_working_day: "2026-10-12", currency: "INR", due_date: null, overdue: false });
    mockGet.mockImplementation(routes({ "/payroll/final-settlements": { total: 3, items: [row(5, "DEATH", "Ivan Test"), row(6, "RESIGNATION", "Emma Test"), row(7, "DEATH", "Ola Test")] } }));
    render(<NomineesPage />);
    const table = await screen.findByRole("table", { name: "Final settlements after a death" });
    expect(within(table).getByText("Ivan Test")).toBeInTheDocument();
    expect(within(table).getByText("Ola Test")).toBeInTheDocument();
    expect(within(table).queryByText("Emma Test")).not.toBeInTheDocument();
    expect(within(table).getByRole("link", { name: "Open the nominees of Ivan Test" })).toHaveAttribute("href", "/payroll/payments/nominees?case=5");
  });

  it("shows an empty state and a retryable error for the case list", async () => {
    signIn(READER);
    mockGet.mockImplementation(routes({ "/payroll/final-settlements": { total: 0, items: [] } }));
    const { unmount } = render(<NomineesPage />);
    expect(await screen.findByText("No settlement after a death")).toBeInTheDocument();
    unmount();
    mockGet.mockRejectedValue(new Error("boom"));
    render(<NomineesPage />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    mockGet.mockImplementation(routes({ "/payroll/final-settlements": { total: 0, items: [] } }));
    fireEvent.click(retry);
    expect(await screen.findByText("No settlement after a death")).toBeInTheDocument();
  });
});

describe("Case nominees", () => {
  it("shows the shares meter, the missing-shares notice and masked accounts; a reader cannot change anything", async () => {
    signIn(READER);
    mockSearch = new URLSearchParams("case=5");
    mockGet.mockImplementation(routes(caseRoutes(caseView({ items: [nominee({ bank_accounts: [nomineeAccount()], has_usable_account: true })] }))));
    render(<NomineesPage />);
    const table = await screen.findByRole("table", { name: "Nominees and legal heirs" });
    expect(within(table).getByText("Asha Nair")).toBeInTheDocument();
    expect(within(table).getByText("60%")).toBeInTheDocument();
    expect(within(table).getByText("••••6789")).toBeInTheDocument();
    expect(within(table).getByText("Ready to pay")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /Shares given/ })).toHaveAttribute("aria-valuenow", "60");
    expect(screen.getByText("The settlement run cannot be created yet")).toBeInTheDocument();
    expect(screen.getByText(/shares add up to 60 percent, not 100/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add nominee/ })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /Change Asha Nair/ })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /End Asha Nair/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/50100123456789/);
  });

  it("tells the editor what to do when nobody is recorded yet", async () => {
    signIn(EDITOR);
    mockSearch = new URLSearchParams("case=5");
    mockGet.mockImplementation(
      routes(caseRoutes(caseView({ items: [], summary: { active: 0, share_total: "0", complete: false, issues: [{ code: "NO_NOMINEES", message: "at least one nominee must receive the settlement" }], editable: true } }))),
    );
    render(<NomineesPage />);
    expect(await screen.findByText("No nominee recorded yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Add nominee/ }).length).toBe(2);
  });

  it("adds a nominee: validates inline, then sends the share as a string with one idempotency key", async () => {
    signIn(EDITOR);
    mockSearch = new URLSearchParams("case=5");
    mockGet.mockImplementation(routes(caseRoutes(caseView())));
    mockPost.mockResolvedValue({ id: 12, final_settlement_case_id: 5, status: "ACTIVE", row_version: 1 });
    render(<NomineesPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: /Add nominee/ }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add a nominee or legal heir" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add nominee" }));
    expect((await within(dialog).findAllByText("Enter the person's full legal name.")).length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
    const type = (label: RegExp, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    type(/^Full name/, "Bram Nair");
    type(/^Relationship/, "Son");
    type(/^Share of the settlement/, "40.000001");
    type(/^Country/, "IN");
    type(/^Proof document/, "Court order 77/2026");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add nominee" }));
    expect((await within(dialog).findAllByText(/add up to at most 100 percent \(60 is already given\)/)).length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
    type(/^Share of the settlement/, "40");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add nominee" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const [url, body, options] = mockPost.mock.calls[0];
    expect(url).toBe("/payroll/nominees");
    expect(body).toEqual({ final_settlement_case_id: 5, kind: "NOMINEE", name: "Bram Nair", relationship: "Son", proof_ref: "Court order 77/2026", share_percent: "40", country: "IN", email: null });
    expect(options.idempotencyKey).toEqual(expect.any(String));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add a nominee or legal heir" })).not.toBeInTheDocument());
  });

  it("shows the server's refusal when the shares exceed 100", async () => {
    signIn(EDITOR);
    mockSearch = new URLSearchParams("case=5");
    mockGet.mockImplementation(routes(caseRoutes(caseView())));
    mockPost.mockRejectedValue(conflict("The shares of the nominees of one settlement add up to at most 100 percent."));
    render(<NomineesPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: /Add nominee/ }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add a nominee or legal heir" });
    const type = (label: RegExp, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    type(/^Full name/, "Bram Nair");
    type(/^Relationship/, "Son");
    type(/^Share of the settlement/, "40");
    type(/^Country/, "IN");
    type(/^Proof document/, "Court order 77/2026");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add nominee" }));
    expect(await within(dialog).findByText(/add up to at most 100 percent/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Add a nominee or legal heir" })).toBeInTheDocument();
  });

  it("changes a nominee with the row version and locks name, kind and country once there is a bank account", async () => {
    signIn(EDITOR);
    mockSearch = new URLSearchParams("case=5");
    mockGet.mockImplementation(routes(caseRoutes(caseView({ items: [nominee({ bank_accounts: [nomineeAccount()] })] }))));
    mockPatch.mockResolvedValue({ id: 11, status: "ACTIVE", row_version: 3 });
    render(<NomineesPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Change Asha Nair" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Change Asha Nair" });
    expect(within(dialog).getByText("This person has a bank account")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Full name/)).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/^Share of the settlement/), { target: { value: "55.5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
    expect(mockPatch.mock.calls[0][0]).toBe("/payroll/nominees/11");
    expect(mockPatch.mock.calls[0][1]).toEqual({ relationship: "Spouse", proof_ref: "Succession certificate SC/2026/114", share_percent: "55.5" });
    expect(mockPatch.mock.calls[0][2]).toEqual({ rowVersion: 2 });
  });

  it("ends a nominee only with a reason", async () => {
    signIn(EDITOR);
    mockSearch = new URLSearchParams("case=5");
    mockGet.mockImplementation(routes(caseRoutes(caseView())));
    mockPost.mockResolvedValue({ id: 11, status: "ENDED", row_version: 3 });
    render(<NomineesPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "End Asha Nair" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "End Asha Nair" });
    fireEvent.click(within(dialog).getByRole("button", { name: "End nominee" }));
    expect(await within(dialog).findByText(/Give a reason/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Renounced the share in writing" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "End nominee" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/nominees/11/end", { reason: "Renounced the share in writing" }, { rowVersion: 2 }));
  });

  it("freezes the nominees once the settlement run exists and shows the payments per payee", async () => {
    signIn(EDITOR);
    mockSearch = new URLSearchParams("case=5");
    const frozen = caseView({
      case: { id: 5, employee_id: 142, termination_type: "DEATH", status: "IN_RUN", currency: "INR", run_id: 12 },
      summary: { active: 2, share_total: "100", complete: true, issues: [], editable: false },
      items: [nominee({ bank_accounts: [nomineeAccount()] }), nominee({ id: 12, name: "Bram Nair", relationship: "Son", share_percent: "40", bank_accounts: [] })],
    });
    mockGet.mockImplementation(
      routes(
        caseRoutes(frozen, {
          "/payroll/nominees/cases/5/payments": {
            case_id: 5,
            obligations: [
              {
                obligation_id: 3,
                status: "OPEN",
                amount: { amount: "100000.01", currency: "INR" },
                instructions: [
                  { id: 1, reference: "PI1", status: "READY", reason: null, amount: { amount: "60000.01", currency: "INR" }, nominee_id: 11, share_percent: "60", account_masked: "••••6701", holder_name_masked: "A*** N***" },
                  { id: 2, reference: "PI2", status: "NOT_READY", reason: "MISSING_BANK_ACCOUNT", amount: { amount: "40000.00", currency: "INR" }, nominee_id: 12, share_percent: "40", account_masked: null, holder_name_masked: null },
                ],
              },
            ],
          },
        }),
      ),
    );
    render(<NomineesPage />);
    expect(await screen.findByText("The nominees are frozen")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add nominee/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End Asha Nair" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Replace bank account of Asha Nair/ }).length).toBeGreaterThan(0);
    const payments = await screen.findByRole("table", { name: /Settlement payments/ });
    expect(within(payments).getByText("Asha Nair")).toBeInTheDocument();
    expect(within(payments).getByText("••••6701")).toBeInTheDocument();
    expect(within(payments).getByText("No account yet")).toBeInTheDocument();
    expect(within(payments).getByText("Missing bank account")).toBeInTheDocument();
    expect(within(payments).getByText("Bram Nair")).toBeInTheDocument();
  });

  it("submits a bank account with country-driven fields and never echoes the number", async () => {
    signIn(EDITOR);
    mockSearch = new URLSearchParams("case=5");
    mockGet.mockImplementation(routes(caseRoutes(caseView())));
    mockPost.mockResolvedValue({ id: 70, change_request_id: 70, bank_account_id: 44, status: "PENDING_APPROVAL", approval_request_id: 9, risk_flags: ["NOMINEE_PAYEE"] });
    render(<NomineesPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Add bank account of Asha Nair" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Bank account of Asha Nair" });
    expect(within(dialog).getByLabelText(/^Account holder's name/)).toHaveValue("Asha Nair");
    expect(within(dialog).getByLabelText(/^IFSC/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/^IBAN/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit for approval" }));
    expect((await within(dialog).findAllByText(/Enter the account number/)).length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
    const type = (label: RegExp, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    type(/^Account currency/, "INR");
    type(/^Account number/, "5010 0123 456789");
    type(/^IFSC/, "hdfc0001234");
    type(/^Account type/, "SAVINGS");
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const [url, body, options] = mockPost.mock.calls[0];
    expect(url).toBe("/payroll/nominees/11/bank-accounts");
    expect(body).toMatchObject({ holder_name: "Asha Nair", country: "IN", currency: "INR", account_number: "50100123456789", iban: null, routing: { ifsc: "HDFC0001234" }, account_type: "SAVINGS" });
    expect(options.idempotencyKey).toEqual(expect.any(String));
    const done = await within(dialog).findByText("Submitted for approval");
    expect(done).toBeInTheDocument();
    expect(within(dialog).getByText(/••••6789/)).toBeInTheDocument();
    expect(within(dialog).getByText(/cannot be waived/)).toBeInTheDocument();
    expect(dialog.textContent).not.toContain("50100123456789");
  });

  it("lists nominee bank changes waiting for approval with a review action", async () => {
    signIn(me({ [P.PAYROLL_BANK_DETAILS_READ_MASKED]: ["COMPANY"], [P.PAYROLL_BANK_DETAILS_APPROVE]: ["COMPANY"] }));
    mockSearch = new URLSearchParams("case=5");
    const pending = change({
      id: 77,
      payee_type: "NOMINEE",
      employee_id: null,
      nominee_id: 11,
      kind: "ADD",
      replaces_account_id: null,
      channel: "HR",
      risk_flags: [{ code: "NOMINEE_PAYEE", detail: "check the proof" }],
      nominee: { id: 11, kind: "NOMINEE", name: "Asha Nair", relationship: "Spouse", proof_ref: "Succession certificate SC/2026/114", share_percent: "60", country: "IN", status: "ACTIVE", employee_id: 142, final_settlement_case_id: 5 },
      before: [],
    });
    mockGet.mockImplementation(
      routes({
        "/payroll/nominees/cases/5": caseView(),
        "/payroll/nominees/bank-change-requests": { total: 1, items: [pending] },
        "/payroll/bank-change-requests/77": pending,
      }),
    );
    render(<NomineesPage />);
    const table = await screen.findByRole("table", { name: "Bank changes waiting for approval" });
    expect(within(table).getByText("Nominee of a deceased employee")).toBeInTheDocument();
    expect(within(table).getByText("••••9876")).toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: "Review the account of Asha Nair" }));
    const dialog = await screen.findByRole("dialog", { name: "Bank change request #77" });
    expect(await within(dialog).findByText(/Payee \(nominee of a deceased employee\)/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Proof: Succession certificate SC\/2026\/114/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve…" }));
    // The cooling-off of a nominee's account is never skipped: the option is not offered.
    await within(dialog).findByRole("form", { name: "Approve change" });
    expect(within(dialog).queryByText(/Skip the cooling-off period/)).not.toBeInTheDocument();
  });

  it("shows a case outside the person's scope as not found", async () => {
    signIn(READER);
    mockSearch = new URLSearchParams("case=99");
    mockGet.mockRejectedValue(notFound("Final settlement"));
    render(<NomineesPage />);
    expect(await screen.findByText("Final settlement not found")).toBeInTheDocument();
  });
});
