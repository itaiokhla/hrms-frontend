import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import InstructionRoute from "@/app/(app)/payroll/payments/instructions/[id]/page";
import ReconciliationPage from "@/app/(app)/payroll/payments/reconciliation/page";
import { payrollError } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { fundingOption, instruction, me, routes, signIn, statement } from "./fixtures";

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
const mockHttpGet = jest.fn();
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return { ...actual, http: { ...actual.http, get: (...a: unknown[]) => mockHttpGet(...a) } };
});

const RECONCILER = me({ [P.PAYROLL_PAYMENT_RECONCILE]: ["LEGAL_ENTITY"] });
const APPROVER = me({ [P.PAYROLL_PAYMENT_APPROVE]: ["COMPANY"] });
const SHA = "e".repeat(64);

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockParams = {};
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = jest.fn(() => "blob:proof");
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = jest.fn();
});

function reconRoutes(extra: Record<string, unknown> = {}) {
  return routes({
    "/payroll/reconciliation-matches": { total: 0, items: [] },
    "/payroll/bank-statements": { total: 2, items: [statement(), statement({ id: 4, funding_account_id: 9, file_name: "other.csv" })] },
    "/payroll/reconciliation/overdue": { as_of: "2026-11-05", items: [] },
    "/payroll/funding-accounts/options": { items: [fundingOption(), fundingOption({ id: 6, name: "Old payroll", status: "INACTIVE", active: false })] },
    ...extra,
  });
}

