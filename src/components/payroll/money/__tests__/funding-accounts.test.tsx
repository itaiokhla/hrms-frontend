import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import FundingAccountsPage from "@/app/(app)/payroll/payments/funding-accounts/page";
import FundingAccountRoute from "@/app/(app)/payroll/payments/funding-accounts/[id]/page";
import InstructionRoute from "@/app/(app)/payroll/payments/instructions/[id]/page";
import { P } from "@/lib/permissions.generated";

import { validateFundingDraft } from "../FundingAccounts";
import { conflict, funding, instruction, me, notFound, plain, routes, signIn } from "./fixtures";

const mockPush = jest.fn();
let mockSearch = new URLSearchParams();
let mockParams: Record<string, string> = {};
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/payroll/payments/funding-accounts",
  useSearchParams: () => mockSearch,
  useParams: () => mockParams,
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

const MANAGER = me({ [P.PAYROLL_FUNDING_ACCOUNTS_MANAGE]: ["COMPANY"] });
const MANAGER_FULL = me({ [P.PAYROLL_FUNDING_ACCOUNTS_MANAGE]: ["COMPANY"], [P.PAYROLL_BANK_DETAILS_READ_FULL]: ["COMPANY"] });

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockParams = {};
});

describe("validateFundingDraft", () => {
  const ok = { entity: "1", name: "Payroll", purpose: "PAYROLL", holder: "Acme", country: "IN", currency: "INR", numberKind: "account" as const, number: "123", routingKey: "ifsc", routingCode: "", bankName: "", signatories: [7], sandbox: false };
  it("accepts a complete draft and explains each missing field", () => {
    expect(validateFundingDraft(ok)).toEqual({});
    const e = validateFundingDraft({ ...ok, entity: "", country: "IND", currency: "RS", number: " ", signatories: [] });
    expect(Object.keys(e).sort()).toEqual(["country", "currency", "entity", "number", "signatories"]);
  });
});

