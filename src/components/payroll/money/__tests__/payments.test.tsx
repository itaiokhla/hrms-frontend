import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import PayoutFilesPage from "@/app/(app)/payroll/payments/page";
import BatchPage from "@/app/(app)/payroll/payments/batches/[id]/page";
import NewBatchPage from "@/app/(app)/payroll/payments/new/page";
import InstructionRoute from "@/app/(app)/payroll/payments/instructions/[id]/page";
import { payrollError } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { totalsByCurrency } from "../PayoutBatches";
import { ME_ID, batch, conflict, fundingOption, instruction, me, notFound, plain, routes, signIn } from "./fixtures";

const mockPush = jest.fn();
let mockSearch = new URLSearchParams();
let mockParams: Record<string, string> = {};
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/payroll/payments",
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

const PREPARER = me({ [P.PAYROLL_PAYMENT_PREPARE]: ["COMPANY"] });
const APPROVER = me({ [P.PAYROLL_PAYMENT_APPROVE]: ["LEGAL_ENTITY"] });
const SIGNATORY = me({ [P.PAYROLL_PAYMENT_SUBMIT]: ["COMPANY"], [P.PAYROLL_FUNDING_ACCOUNTS_MANAGE]: ["COMPANY"] });

const RUN = { id: 12, label: "Oct 2026", run_type: "REGULAR", status: "FINALIZED", legal_entity_id: 1, currency: "INR", pay_group: { id: 3, code: "STAFF", name: "Staff Monthly" }, period: { id: 5, start: "2026-10-01", end: "2026-10-31", pay_date: "2026-10-31", status: "OPEN" } };

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockParams = {};
});

describe("totalsByCurrency", () => {
  it("sums decimal strings exactly per currency, never across currencies", () => {
    expect(
      totalsByCurrency([
        { amount: "0.10", currency: "USD" },
        { amount: "0.20", currency: "USD" },
        { amount: "1000.555", currency: "KWD" },
        null,
      ]),
    ).toEqual([
      { currency: "KWD", amount: "1000.555" },
      { currency: "USD", amount: "0.30" },
    ]);
  });
});