describe("Funding accounts for payment users (masked options)", () => {
  it("names the accounts of statements from the options list, and keeps #id outside the viewer's scope", async () => {
    signIn(RECONCILER);
    mockSearch = new URLSearchParams("tab=statements");
    mockGet.mockImplementation(reconRoutes());
    render(<ReconciliationPage />);
    const table = await screen.findByRole("table", { name: "Imported statements" });
    await waitFor(() => expect(within(table).getByText("Payroll — HDFC · ••••7788")).toBeInTheDocument());
    expect(within(table).getByText("Funding account #9")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/payroll/funding-accounts/options", { params: { include_inactive: true } });
    // The manage-only list is never asked for by a reconciler.
    expect(mockGet).not.toHaveBeenCalledWith("/payroll/funding-accounts", expect.anything());
  });

  it("offers only active accounts, with their entity, when importing a statement", async () => {
    signIn(RECONCILER);
    mockSearch = new URLSearchParams("modal=import-statement");
    mockGet.mockImplementation(reconRoutes());
    render(<ReconciliationPage />);
    const dialog = await screen.findByRole("dialog", { name: "Import bank statement" });
    expect(await within(dialog).findByRole("option", { name: "Payroll — HDFC · INR · ••••7788 · Acme India Pvt Ltd" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("option", { name: /Old payroll/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Your role can't list funding accounts/)).not.toBeInTheDocument();
  });

  it("falls back to ids from earlier statements when the options can't be read", async () => {
    signIn(RECONCILER);
    mockSearch = new URLSearchParams("modal=import-statement");
    mockGet.mockImplementation(reconRoutes({ "/payroll/funding-accounts/options": payrollError(403, { detail: "Forbidden" }) }));
    render(<ReconciliationPage />);
    const dialog = await screen.findByRole("dialog", { name: "Import bank statement" });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/payroll/funding-accounts/options", { params: { include_inactive: true } }));
    expect(await within(dialog).findByRole("option", { name: "Funding account #5" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "Funding account #9" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("option", { name: /Payroll — HDFC/ })).not.toBeInTheDocument();
  });
});

describe("Proof of a manual payment (view and download)", () => {
  const proof = (overrides: Record<string, unknown> = {}) => ({
    id: 31, instruction_id: 903, method: "CHEQUE", evidence_reference: "CHQ-000123", evidence_name: "cheque.pdf", evidence_mime: "application/pdf", evidence_sha256: SHA,
    note: null, status: "PENDING_REVIEW", submitted_by_user_id: 55, reviewed_by_user_id: null, reviewed_at: null, review_note: null, row_version: 1, created_at: "2026-10-22T09:00:00", ...overrides,
  });
  const row = { ...instruction({ id: 903, status: "SUBMITTED", submission_channel: "MANUAL_OFFLINE" }), manual_proofs: [proof()], replaced_by_instruction_ids: [] };
  const serveInstruction = () =>
    mockGet.mockImplementation(routes({ "/payroll/payment-instructions/903": row, "/payroll/payment-instructions/903/events": { instruction: row, events: [] } }));

  it("shows the proof inline for a reconciler after checking its hash", async () => {
    signIn(RECONCILER);
    mockParams = { id: "903" };
    serveInstruction();
    mockHttpGet.mockResolvedValue({ data: new Blob(["%PDF"], { type: "application/pdf" }), headers: { "content-type": "application/pdf", "x-proof-sha256": SHA, "content-disposition": 'inline; filename="cheque.pdf"' } });
    render(<InstructionRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "View proof cheque.pdf" }));
    await waitFor(() => expect(mockHttpGet).toHaveBeenCalledWith("/payroll/manual-settlements/31/file", { responseType: "blob" }));
    expect(await screen.findByTitle("Proof of manual payment: cheque.pdf")).toHaveAttribute("src", "blob:proof");
    expect(screen.getByText("Opening the proof was recorded in the audit log.")).toBeInTheDocument();
  });

  it("never embeds a file served as anything other than a PDF, PNG or JPEG (it would run in the app's origin)", async () => {
    signIn(RECONCILER);
    mockParams = { id: "903" };
    serveInstruction();
    mockHttpGet.mockResolvedValue({ data: new Blob(["<script>x</script>"], { type: "text/html" }), headers: { "content-type": "text/html", "x-proof-sha256": SHA } });
    render(<InstructionRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "View proof cheque.pdf" }));
    expect(await screen.findByText(/can't be previewed here/)).toBeInTheDocument();
    expect(screen.queryByTitle("Proof of manual payment: cheque.pdf")).not.toBeInTheDocument();
    expect(screen.queryByAltText("Proof of manual payment: cheque.pdf")).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("refuses to show a file whose hash differs from the uploaded proof", async () => {
    signIn(RECONCILER);
    mockParams = { id: "903" };
    serveInstruction();
    mockHttpGet.mockResolvedValue({ data: new Blob(["x"]), headers: { "content-type": "application/pdf", "x-proof-sha256": "f".repeat(64) } });
    render(<InstructionRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "View proof cheque.pdf" }));
    expect(await screen.findByText(/doesn't match the proof that was uploaded/)).toBeInTheDocument();
    expect(screen.queryByTitle("Proof of manual payment: cheque.pdf")).not.toBeInTheDocument();
  });

  it("downloads the proof as an attachment", async () => {
    signIn(RECONCILER);
    mockParams = { id: "903" };
    serveInstruction();
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    mockHttpGet.mockResolvedValue({ data: new Blob(["%PDF"]), headers: { "content-type": "application/pdf", "x-proof-sha256": SHA, "content-disposition": 'attachment; filename="cheque.pdf"' } });
    render(<InstructionRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "Download proof cheque.pdf" }));
    await waitFor(() => expect(mockHttpGet).toHaveBeenCalledWith("/payroll/manual-settlements/31/file?download=true", { responseType: "blob" }));
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
  });

  it("shows the server's refusal (changed file) and never offers the file to non-reconcilers", async () => {
    signIn(RECONCILER);
    mockParams = { id: "903" };
    serveInstruction();
    mockHttpGet.mockRejectedValue(payrollError(409, { detail: "The stored proof does not match the file that was uploaded.", code: "FILE_HASH_MISMATCH" }));
    const first = render(<InstructionRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "View proof cheque.pdf" }));
    expect(await screen.findByText("The stored proof does not match the file that was uploaded.")).toBeInTheDocument();
    first.unmount();

    signIn(APPROVER);
    serveInstruction();
    render(<InstructionRoute />);
    expect(await screen.findByText("Waiting for a second reviewer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View proof/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download proof/ })).not.toBeInTheDocument();
  });
});
