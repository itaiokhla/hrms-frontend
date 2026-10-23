import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import ReconciliationPage from "@/app/(app)/payroll/payments/reconciliation/page";
import BankStatementPage from "@/app/(app)/payroll/payments/reconciliation/statements/[id]/page";
import { P } from "@/lib/permissions.generated";

import { detectFormat, guessDelimiter, guessMapping, mappingProblems, previewCsv, splitCsvLine } from "../ImportStatement";
import { canAccept } from "../Reconciliation";
import { ME_ID, conflict, fundingOption, instruction, match, me, notFound, plain, routes, signIn, statement } from "./fixtures";

const mockPush = jest.fn();
let mockSearch = new URLSearchParams();
let mockParams: Record<string, string> = {};
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/payroll/payments/reconciliation",
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

const RECONCILER = me({ [P.PAYROLL_PAYMENT_RECONCILE]: ["COMPANY"] });
const RECONCILER_FUNDING = me({ [P.PAYROLL_PAYMENT_RECONCILE]: ["COMPANY"], [P.PAYROLL_FUNDING_ACCOUNTS_MANAGE]: ["COMPANY"] });

function queueRoutes(review = [match()], extra: Record<string, unknown> = {}) {
  return routes({
    "/payroll/reconciliation-matches": (_u: string, o?: { params?: Record<string, unknown> }) =>
      o?.params?.queue === "review" ? { total: review.length, items: review } : { total: 0, items: [] },
    "/payroll/bank-statements": { total: 1, items: [statement()] },
    "/payroll/reconciliation/overdue": { as_of: "2026-11-05", items: [] },
    "/payroll/funding-accounts/options": { items: [fundingOption()] },
    ...extra,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockParams = {};
});

/* ------------------------------------------------------------------ pure helpers */

describe("statement helpers", () => {
  it("detects CAMT.053 by namespace, root element or .xml, else CSV", () => {
    expect(detectFormat("s.xml", "")).toBe("CAMT053");
    expect(detectFormat("s.txt", '<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">')).toBe("CAMT053");
    expect(detectFormat("s.dat", "<BkToCstmrStmt>")).toBe("CAMT053");
    expect(detectFormat("s.csv", "Date,Amount,Reference")).toBe("CSV");
  });

  it("guesses the delimiter and splits quoted cells", () => {
    expect(guessDelimiter("Date;Amount;Ref")).toBe(";");
    expect(guessDelimiter("Date\tAmount")).toBe("\t");
    expect(guessDelimiter("single")).toBe(",");
    expect(splitCsvLine('2026-10-31,"1,234.50","He said ""hi"""', ",")).toEqual(["2026-10-31", "1,234.50", 'He said "hi"']);
  });

  it("previews the first rows after skipped rows and keeps amounts as text", () => {
    const p = previewCsv("Bank export\nValue Date,Debit,Credit,Reference\n2026-10-31,123456.78,,PI000000901\n\n", 1);
    expect(p.headers).toEqual(["Value Date", "Debit", "Credit", "Reference"]);
    expect(p.rows).toEqual([["2026-10-31", "123456.78", "", "PI000000901"]]);
  });

  it("guesses a mapping and never mixes one amount column with debit/credit", () => {
    expect(guessMapping(["Value Date", "Debit", "Credit", "Reference", "Beneficiary Name"])).toEqual(
      expect.objectContaining({ date: "Value Date", debit: "Debit", credit: "Credit", reference: "Reference", counterparty: "Beneficiary Name" }),
    );
    const m = guessMapping(["Date", "Amount", "Debit", "Credit"]);
    expect(m.amount).toBe("Amount");
    expect(m.debit).toBeUndefined();
  });

  it("explains mapping problems before upload", () => {
    expect(mappingProblems({})).toEqual(expect.objectContaining({ date: expect.any(String), amount: expect.any(String), currency: expect.any(String) }));
    expect(mappingProblems({ date: "D", amount: "A", debit: "X", default_currency: "INR" }).amount).toMatch(/not both/);
    expect(mappingProblems({ date: "D", debit: "X", default_currency: "INR" }).debit).toMatch(/go together/);
    expect(mappingProblems({ date: "D", amount: "A", default_currency: "inr" }).currency).toMatch(/three-letter/);
    expect(mappingProblems({ date: "D", amount: "A", currency: "Ccy" })).toEqual({});
  });

  it("offers Accept only for amount differences linked to a payment", () => {
    expect(canAccept(match())).toBe(true);
    expect(canAccept(match({ status: "UNMATCHED", reason: "NO_CANDIDATE", instruction: null }))).toBe(false);
    expect(canAccept(match({ status: "DUPLICATE", reason: "ALREADY_SETTLED" }))).toBe(false);
  });
});

/* ------------------------------------------------------------------ workspace */

describe("Reconciliation workspace", () => {
  it("is denied without payroll:payment:reconcile", () => {
    signIn(me({ [P.PAYROLL_PAYMENT_PREPARE]: ["COMPANY"] }));
    render(<ReconciliationPage />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("lists the review queue with exact string amounts and the three decisions", async () => {
    signIn(RECONCILER);
    mockGet.mockImplementation(queueRoutes());
    render(<ReconciliationPage />);
    const table = await screen.findByRole("table", { name: "Reconciliation results" });
    expect(plain(table.textContent)).toMatch(/1,23,446\.78|123,446\.78/);
    expect(plain(table.textContent)).toMatch(/1,23,456\.78|123,456\.78/);
    expect(within(table).getByText("Amount differs")).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Accept…" })).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Link…" })).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Escalate…" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Needs review\s*1/ })).toBeInTheDocument();
  });

  it("accepts a difference only with a reason, sending the row version", async () => {
    signIn(RECONCILER);
    mockGet.mockImplementation(queueRoutes());
    mockPost.mockResolvedValue({ id: 61, status: "ACCEPTED_VARIANCE" });
    render(<ReconciliationPage />);
    const table = await screen.findByRole("table", { name: "Reconciliation results" });
    fireEvent.click(within(table).getByRole("button", { name: "Accept…" }));
    const dialog = await screen.findByRole("dialog", { name: "Accept the difference" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept difference" }));
    expect((await within(dialog).findAllByText(/Give a reason/)).length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Bank charge of 10 deducted" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept difference" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/reconciliation-matches/61/accept", { reason: "Bank charge of 10 deducted", row_version: 1 }));
  });

  it("links an unmatched line to a chosen payment", async () => {
    signIn(RECONCILER);
    mockGet.mockImplementation(queueRoutes([match({ id: 62, status: "UNMATCHED", reason: "NO_CANDIDATE", instruction: null, candidate_ids: [], variance: null })]));
    mockPost.mockResolvedValue({ id: 62, status: "LINKED" });
    render(<ReconciliationPage />);
    const table = await screen.findByRole("table", { name: "Reconciliation results" });
    expect(within(table).queryByRole("button", { name: "Accept…" })).not.toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: "Link…" }));
    const dialog = await screen.findByRole("dialog", { name: "Link to a payment" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Link" }));
    expect((await within(dialog).findAllByText("Choose the payment this line settles.")).length).toBeGreaterThan(0);
    fireEvent.change(within(dialog).getByLabelText(/^Payment/), { target: { value: "903" } });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Reference typed wrong by bank" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Link" }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/payroll/reconciliation-matches/62/link", { instruction_id: 903, reason: "Reference typed wrong by bank", row_version: 1 }),
    );
  });

  it("shows the conflict banner when someone else decided the line", async () => {
    signIn(RECONCILER);
    mockGet.mockImplementation(queueRoutes());
    mockPost.mockRejectedValue(conflict("This line was already decided."));
    render(<ReconciliationPage />);
    const table = await screen.findByRole("table", { name: "Reconciliation results" });
    fireEvent.click(within(table).getByRole("button", { name: "Escalate…" }));
    const dialog = await screen.findByRole("dialog", { name: "Escalate" });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Needs the bank's confirmation" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Escalate" }));
    expect(await within(dialog).findByText("Someone else changed this")).toBeInTheDocument();
  });

  it("shows a calm empty state and an error with retry", async () => {
    signIn(RECONCILER);
    mockGet.mockImplementation(queueRoutes([]));
    const { unmount } = render(<ReconciliationPage />);
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
    unmount();

    mockGet.mockImplementation(async (url: string) => {
      if (url === "/payroll/reconciliation-matches") throw new Error("boom");
      return { total: 0, items: [] };
    });
    render(<ReconciliationPage />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    mockGet.mockImplementation(queueRoutes());
    fireEvent.click(retry);
    expect(await screen.findByRole("table", { name: "Reconciliation results" })).toBeInTheDocument();
  });

  it("lists overdue payments with business days late", async () => {
    signIn(RECONCILER);
    mockSearch = new URLSearchParams("tab=overdue");
    mockGet.mockImplementation(
      queueRoutes([], { "/payroll/reconciliation/overdue": { as_of: "2026-11-05", items: [instruction({ status: "SUBMITTED", expected_settlement_date: "2026-11-01", business_days_overdue: 3 })] } }),
    );
    render(<ReconciliationPage />);
    const table = await screen.findByRole("table", { name: "Overdue payments" });
    expect(within(table).getByText("3 business day(s)")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/payroll/reconciliation/overdue", { params: { grace: 0 } });
  });
});

/* ------------------------------------------------------------------ import modal */

describe("Import bank statement (deep link)", () => {
  it("detects CSV, guesses the mapping, uploads with the mapping and shows match results", async () => {
    signIn(RECONCILER_FUNDING);
    mockSearch = new URLSearchParams("modal=import-statement");
    mockGet.mockImplementation(queueRoutes([]));
    mockPost.mockResolvedValue({ import: statement(), duplicate: false, matches: [match({ id: 70, status: "MATCHED", reason: null, message: null, variance: null })] });
    render(<ReconciliationPage />);
    const dialog = await screen.findByRole("dialog", { name: "Import bank statement" });
    await within(dialog).findByRole("option", { name: /Payroll — HDFC · INR/ });
    // One funding account is pre-chosen once the list arrives; choose it explicitly to be sure.
    fireEvent.change(within(dialog).getByLabelText(/Funding account/), { target: { value: "5" } });
    const csv = "Value Date,Debit,Credit,Reference\n2026-10-31,123446.78,,PI000000901\n";
    const file = new File([csv], "hdfc-oct.csv", { type: "text/csv" });
    fireEvent.change(within(dialog).getByLabelText("Statement file"), { target: { files: [file] } });
    expect(await within(dialog).findByText("CSV", { selector: "strong" })).toBeInTheDocument();
    expect(await within(dialog).findByRole("columnheader", { name: "Value Date" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Import and match" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const [url, form, options] = mockPost.mock.calls[0];
    expect(url).toBe("/payroll/bank-statements/import");
    expect((form as FormData).get("funding_account_id")).toBe("5");
    expect((form as FormData).get("format")).toBe("CSV");
    expect(JSON.parse(String((form as FormData).get("mapping")))).toEqual(
      expect.objectContaining({ date: "Value Date", debit: "Debit", credit: "Credit", reference: "Reference", default_currency: "INR", delimiter: "," }),
    );
    expect(options.idempotencyKey).toEqual(expect.any(String));
    expect(await within(dialog).findByText("4 new line(s) of 4")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /Open the statement/ })).toHaveAttribute("href", "/payroll/payments/reconciliation/statements/3");
  });

  it("validates the funding account and file before uploading", async () => {
    signIn(RECONCILER_FUNDING);
    mockSearch = new URLSearchParams("modal=import-statement");
    mockGet.mockImplementation(queueRoutes([], { "/payroll/funding-accounts/options": { items: [fundingOption(), fundingOption({ id: 6, name: "Payroll — USD", currency: "USD" })] } }));
    render(<ReconciliationPage />);
    const dialog = await screen.findByRole("dialog", { name: "Import bank statement" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Import and match" }));
    expect(await within(dialog).findAllByText("Choose the funding account this statement belongs to.")).not.toHaveLength(0);
    expect(within(dialog).getAllByText("Attach the statement file.").length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("says so when the same statement was already imported", async () => {
    signIn(RECONCILER_FUNDING);
    mockSearch = new URLSearchParams("modal=import-statement");
    mockGet.mockImplementation(queueRoutes([]));
    mockPost.mockResolvedValue({ import: statement({ new_line_count: 0 }), duplicate: true, matches: [] });
    render(<ReconciliationPage />);
    const dialog = await screen.findByRole("dialog", { name: "Import bank statement" });
    await within(dialog).findByRole("option", { name: /Payroll — HDFC/ });
    fireEvent.change(within(dialog).getByLabelText(/Funding account/), { target: { value: "5" } });
    const xml = '<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt/></Document>';
    fireEvent.change(within(dialog).getByLabelText("Statement file"), { target: { files: [new File([xml], "oct.xml", { type: "application/xml" })] } });
    expect(await within(dialog).findByText("CAMT.053", { selector: "strong" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Import and match" }));
    expect(await within(dialog).findByText("Already imported")).toBeInTheDocument();
    expect((mockPost.mock.calls[0][1] as FormData).get("mapping")).toBeNull();
  });
});

/* ------------------------------------------------------------------ statement page */

describe("Bank statement page", () => {
  it("shows the statement, its hash and match results", async () => {
    signIn(RECONCILER);
    mockParams = { id: "3" };
    mockGet.mockImplementation(
      routes({
        "/payroll/bank-statements/3": statement({ rejected: [{ source_row: 9, code: "DATE_INVALID", message: "The date could not be read" }], imported_by_user_id: ME_ID }),
        "/payroll/bank-statements/3/matches": { total: 1, items: [match()] },
      }),
    );
    render(<BankStatementPage />);
    expect(await screen.findByRole("heading", { name: "hdfc-oct.csv" })).toBeInTheDocument();
    expect(screen.getByText("Row 9: The date could not be read")).toBeInTheDocument();
    expect(await screen.findByRole("table", { name: "Reconciliation results" })).toBeInTheDocument();
  });

  it("shows forbidden or unknown statements as not found", async () => {
    signIn(RECONCILER);
    mockParams = { id: "404" };
    mockGet.mockImplementation(async () => {
      throw notFound("Bank statement");
    });
    render(<BankStatementPage />);
    expect(await screen.findByText("Bank statement not found")).toBeInTheDocument();
  });
});