describe("Payout Files list", () => {
  it("is denied without a payment permission", () => {
    signIn(me({ [P.PAYROLL_RUN_READ]: ["COMPANY"] }));
    render(<PayoutFilesPage />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("lists batches with exact string amounts, status and preparer", async () => {
    signIn(PREPARER);
    mockGet.mockImplementation(routes({ "/payroll/payment-batches": { total: 1, items: [batch()] } }));
    render(<PayoutFilesPage />);
    const table = await screen.findByRole("table", { name: "Payment batches" });
    expect(within(table).getByText("PB00000041")).toBeInTheDocument();
    expect(plain(table.textContent)).toMatch(/2,46,913\.56|246,913\.56/);
    expect(within(table).getByText("Awaiting approval")).toBeInTheDocument();
    expect(within(table).getByText("User #9")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create payment batch/ })).toBeInTheDocument();
  });

  it("hides Create payment batch from people who don't prepare payments", async () => {
    signIn(APPROVER);
    mockGet.mockImplementation(routes({ "/payroll/payment-batches": { total: 0, items: [] } }));
    render(<PayoutFilesPage />);
    expect(await screen.findByText("No payment batches yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create payment batch/ })).not.toBeInTheDocument();
  });

  it("labels a manually submitted batch as unverified, never paid", async () => {
    signIn(APPROVER);
    mockGet.mockImplementation(routes({ "/payroll/payment-batches": { total: 1, items: [batch({ status: "SUBMITTED", submission_channel: "MANUAL_UPLOAD" })] } }));
    render(<PayoutFilesPage />);
    const table = await screen.findByRole("table", { name: "Payment batches" });
    expect(within(table).getByText("Submitted for manual payment — unverified")).toBeInTheDocument();
    expect(within(table).queryByText(/^Paid$/)).not.toBeInTheDocument();
  });

  it("labels sandbox batches", async () => {
    signIn(APPROVER);
    mockGet.mockImplementation(routes({ "/payroll/payment-batches": { total: 1, items: [batch({ method: "API", adapter: "SANDBOX", sandbox: true, badge: "SANDBOX", file_format: null })] } }));
    render(<PayoutFilesPage />);
    const table = await screen.findByRole("table", { name: "Payment batches" });
    expect(within(table).getByText("Sandbox")).toBeInTheDocument();
  });
});

describe("Create payment batch", () => {
  const proposal = {
    run_id: 12,
    batches: [{ funding_account_id: 5, method: "BANK_FILE", currency: "INR", file_format: "GENERIC_CSV", adapter: null, sandbox: false, item_count: 2, total: { amount: "246913.56", currency: "INR" }, instruction_ids: [901, 902] }],
    exclusions: batch().exclusions,
    bank_changes: [],
  };

  it("deep-links from ?modal=new-batch&run=, previews batches and exclusions, then creates with one idempotency key", async () => {
    signIn(PREPARER);
    mockSearch = new URLSearchParams("modal=new-batch&run=12");
    mockGet.mockImplementation(routes({ "/payroll/payment-batches": { total: 0, items: [] }, "/payroll/runs": { total: 1, items: [RUN] } }));
    mockPost.mockImplementation(async (url: string) => {
      if (url === "/payroll/payment-batches/proposal") return proposal;
      if (url === "/payroll/payment-batches") throw conflict("No payment of the run is ready to batch.");
      return null;
    });
    render(<PayoutFilesPage />);
    const dialog = await screen.findByRole("dialog", { name: "Create payment batch" });
    await within(dialog).findByRole("option", { name: /Oct 2026 · Staff Monthly/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview batches" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/payment-batches/proposal", { run_id: 12 }));
    expect(await within(dialog).findByText("1 batch will be created")).toBeInTheDocument();
    expect(within(dialog).getAllByText("No active bank account on file").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Exclusions (1)")).toBeInTheDocument();
    const create = within(dialog).getByRole("button", { name: "Create 1 batch for approval" });
    fireEvent.click(create);
    expect(await within(dialog).findByText("Someone else changed this")).toBeInTheDocument();
    fireEvent.click(create);
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(3));
    const keys = mockPost.mock.calls.filter((c) => c[0] === "/payroll/payment-batches").map((c) => c[2].idempotencyKey);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
  });

  it("has a full page with the same form", async () => {
    signIn(PREPARER);
    mockSearch = new URLSearchParams("run=12");
    mockGet.mockImplementation(routes({ "/payroll/runs": { total: 1, items: [RUN] } }));
    render(<NewBatchPage />);
    expect(await screen.findByRole("heading", { name: "Create payment batch" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: /Oct 2026/ })).toBeInTheDocument();
  });
});

describe("Batch detail", () => {
  it("never offers approval to the preparer", async () => {
    signIn(me({ [P.PAYROLL_PAYMENT_PREPARE]: ["COMPANY"], [P.PAYROLL_PAYMENT_APPROVE]: ["COMPANY"] }));
    mockParams = { id: "41" };
    mockGet.mockImplementation(routes({ "/payroll/payment-batches/41": batch({ prepared_by_user_id: ME_ID }) }));
    render(<BatchPage />);
    expect(await screen.findByText("You prepared this batch, so another person approves it.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve batch" })).not.toBeInTheDocument();
  });

  it("approves with the row version and shows a conflict banner on 409", async () => {
    signIn(APPROVER);
    mockParams = { id: "41" };
    mockGet.mockImplementation(routes({ "/payroll/payment-batches/41": batch() }));
    mockPost.mockRejectedValue(conflict());
    render(<BatchPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve batch" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/payment-batches/41/approve", { row_version: 4 }));
    expect(await screen.findByText("Someone else changed this")).toBeInTheDocument();
  });

  it("shows per-currency figures with Why this amount? and the exclusions report", async () => {
    signIn(APPROVER);
    mockParams = { id: "41" };
    mockGet.mockImplementation(routes({ "/payroll/payment-batches/41": batch() }));
    render(<BatchPage />);
    const why = await screen.findByRole("region", { name: "Why this amount?" });
    fireEvent.click(within(why).getByRole("button", { name: /Formula/ }));
    expect(within(why).getByText("Settled (evidence)")).toBeInTheDocument();
    expect(screen.getByText("Exclusions (1)")).toBeInTheDocument();
    expect(screen.getAllByText("No active bank account on file").length).toBeGreaterThan(0);
  });

  it("filters payments by failed, held and overdue", async () => {
    signIn(APPROVER);
    mockParams = { id: "41" };
    const rows = [
      instruction({ id: 901, status: "FAILED", employee_id: 142, failure_message: "Account closed" }),
      instruction({ id: 902, status: "ON_HOLD", employee_id: 143 }),
      instruction({ id: 903, status: "SUBMITTED", employee_id: 144, submission_channel: "MANUAL_UPLOAD", expected_settlement_date: "2020-01-01" }),
    ];
    mockGet.mockImplementation(routes({ "/payroll/payment-batches/41": batch({ status: "SUBMITTED", instructions: rows }) }));
    render(<BatchPage />);
    const group = await screen.findByRole("group", { name: "Filter payments" });
    const table = () => screen.getByRole("table", { name: "Payments in this batch" });
    expect(within(table()).getAllByRole("row")).toHaveLength(4);
    fireEvent.click(within(group).getByRole("button", { name: /Failed\s*1/ }));
    expect(within(table()).getByText("Employee #142")).toBeInTheDocument();
    expect(within(table()).queryByText("Employee #143")).not.toBeInTheDocument();
    fireEvent.click(within(group).getByRole("button", { name: /Held\s*1/ }));
    expect(within(table()).getByText("Employee #143")).toBeInTheDocument();
    fireEvent.click(within(group).getByRole("button", { name: /Overdue\s*1/ }));
    expect(within(table()).getByText("Employee #144")).toBeInTheDocument();
    expect(within(table()).getByText("Submitted for manual payment — unverified")).toBeInTheDocument();
  });

  it("releases a generated file only after typing the reference, sending the file hash", async () => {
    signIn(SIGNATORY);
    mockParams = { id: "41" };
    const sha = "c".repeat(64);
    const b = batch({ status: "FILE_GENERATED", approved_by_user_id: 11, file: { format: "GENERIC_CSV", filename: "PB00000041.csv", sha256: sha, record_count: 2, totals: { INR: "246913.56" }, generated_at: "2026-10-21T11:00:00", download_count: 1, last_downloaded_at: "2026-10-21T11:05:00" } });
    mockGet.mockImplementation(routes({ "/payroll/payment-batches/41": b, "/payroll/funding-accounts/options": { items: [fundingOption()] } }));
    mockPost.mockResolvedValue({ id: 41, status: "SUBMITTED" });
    render(<BatchPage />);
    expect(await screen.findByText(sha)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /Mark as submitted/ }));
    expect(mockPush).toHaveBeenCalledWith("/payroll/payments?modal=release&batch=41", { scroll: false });
  });

  it("confirms release from the deep link with typed confirmation", async () => {
    signIn(SIGNATORY);
    mockParams = { id: "41" };
    mockSearch = new URLSearchParams("modal=release&batch=41");
    const sha = "c".repeat(64);
    const b = batch({ status: "FILE_GENERATED", file: { format: "GENERIC_CSV", filename: "PB00000041.csv", sha256: sha, record_count: 2, totals: { INR: "246913.56" }, generated_at: null, download_count: 1, last_downloaded_at: null } });
    mockGet.mockImplementation(routes({ "/payroll/payment-batches/41": b, "/payroll/funding-accounts/options": { items: [fundingOption()] } }));
    mockPost.mockResolvedValue({ id: 41, status: "SUBMITTED" });
    render(<BatchPage />);
    const dialog = await screen.findByRole("dialog", { name: "Mark batch as submitted" });
    expect(within(dialog).getByText(/Submitted for manual payment — unverified/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Mark as submitted" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Type “PB00000041” to confirm/), { target: { value: "PB00000041" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/payment-batches/41/release", { row_version: 4, file_sha256: sha }, expect.objectContaining({ idempotencyKey: expect.any(String) })));
  });

  it("does not offer release to a non-signatory or to the preparer", async () => {
    signIn(SIGNATORY);
    mockParams = { id: "41" };
    const b = batch({ status: "FILE_GENERATED", file: { format: "GENERIC_CSV", filename: "f.csv", sha256: "d".repeat(64), record_count: 2, totals: {}, generated_at: null, download_count: 0, last_downloaded_at: null } });
    mockGet.mockImplementation(routes({ "/payroll/payment-batches/41": b, "/payroll/funding-accounts/options": { items: [fundingOption({ is_signatory: false })] } }));
    render(<BatchPage />);
    expect(await screen.findByText(/you are not one/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark as submitted/ })).not.toBeInTheDocument();
  });

  it("shows forbidden or unknown batches as not found", async () => {
    signIn(APPROVER);
    mockParams = { id: "404" };
    mockGet.mockImplementation(async () => {
      throw notFound();
    });
    render(<BatchPage />);
    expect(await screen.findByText("Payment batch not found")).toBeInTheDocument();
  });

  it("opens a payment's event timeline in a sheet", async () => {
    signIn(APPROVER);
    mockParams = { id: "41" };
    mockSearch = new URLSearchParams("modal=instruction&id=901");
    mockGet.mockImplementation(
      routes({
        "/payroll/payment-batches/41": batch(),
        "/payroll/payment-instructions/901": { ...instruction({ status: "SUBMITTED", submission_channel: "SANDBOX", sandbox: true }), manual_proofs: [], replaced_by_instruction_ids: [] },
        "/payroll/payment-instructions/901/events": {
          instruction: instruction(),
          events: [{ id: 1, event_status: "SUBMITTED", outcome: "APPLIED", from_status: "QUEUED", to_status: "SUBMITTED", source: "SYSTEM", external_event_id: null, evidence_ref: null, sandbox: true, actor_user_id: null, details: {}, at: "2026-10-21T12:00:00" }],
        },
      }),
    );
    render(<BatchPage />);
    const sheet = await screen.findByRole("dialog", { name: "Payment #901" });
    expect(await within(sheet).findByText("Queued → Submitted")).toBeInTheDocument();
    expect(within(sheet).getAllByText("Sandbox").length).toBeGreaterThan(0);
    expect(within(sheet).getByRole("link", { name: /Open full page/ })).toHaveAttribute("href", "/payroll/payments/instructions/901");
  });
});