describe("Funding accounts", () => {
  it("is denied without payroll:funding_accounts:manage", () => {
    signIn(me({ [P.PAYROLL_PAYMENT_PREPARE]: ["COMPANY"] }));
    render(<FundingAccountsPage />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("lists accounts masked, with Reveal only for read_full", async () => {
    signIn(MANAGER);
    mockGet.mockImplementation(routes({ "/payroll/funding-accounts": { items: [funding()] } }));
    const { unmount } = render(<FundingAccountsPage />);
    const table = await screen.findByRole("table", { name: "Funding accounts" });
    expect(within(table).getByText("Payroll — HDFC")).toBeInTheDocument();
    expect(within(table).getByText("••••7788")).toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: /Reveal/ })).not.toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/payroll/funding-accounts", { params: { status: "ACTIVE" } });
    unmount();

    signIn(MANAGER_FULL);
    render(<FundingAccountsPage />);
    const again = await screen.findByRole("table", { name: "Funding accounts" });
    expect(within(again).getByRole("button", { name: /Reveal/ })).toBeInTheDocument();
  });

  it("shows an empty state with the next action and an error with retry", async () => {
    signIn(MANAGER);
    mockGet.mockImplementation(routes({ "/payroll/funding-accounts": { items: [] } }));
    const { unmount } = render(<FundingAccountsPage />);
    expect(await screen.findByText("No funding account yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Add funding account/ }).length).toBe(2);
    unmount();

    mockGet.mockRejectedValue(new Error("boom"));
    render(<FundingAccountsPage />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    mockGet.mockImplementation(routes({ "/payroll/funding-accounts": { items: [funding()] } }));
    fireEvent.click(retry);
    expect(await screen.findByRole("table", { name: "Funding accounts" })).toBeInTheDocument();
  });

  it("validates the add form inline before sending anything (deep link)", async () => {
    signIn(MANAGER);
    mockSearch = new URLSearchParams("modal=funding-account");
    mockGet.mockImplementation(routes({ "/payroll/funding-accounts": { items: [] } }));
    render(<FundingAccountsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Add funding account" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add account" }));
    expect((await within(dialog).findAllByText("Enter the account holder's name.")).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("Choose at least one signatory.").length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("creates an account with one idempotency key and the signatories entered", async () => {
    signIn(MANAGER);
    mockSearch = new URLSearchParams("modal=funding-account");
    mockGet.mockImplementation(routes({ "/payroll/funding-accounts": { items: [] } }));
    mockPost.mockResolvedValue(funding({ id: 9 }));
    render(<FundingAccountsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Add funding account" });
    const type = (label: RegExp, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    type(/Legal entity/, "1");
    type(/^Name/, "Payroll — HDFC");
    type(/Account holder/, "Acme India Pvt Ltd");
    type(/^Country/, "in");
    type(/^Currency/, "inr");
    type(/^Account number/, "5010 0012 347788");
    type(/^Routing code$/, "hdfc0000001");
    type(/Signatories/, "7, 11");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add account" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const [url, body, options] = mockPost.mock.calls[0];
    expect(url).toBe("/payroll/legal-entities/1/funding-accounts");
    expect(body).toEqual({
      name: "Payroll — HDFC",
      purpose: "PAYROLL",
      signatory_user_ids: [7, 11],
      formats: ["GENERIC_CSV"],
      provider_profile: null,
      details: { holder_name: "Acme India Pvt Ltd", country: "IN", currency: "INR", account_number: "50100012347788", iban: null, routing: { ifsc: "HDFC0000001" }, bank_name: null },
    });
    expect(options.idempotencyKey).toEqual(expect.any(String));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/payroll/payments/funding-accounts/9"));
  });
});

describe("Funding account page", () => {
  it("turns SANDBOX off by clearing the provider profile and sends the row version", async () => {
    signIn(MANAGER);
    mockParams = { id: "5" };
    mockGet.mockImplementation(routes({ "/payroll/funding-accounts/5": funding({ provider_profile: "SANDBOX", sandbox: true }) }));
    mockPatch.mockResolvedValue(funding());
    render(<FundingAccountRoute />);
    const form = await screen.findByRole("form", { name: "Edit funding account" });
    expect(screen.getAllByText("Sandbox").length).toBeGreaterThan(0);
    fireEvent.click(within(form).getByRole("checkbox", { name: /SANDBOX provider/ }));
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith("/payroll/funding-accounts/5", { name: "Payroll — HDFC", purpose: "PAYROLL", signatory_user_ids: [7], provider_profile: "", row_version: 2 }),
    );
  });

  it("shows a conflict banner on a stale save", async () => {
    signIn(MANAGER);
    mockParams = { id: "5" };
    mockGet.mockImplementation(routes({ "/payroll/funding-accounts/5": funding() }));
    mockPatch.mockRejectedValue(conflict("The funding account was changed by someone else."));
    render(<FundingAccountRoute />);
    const form = await screen.findByRole("form", { name: "Edit funding account" });
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Someone else changed this")).toBeInTheDocument();
    expect(mockPatch.mock.calls[0][1]).not.toHaveProperty("provider_profile");
  });

  it("deactivates only with a reason", async () => {
    signIn(MANAGER);
    mockParams = { id: "5" };
    mockGet.mockImplementation(routes({ "/payroll/funding-accounts/5": funding() }));
    mockPost.mockResolvedValue(funding({ status: "INACTIVE" }));
    render(<FundingAccountRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate…" }));
    const dialog = await screen.findByRole("dialog", { name: "Deactivate funding account" });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Account closed at the bank" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/funding-accounts/5/deactivate", { reason: "Account closed at the bank", row_version: 2 }));
  });

  it("shows forbidden or unknown accounts as not found", async () => {
    signIn(MANAGER);
    mockParams = { id: "404" };
    mockGet.mockImplementation(async () => {
      throw notFound("Funding account");
    });
    render(<FundingAccountRoute />);
    expect(await screen.findByText("Funding account not found")).toBeInTheDocument();
  });
});

describe("Payment instruction page", () => {
  const APPROVER = me({ [P.PAYROLL_PAYMENT_APPROVE]: ["COMPANY"] });

  it("never says Paid for a manual submission without evidence and shows its events", async () => {
    signIn(APPROVER);
    mockParams = { id: "901" };
    const row = { ...instruction({ status: "SUBMITTED", submission_channel: "MANUAL_UPLOAD", evidence_status: "UNVERIFIED" }), manual_proofs: [], replaced_by_instruction_ids: [] };
    mockGet.mockImplementation(
      routes({
        "/payroll/payment-instructions/901": row,
        "/payroll/payment-instructions/901/events": {
          instruction: row,
          events: [{ id: 1, event_status: "SUBMITTED", outcome: "APPLIED", from_status: "FILE_GENERATED", to_status: "SUBMITTED", source: "USER", external_event_id: null, evidence_ref: null, sandbox: false, actor_user_id: 11, details: {}, at: "2026-10-21T12:00:00" }],
        },
      }),
    );
    render(<InstructionRoute />);
    expect(await screen.findByRole("heading", { name: "Payment PI000000901" })).toBeInTheDocument();
    expect(await screen.findByText("Submitted for manual payment — unverified")).toBeInTheDocument();
    expect(screen.queryByText(/^Paid$/)).not.toBeInTheDocument();
    expect(plain(document.body.textContent)).toMatch(/1,23,456\.78|123,456\.78/);
    expect(await screen.findByText(/→ Submitted/)).toBeInTheDocument();
  });

  const RECON = me({ [P.PAYROLL_PAYMENT_RECONCILE]: ["COMPANY"] });
  const proof = (overrides: Record<string, unknown> = {}) => ({
    id: 31, instruction_id: 903, method: "CHEQUE", evidence_reference: "CHQ-000123", evidence_name: "cheque.pdf", evidence_mime: "application/pdf", evidence_sha256: "e".repeat(64),
    note: null, status: "PENDING_REVIEW", submitted_by_user_id: 55, reviewed_by_user_id: null, reviewed_at: null, review_note: null, row_version: 1, created_at: "2026-10-22T09:00:00", ...overrides,
  });

  it("lets a second reconciler approve proof of a manual payment, never the uploader", async () => {
    signIn(RECON);
    mockParams = { id: "903" };
    const row = { ...instruction({ id: 903, status: "SUBMITTED", submission_channel: "MANUAL_OFFLINE" }), manual_proofs: [proof()], replaced_by_instruction_ids: [] };
    mockGet.mockImplementation(routes({ "/payroll/payment-instructions/903": row, "/payroll/payment-instructions/903/events": { instruction: row, events: [] } }));
    mockPost.mockResolvedValue({ id: 31, status: "APPROVED", instruction_id: 903, row_version: 2 });
    const { unmount } = render(<InstructionRoute />);
    expect(await screen.findByText("Waiting for a second reviewer")).toBeInTheDocument();
    // A proof is already pending, so no second upload is offered.
    expect(screen.queryByRole("button", { name: /Upload proof of manual payment/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve proof" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/manual-settlements/31/approve", { row_version: 1 }));
    unmount();

    const mine = { ...row, manual_proofs: [proof({ submitted_by_user_id: 7 })] };
    mockGet.mockImplementation(routes({ "/payroll/payment-instructions/903": mine, "/payroll/payment-instructions/903/events": { instruction: mine, events: [] } }));
    render(<InstructionRoute />);
    expect(await screen.findByText("You uploaded this proof, so another person reviews it.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve proof" })).not.toBeInTheDocument();
  });

  it("uploads proof of a manual payment with a reference and file (multipart)", async () => {
    signIn(RECON);
    mockParams = { id: "903" };
    const row = { ...instruction({ id: 903, status: "SUBMITTED", submission_channel: "MANUAL_OFFLINE" }), manual_proofs: [], replaced_by_instruction_ids: [] };
    mockGet.mockImplementation(routes({ "/payroll/payment-instructions/903": row, "/payroll/payment-instructions/903/events": { instruction: row, events: [] } }));
    mockPost.mockResolvedValue(proof());
    render(<InstructionRoute />);
    fireEvent.click(await screen.findByRole("button", { name: /Upload proof of manual payment/ }));
    const dialog = await screen.findByRole("dialog", { name: "Upload proof of manual payment" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload proof" }));
    expect((await within(dialog).findAllByText("Give the cheque number, receipt or transfer reference.")).length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/^Reference/), { target: { value: "CHQ-000123" } });
    fireEvent.change(within(dialog).getByLabelText("Proof file"), { target: { files: [new File(["%PDF-1.4"], "cheque.pdf", { type: "application/pdf" })] } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload proof" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const [url, form] = mockPost.mock.calls[0];
    expect(url).toBe("/payroll/payment-instructions/903/manual-settle");
    expect((form as FormData).get("method")).toBe("CHEQUE");
    expect((form as FormData).get("reference")).toBe("CHQ-000123");
    expect((form as FormData).get("row_version")).toBe("2");
  });

  it("releases a hold only with a reason (approvers)", async () => {
    signIn(APPROVER);
    mockParams = { id: "902" };
    const row = { ...instruction({ id: 902, status: "ON_HOLD", status_reason: "MISSING_BANK_ACCOUNT" }), manual_proofs: [], replaced_by_instruction_ids: [] };
    mockGet.mockImplementation(routes({ "/payroll/payment-instructions/902": row, "/payroll/payment-instructions/902/events": { instruction: row, events: [] } }));
    mockPost.mockResolvedValue({ id: 902, status: "READY" });
    render(<InstructionRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "Release hold…" }));
    const dialog = await screen.findByRole("dialog", { name: "Release the hold" });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Account added and verified" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Release hold" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/payment-instructions/902/release-hold", { reason: "Account added and verified", row_version: 2 }));
  });
});
