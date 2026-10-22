import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import BankDetailsPage from "@/app/(app)/payroll/bank-details/page";
import BankAccountRoute from "@/app/(app)/payroll/bank-details/accounts/[id]/page";
import BankChangeRoute from "@/app/(app)/payroll/bank-details/changes/[id]/page";
import { P } from "@/lib/permissions.generated";

import { ME_ID, account, change, conflict, me, notFound, routes, signIn } from "./fixtures";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSearch = new URLSearchParams();
let mockParams: Record<string, string> = {};
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  usePathname: () => "/payroll/bank-details",
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

const READER = me({ [P.PAYROLL_BANK_DETAILS_READ_MASKED]: ["COMPANY"] });
const APPROVER = me({ [P.PAYROLL_BANK_DETAILS_READ_MASKED]: ["COMPANY"], [P.PAYROLL_BANK_DETAILS_APPROVE]: ["COMPANY"] });
const FULL = me({ [P.PAYROLL_BANK_DETAILS_READ_MASKED]: ["COMPANY"], [P.PAYROLL_BANK_DETAILS_READ_FULL]: ["COMPANY"] });

function queues(items = [account()]) {
  return routes({
    "/payroll/bank-accounts": (_u: string, o?: { params?: Record<string, unknown> }) => (o?.params?.verification_status === "PENDING" ? { total: items.length, items } : { total: 0, items: [] }),
    "/payroll/bank-change-requests": { total: 1, items: [change()] },
    "/payroll/bank-accounts/31": account(),
    "/payroll/bank-change-requests/77": change(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockParams = {};
});

describe("Bank Details workspace", () => {
  it("is denied to people without bank-detail permissions", () => {
    signIn(me({ [P.PAYROLL_RUN_READ]: ["COMPANY"] }));
    render(<BankDetailsPage />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("is denied to self-service holders only (SELF scope)", () => {
    signIn(me({ [P.PAYROLL_BANK_DETAILS_READ_MASKED]: ["SELF"] }, 142));
    render(<BankDetailsPage />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("lists accounts waiting for verification masked, with no Reveal without read_full", async () => {
    signIn(READER);
    mockGet.mockImplementation(queues());
    render(<BankDetailsPage />);
    const table = await screen.findByRole("table", { name: "Accounts waiting for verification" });
    expect(within(table).getByText("Asha Rao")).toBeInTheDocument();
    expect(within(table).getByText("••••4321")).toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: /Reveal/ })).not.toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/payroll/bank-accounts", { params: { verification_status: "PENDING", skip: 0, limit: 50 } });
    // The tab badge comes from the same query as the list.
    expect(screen.getByRole("tab", { name: /Verification\s*1/ })).toBeInTheDocument();
  });

  it("reveals the full number only with a reason of 10+ characters and read_full", async () => {
    signIn(FULL);
    mockGet.mockImplementation(queues());
    mockPost.mockResolvedValue({ id: 31, holder_name: "Asha Rao", account_number: "50100012344321", iban: null, routing: {}, account_masked: "••••4321" });
    render(<BankDetailsPage />);
    const table = await screen.findByRole("table", { name: "Accounts waiting for verification" });
    fireEvent.click(within(table).getByRole("button", { name: /Reveal/ }));
    const dialog = await screen.findByRole("dialog", { name: /Reveal account number/ });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "check" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reveal" }));
    expect(await within(dialog).findByText(/at least 10 characters/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Verifying a returned payment" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reveal" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/bank-accounts/31/reveal", { reason: "Verifying a returned payment" }, { idempotencyKey: false }));
    expect(await screen.findByText("50100012344321")).toBeInTheDocument();
    expect(screen.getByText(/Hides in 30 s/)).toBeInTheDocument();
  });

  it("shows a calm empty state", async () => {
    signIn(READER);
    mockGet.mockImplementation(queues([]));
    render(<BankDetailsPage />);
    expect(await screen.findByText("Nothing waiting for verification")).toBeInTheDocument();
  });

  it("shows an error with retry", async () => {
    signIn(READER);
    mockGet.mockImplementation(async (url: string) => {
      if (url === "/payroll/bank-accounts") throw new Error("boom");
      return { total: 0, items: [] };
    });
    render(<BankDetailsPage />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    mockGet.mockImplementation(queues());
    fireEvent.click(retry);
    expect(await screen.findByRole("table", { name: "Accounts waiting for verification" })).toBeInTheDocument();
  });
});

describe("Approve bank change (deep link)", () => {
  it("shows the side-by-side diff with masked numbers, risk flags and a required acknowledgement", async () => {
    signIn(APPROVER);
    mockSearch = new URLSearchParams("tab=changes&modal=bank-change&id=77");
    mockGet.mockImplementation(queues());
    mockPost.mockResolvedValue({ id: 77, status: "APPLIED" });
    render(<BankDetailsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Bank change request #77" });
    expect(await within(dialog).findByRole("link", { name: /Open full page/ })).toHaveAttribute("href", "/payroll/bank-details/changes/77");
    // Both numbers stay masked; the change is labelled in words.
    expect(within(dialog).getAllByText("••••4321").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("••••9876").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("Changed").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("New browser or device").length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve…" }));
    const approve = within(dialog).getByRole("button", { name: "Approve change" });
    expect(approve).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /checked the risk flags/ }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Skip the cooling-off period/ }));
    fireEvent.click(approve);
    expect(await within(dialog).findByText(/Say why the waiting period is skipped/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Why skip it/), { target: { value: "Confirmed by phone" } });
    fireEvent.click(approve);
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/bank-change-requests/77/approve", { waive_cooling_off_reason: "Confirmed by phone" }));
  });

  it("requires a reason to reject", async () => {
    signIn(APPROVER);
    mockSearch = new URLSearchParams("modal=bank-change&id=77");
    mockGet.mockImplementation(queues());
    mockPost.mockResolvedValue({ id: 77, status: "REJECTED" });
    render(<BankDetailsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Bank change request #77" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Reject…" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject change" }));
    expect(await within(dialog).findByText(/Give a reason/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: "Employee did not request this" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject change" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/bank-change-requests/77/reject", { remarks: "Employee did not request this" }));
  });

  it("shows the conflict banner when the change was decided elsewhere", async () => {
    signIn(APPROVER);
    mockSearch = new URLSearchParams("modal=bank-change&id=77");
    mockGet.mockImplementation(queues());
    mockPost.mockRejectedValue(conflict("This bank change is not awaiting approval."));
    render(<BankDetailsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Bank change request #77" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Approve…" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /checked the risk flags/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve change" }));
    expect(await within(dialog).findByText("Someone else changed this")).toBeInTheDocument();
  });

  it("never offers the decision to the person who entered the change", async () => {
    signIn(APPROVER);
    mockSearch = new URLSearchParams("modal=bank-change&id=77");
    mockGet.mockImplementation(routes({ "/payroll/bank-accounts": { total: 0, items: [] }, "/payroll/bank-change-requests": { total: 0, items: [] }, "/payroll/bank-change-requests/77": change({ requested_by_user_id: ME_ID, channel: "HR" }) }));
    render(<BankDetailsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Bank change request #77" });
    expect(await within(dialog).findByText(/You entered this change/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Approve…" })).not.toBeInTheDocument();
  });

  it("hides decisions from read-only staff", async () => {
    signIn(READER);
    mockSearch = new URLSearchParams("modal=bank-change&id=77");
    mockGet.mockImplementation(queues());
    render(<BankDetailsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Bank change request #77" });
    await within(dialog).findAllByText("New browser or device");
    expect(within(dialog).queryByRole("button", { name: "Approve…" })).not.toBeInTheDocument();
  });
});

describe("Bank account", () => {
  it("lets an approver open the document and verify from it", async () => {
    signIn(APPROVER);
    mockSearch = new URLSearchParams("modal=account&id=31");
    mockGet.mockImplementation(queues());
    mockPost.mockResolvedValue({ id: 31, status: "PENDING_APPROVAL", verification_status: "VERIFIED" });
    render(<BankDetailsPage />);
    const dialog = await screen.findByRole("dialog", { name: /Asha Rao · ••••4321/ });
    expect(within(dialog).getByText("cheque.pdf")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "View document" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Verify from this document/ }));
    const confirm = await screen.findByRole("dialog", { name: "Verify this account" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Verify" }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/payroll/bank-accounts/31/verify", { method: "DOCUMENT_REVIEW", decision: "PASS", evidence_id: 501 }, { rowVersion: 3 }),
    );
  });

  it("requires a reason to fail verification", async () => {
    signIn(APPROVER);
    mockSearch = new URLSearchParams("modal=account&id=31");
    mockGet.mockImplementation(queues());
    mockPost.mockResolvedValue({ id: 31, status: "PENDING_APPROVAL", verification_status: "FAILED" });
    render(<BankDetailsPage />);
    const dialog = await screen.findByRole("dialog", { name: /Asha Rao/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Fail with reason" }));
    const confirm = await screen.findByRole("dialog", { name: "Fail verification" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Fail verification" }));
    expect(await within(confirm).findByText(/Give a reason/)).toBeInTheDocument();
    fireEvent.change(within(confirm).getByLabelText(/Reason/), { target: { value: "Name on cheque differs" } });
    fireEvent.click(within(confirm).getByRole("button", { name: "Fail verification" }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/payroll/bank-accounts/31/verify", { method: "DOCUMENT_REVIEW", decision: "FAIL", reason: "Name on cheque differs" }, { rowVersion: 3 }),
    );
  });

  it("does not open documents for masked-only readers", async () => {
    signIn(READER);
    mockParams = { id: "31" };
    mockGet.mockImplementation(queues());
    render(<BankAccountRoute />);
    expect(await screen.findByText(/only approvers and people allowed to see full details open them/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View document" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Verify from this document/ })).not.toBeInTheDocument();
  });

  it("shows held payments and the cooling-off countdown honestly", async () => {
    signIn(APPROVER);
    mockParams = { id: "31" };
    const soon = new Date(Date.now() + 26 * 3600 * 1000).toISOString();
    mockGet.mockImplementation(
      routes({ "/payroll/bank-accounts/31": account({ status: "ACTIVE", verification_status: "REQUIRES_REVIEW", payment_hold: true, hold_reason: "DUPLICATE_FINGERPRINT", cooling_off: true, usable_from: soon, risk_flags: [{ code: "DUPLICATE_ACCOUNT", open: true, detail: "The same account is registered for another payee" }] }) }),
    );
    render(<BankAccountRoute />);
    expect(await screen.findByText("Payments to this account are held")).toBeInTheDocument();
    expect(screen.getByText(/Cooling-off: usable for payments in 1 d/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear review" })).toBeInTheDocument();
    expect(screen.getByText("Same account as another payee")).toBeInTheDocument();
  });

  it("shows forbidden or unknown accounts as not found", async () => {
    signIn(READER);
    mockParams = { id: "999" };
    mockGet.mockImplementation(async () => {
      throw notFound("Bank account");
    });
    render(<BankAccountRoute />);
    expect(await screen.findByText("Bank account not found")).toBeInTheDocument();
  });

  it("has a full page for each change request", async () => {
    signIn(APPROVER);
    mockParams = { id: "77" };
    mockGet.mockImplementation(queues());
    render(<BankChangeRoute />);
    expect(await screen.findByRole("heading", { name: "Bank change request #77" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve…" })).toBeInTheDocument();
  });
});