describe("Manual payment proof (EC-PAY-14)", () => {
  const RECONCILER = me({ [P.PAYROLL_PAYMENT_RECONCILE]: ["COMPANY"] });
  const manual = (proofs: unknown[] = []) => ({
    ...instruction({ status: "SUBMITTED", submission_channel: "MANUAL_UPLOAD", label: { key: "PROCESSING", text: "Processing", badge: null } }),
    manual_proofs: proofs,
    replaced_by_instruction_ids: [],
  });
  const proof = (overrides: Record<string, unknown> = {}) => ({
    id: 3, instruction_id: 901, method: "CHEQUE", evidence_reference: "CHQ-0042", evidence_name: "cheque.pdf", evidence_mime: "application/pdf", evidence_sha256: "e".repeat(64),
    note: null, status: "PENDING_REVIEW", submitted_by_user_id: 11, reviewed_by_user_id: null, reviewed_at: null, review_note: null, row_version: 1, created_at: "2026-10-22T09:00:00",
    ...overrides,
  });
  const eventsRoute = { instruction: instruction(), events: [] };

  it("uploads proof as multipart with the row version and stays unverified", async () => {
    signIn(RECONCILER);
    mockParams = { id: "901" };
    mockGet.mockImplementation(routes({ "/payroll/payment-instructions/901": manual(), "/payroll/payment-instructions/901/events": eventsRoute }));
    mockPost.mockResolvedValue(proof({ submitted_by_user_id: ME_ID }));
    render(<InstructionRoute />);
    expect((await screen.findAllByText("Submitted for manual payment — unverified")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Upload proof of manual payment/ }));
    const dialog = await screen.findByRole("dialog", { name: "Upload proof of manual payment" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload proof" }));
    expect((await within(dialog).findAllByText(/Give the cheque number/)).length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/^Reference/), { target: { value: "CHQ-0042" } });
    const file = new File(["%PDF-1.4"], "cheque.pdf", { type: "application/pdf" });
    fireEvent.change(within(dialog).getByLabelText("Proof file"), { target: { files: [file] } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload proof" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const [url, form, options] = mockPost.mock.calls[0];
    expect(url).toBe("/payroll/payment-instructions/901/manual-settle");
    expect((form as FormData).get("method")).toBe("CHEQUE");
    expect((form as FormData).get("reference")).toBe("CHQ-0042");
    expect((form as FormData).get("row_version")).toBe("2");
    expect(options.idempotencyKey).toEqual(expect.any(String));
  });

  it("lets a second person approve, but never the uploader", async () => {
    signIn(RECONCILER);
    mockParams = { id: "901" };
    mockGet.mockImplementation(routes({ "/payroll/payment-instructions/901": manual([proof()]), "/payroll/payment-instructions/901/events": eventsRoute }));
    mockPost.mockResolvedValue({ id: 3, status: "APPROVED", instruction_id: 901, row_version: 2 });
    const { unmount } = render(<InstructionRoute />);
    expect(await screen.findByText("Waiting for a second reviewer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upload proof of manual payment/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve proof" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/manual-settlements/3/approve", { row_version: 1 }));
    unmount();

    mockGet.mockImplementation(routes({ "/payroll/payment-instructions/901": manual([proof({ submitted_by_user_id: ME_ID })]), "/payroll/payment-instructions/901/events": eventsRoute }));
    render(<InstructionRoute />);
    expect(await screen.findByText("You uploaded this proof, so another person reviews it.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve proof" })).not.toBeInTheDocument();
  });
});

describe("Value dates, FX quotes and signatories", () => {
  it("shows the server's value-date warnings on an unsent batch", async () => {
    signIn(APPROVER);
    mockParams = { id: "41" };
    mockGet.mockImplementation(routes({ "/payroll/payment-batches/41": batch({ value_date: "2026-11-02", value_date_warnings: ["VALUE_DATE_SHIFTED", "VALUE_DATE_AFTER_PAY_DATE"] }) }));
    render(<BatchPage />);
    expect(await screen.findByText(/Value date is after the pay date/)).toBeInTheDocument();
    expect(screen.getByText(/moved to the next business day/)).toBeInTheDocument();
  });

  it("previews the default value date and its warnings", async () => {
    signIn(PREPARER);
    mockSearch = new URLSearchParams("run=12");
    mockGet.mockImplementation(routes({ "/payroll/runs": { total: 1, items: [RUN] } }));
    mockPost.mockResolvedValue({
      run_id: 12,
      batches: [],
      exclusions: [],
      bank_changes: [],
      value_date: { requested: "2026-10-31", value_date: "2026-11-02", shifted: true, warnings: ["VALUE_DATE_SHIFTED", "VALUE_DATE_AFTER_PAY_DATE"] },
    });
    render(<NewBatchPage />);
    await screen.findByRole("option", { name: /Oct 2026/ });
    fireEvent.click(screen.getByRole("button", { name: "Preview batches" }));
    expect(await screen.findByText(/Value date is after the pay date/)).toBeInTheDocument();
  });

  it("explains an expired FX quote on release instead of a generic conflict", async () => {
    signIn(SIGNATORY);
    mockParams = { id: "41" };
    mockSearch = new URLSearchParams("modal=release&batch=41");
    const sha = "c".repeat(64);
    const b = batch({ status: "FILE_GENERATED", file: { format: "GENERIC_CSV", filename: "PB00000041.csv", sha256: sha, record_count: 2, totals: { INR: "246913.56" }, generated_at: null, download_count: 1, last_downloaded_at: null } });
    mockGet.mockImplementation(routes({ "/payroll/payment-batches/41": b, "/payroll/funding-accounts/options": { items: [fundingOption()] } }));
    mockPost.mockRejectedValue(payrollError(409, { detail: "The exchange-rate quote of PI000000901 expired.", code: "FX_QUOTE_EXPIRED" }));
    render(<BatchPage />);
    const dialog = await screen.findByRole("dialog", { name: "Mark batch as submitted" });
    fireEvent.change(within(dialog).getByLabelText(/Type “PB00000041” to confirm/), { target: { value: "PB00000041" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as submitted" }));
    expect(await screen.findByText("Exchange-rate quote expired")).toBeInTheDocument();
    expect(screen.queryByText("Someone else changed this")).not.toBeInTheDocument();
  });
});

describe("Reissue approval", () => {
  const failed = (requester: number) => ({
    ...instruction({ status: "FAILED", failure_message: "Account closed", reissue_request: { requested_by_user_id: requester, at: "2026-10-22T08:00:00", reason: "Employee fixed the account" } }),
    manual_proofs: [],
    replaced_by_instruction_ids: [],
  });

  it("lets a second approver approve a requested reissue, never the requester", async () => {
    signIn(APPROVER);
    mockParams = { id: "901" };
    mockGet.mockImplementation(routes({ "/payroll/payment-instructions/901": failed(11), "/payroll/payment-instructions/901/events": { instruction: instruction(), events: [] } }));
    mockPost.mockResolvedValue({ status: "REISSUED" });
    const { unmount } = render(<InstructionRoute />);
    expect(await screen.findByText("Reissue waiting for approval")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve reissue" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/payment-instructions/901/reissue/approve", { row_version: 2 }));
    unmount();

    mockGet.mockImplementation(routes({ "/payroll/payment-instructions/901": failed(ME_ID), "/payroll/payment-instructions/901/events": { instruction: instruction(), events: [] } }));
    render(<InstructionRoute />);
    expect(await screen.findByText("You requested this reissue, so another person approves it.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve reissue" })).not.toBeInTheDocument();
  });
});
