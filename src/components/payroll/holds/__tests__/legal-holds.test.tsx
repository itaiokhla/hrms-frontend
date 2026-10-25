import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";

import ComplianceRoute from "@/app/(app)/payroll/compliance/page";
import LegalHoldsRoute from "@/app/(app)/payroll/legal-holds/page";
import { conflict, me, notFound, overview, serverError, signIn } from "@/components/payroll/documents/__tests__/fixtures";
import { payrollError } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import type { HoldSummary, LegalHold, SweepRow } from "../types";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockSearch = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
  usePathname: () => "/payroll/legal-holds",
  useSearchParams: () => mockSearch,
  useParams: () => ({}),
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("@/lib/payroll/api", () => {
  const actual = jest.requireActual("@/lib/payroll/api");
  return { ...actual, payrollApi: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});

function hold(overrides: Partial<LegalHold> = {}): LegalHold {
  return {
    id: 7,
    scope: "LEGAL_ENTITY",
    employee_id: null,
    legal_entity_id: 1,
    doc_type: null,
    document_id: null,
    reference: "CASE-12",
    reason: "Tribunal claim by a former employee",
    status: "ACTIVE",
    created_by_user_id: 99,
    created_at: "2026-10-20T09:30:00Z",
    released_by_user_id: null,
    released_at: null,
    release_reason: null,
    row_version: 1,
    documents_covered: 6,
    ...overrides,
  };
}

function summary(overrides: Partial<HoldSummary> = {}): HoldSummary {
  return {
    active_holds: 2,
    released_holds: 1,
    documents_under_hold: 6,
    documents_due: 5,
    documents_due_held: 2,
    documents_due_deletable: 3,
    documents_redacted: 4,
    as_of: "2026-10-24",
    sweep_types: ["PAYSLIP_V2", "PAYROLL_REGISTER"],
    sweep_limit: 500,
    last_sweep: null,
    ...overrides,
  };
}

const sweepRow = (overrides: Partial<SweepRow> = {}): SweepRow => ({
  at: "2026-10-24T02:30:00Z",
  action: "RETENTION_SWEEP",
  as_of: "2026-10-24",
  trigger: "JOB",
  due: 5,
  held: 2,
  redacted: 3,
  remaining: 0,
  not_due: 8,
  no_retention_date: 0,
  more: false,
  ...overrides,
});

const MANAGER = me({ [P.PAYROLL_LEGAL_HOLD_MANAGE]: ["COMPANY"] }); // user id 7
const AUDITOR = me({ [P.PAYROLL_AUDIT_READ]: ["COMPANY"] });

function routes(map: Record<string, unknown>) {
  mockGet.mockImplementation((url: string) => {
    if (!(url in map)) return Promise.reject(notFound("Thing"));
    const value = map[url];
    const resolved = typeof value === "function" ? (value as () => unknown)() : value;
    return resolved instanceof Error ? Promise.reject(resolved) : Promise.resolve(resolved);
  });
}

const BASE = { "/payroll/legal-holds/summary": summary(), "/payroll/legal-holds": { total: 1, items: [hold()] }, "/payroll/legal-holds/sweeps": { items: [sweepRow()] } };

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
});

describe("Legal holds page", () => {
  it("is denied to people without hold or audit access", () => {
    signIn(me({ [P.PAYROLL_PAYSLIP_READ]: ["SELF"] }));
    render(<LegalHoldsRoute />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("shows the figures, the honest retention note and the holds with their coverage", async () => {
    signIn(MANAGER);
    routes(BASE);
    render(<LegalHoldsRoute />);
    expect(await screen.findByRole("heading", { name: "Legal holds & retention" })).toBeInTheDocument();
    expect(screen.getByText("Retention is your company's own policy")).toBeInTheDocument();
    expect((await screen.findAllByText("Active holds")).length).toBeGreaterThan(0);
    expect(screen.getByText("Documents under hold")).toBeInTheDocument();
    expect(screen.getByText("Due for deletion")).toBeInTheDocument();
    expect(screen.getByText("2 more held back by legal holds")).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Legal holds" });
    expect(within(table).getByText("Legal entity")).toBeInTheDocument();
    expect(within(table).getByText("Entity #1")).toBeInTheDocument();
    expect(within(table).getByText("Tribunal claim by a former employee")).toBeInTheDocument();
    expect(within(table).getByText("Ref CASE-12")).toBeInTheDocument();
    expect(within(table).getByText("Active")).toBeInTheDocument();
    expect(within(table).getByText("by user #99")).toBeInTheDocument();
    expect(within(table).getByText("6")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/payroll/legal-holds", { params: { status: "ACTIVE", limit: 100 } });
    // The Compliance tabs link both ways.
    const nav = screen.getByRole("navigation", { name: "Compliance sections" });
    expect(within(nav).getByRole("link", { name: "Statutory" })).toHaveAttribute("href", "/payroll/compliance");
    expect(within(nav).getByRole("link", { name: "Legal holds & retention" })).toHaveAttribute("aria-current", "page");
  });

  it("lets an auditor look but not act", async () => {
    signIn(AUDITOR);
    routes(BASE);
    render(<LegalHoldsRoute />);
    await screen.findByRole("table", { name: "Legal holds" });
    expect(screen.queryByRole("button", { name: "Place hold" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run sweep" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Erasure request" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Release hold/ })).not.toBeInTheDocument();
  });

  it("opens the action modals through routes and filters released holds", async () => {
    signIn(MANAGER);
    routes({ ...BASE, "/payroll/legal-holds": { total: 0, items: [] } });
    render(<LegalHoldsRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "Place hold" }));
    expect(mockPush).toHaveBeenCalledWith("/payroll/legal-holds?modal=place-hold", { scroll: false });
    fireEvent.click(screen.getByRole("button", { name: "Run sweep" }));
    expect(mockPush).toHaveBeenCalledWith("/payroll/legal-holds?modal=retention-sweep", { scroll: false });
    fireEvent.click(screen.getByRole("button", { name: "Erasure request" }));
    expect(mockPush).toHaveBeenCalledWith("/payroll/legal-holds?modal=erasure-request", { scroll: false });
    expect(await screen.findByText("No legal holds")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "RELEASED" } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/payroll/legal-holds", { params: { status: "RELEASED", limit: 100 } }));
    expect(await screen.findByText("No released holds")).toBeInTheDocument();
  });

  it("opens the release modal from a row", async () => {
    signIn(MANAGER);
    routes(BASE);
    render(<LegalHoldsRoute />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Release hold 7" }))[0]);
    expect(mockPush).toHaveBeenCalledWith("/payroll/legal-holds?modal=release-hold&id=7", { scroll: false });
  });

  it("lists the recent sweeps with counts only", async () => {
    signIn(MANAGER);
    routes(BASE);
    render(<LegalHoldsRoute />);
    const tab = await screen.findByRole("tab", { name: "Retention sweeps" });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    const table = await screen.findByRole("table", { name: "Retention sweeps" });
    expect(within(table).getByText("Daily job")).toBeInTheDocument();
    expect(within(table).getByText("3")).toBeInTheDocument();
    expect(within(table).getByText("8")).toBeInTheDocument();
  });

  it("shows an error with retry", async () => {
    signIn(MANAGER);
    routes({ ...BASE, "/payroll/legal-holds/summary": serverError() });
    render(<LegalHoldsRoute />);
    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
    routes(BASE);
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]);
    expect((await screen.findAllByText("Active holds")).length).toBeGreaterThan(0);
  });
});

describe("Place hold modal", () => {
  beforeEach(() => {
    mockSearch = new URLSearchParams("modal=place-hold");
    signIn(MANAGER);
    routes(BASE);
  });

  it("asks for the target and the reason before anything is sent", async () => {
    render(<LegalHoldsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Place a legal hold" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Place hold" }));
    expect((await within(dialog).findAllByText("Choose the employee.")).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("Give the reason for the hold.").length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("places a legal-entity hold with the entity id (no organisation access: numeric field)", async () => {
    mockPost.mockResolvedValue(hold({ documents_covered: 6 }));
    render(<LegalHoldsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Place a legal hold" });
    fireEvent.change(within(dialog).getByLabelText("What does it cover?"), { target: { value: "LEGAL_ENTITY" } });
    expect(within(dialog).getByText("Every payroll document of the legal entity.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Legal entity id/), { target: { value: "x3" } });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "  Pending tribunal claim " } });
    fireEvent.change(within(dialog).getByLabelText(/Reference/), { target: { value: "CASE-12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Place hold" }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/payroll/legal-holds", { scope: "LEGAL_ENTITY", legal_entity_id: 3, reason: "Pending tribunal claim", reference: "CASE-12" }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Legal hold placed. It covers 6 documents."));
  });

  it("places a document-type hold and a single-document hold", async () => {
    mockPost.mockResolvedValue(hold({ documents_covered: 1 }));
    render(<LegalHoldsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Place a legal hold" });
    fireEvent.change(within(dialog).getByLabelText("What does it cover?"), { target: { value: "DOCUMENT_TYPE" } });
    fireEvent.change(within(dialog).getByLabelText(/Document type/), { target: { value: "PAYROLL_REGISTER" } });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Audit" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Place hold" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/legal-holds", { scope: "DOCUMENT_TYPE", doc_type: "PAYROLL_REGISTER", reason: "Audit" }));
    fireEvent.change(within(dialog).getByLabelText("What does it cover?"), { target: { value: "DOCUMENT" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Place hold" }));
    expect((await within(dialog).findAllByText("Enter the document id.")).length).toBeGreaterThan(0);
    fireEvent.change(within(dialog).getByLabelText(/Document id/), { target: { value: "501" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Place hold" }));
    await waitFor(() => expect(mockPost).toHaveBeenLastCalledWith("/payroll/legal-holds", { scope: "DOCUMENT", document_id: 501, reason: "Audit" }));
  });

  it("places an employee hold by employee id", async () => {
    mockPost.mockResolvedValue(hold({ scope: "EMPLOYEE", employee_id: 42, legal_entity_id: null, documents_covered: 1 }));
    render(<LegalHoldsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Place a legal hold" });
    fireEvent.change(within(dialog).getByLabelText(/Employee ID/), { target: { value: "42" } });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Dispute" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Place hold" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/legal-holds", { scope: "EMPLOYEE", employee_id: 42, reason: "Dispute" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Legal hold placed. It covers 1 document."));
  });

  it("shows a server refusal (unknown employee) and keeps what was typed", async () => {
    mockPost.mockRejectedValue(notFound("Employee"));
    render(<LegalHoldsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Place a legal hold" });
    fireEvent.change(within(dialog).getByLabelText(/Employee ID/), { target: { value: "999" } });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Dispute" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Place hold" }));
    expect(await within(dialog).findByText("Employee not found")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Reason/)).toHaveValue("Dispute");
  });
});

describe("Release modal", () => {
  it("explains that another person must release a hold the viewer placed", async () => {
    mockSearch = new URLSearchParams("modal=release-hold&id=7");
    signIn(MANAGER);
    routes({ ...BASE, "/payroll/legal-holds/7": hold({ created_by_user_id: 7 }) });
    render(<LegalHoldsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Release legal hold" });
    expect(await within(dialog).findByText("Another person must release this hold")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Release hold" })).toBeDisabled();
  });

  it("releases with a reason and the row version", async () => {
    mockSearch = new URLSearchParams("modal=release-hold&id=7");
    signIn(MANAGER);
    routes({ ...BASE, "/payroll/legal-holds/7": hold({ row_version: 3 }) });
    mockPost.mockResolvedValue(hold({ status: "RELEASED", row_version: 4 }));
    render(<LegalHoldsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Release legal hold" });
    expect(await within(dialog).findByText("Tribunal claim by a former employee")).toBeInTheDocument();
    expect(within(dialog).getByText(/Releasing does not delete anything/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Release hold" }));
    expect((await within(dialog).findAllByText("Give the reason for releasing the hold.")).length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Reason for releasing/), { target: { value: "Claim withdrawn" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Release hold" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/legal-holds/7/release", { reason: "Claim withdrawn", row_version: 3 }));
  });

  it("shows the server's maker-checker refusal and a stale version with reload", async () => {
    mockSearch = new URLSearchParams("modal=release-hold&id=7");
    signIn(MANAGER);
    routes({ ...BASE, "/payroll/legal-holds/7": hold() });
    mockPost.mockRejectedValueOnce(payrollError(403, { detail: "A legal hold must be released by someone other than the person who placed it.", code: "MAKER_CHECKER_REQUIRED" }));
    render(<LegalHoldsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Release legal hold" });
    await within(dialog).findByText("Tribunal claim by a former employee");
    fireEvent.change(within(dialog).getByLabelText(/Reason for releasing/), { target: { value: "Done" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Release hold" }));
    expect(await within(dialog).findByText(/must be released by someone other than the person who placed it/)).toBeInTheDocument();
    mockPost.mockRejectedValueOnce(conflict());
    fireEvent.click(within(dialog).getByRole("button", { name: "Release hold" }));
    expect(await within(dialog).findByText("Someone else changed this")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Reload/ }));
    await waitFor(() => expect(mockGet.mock.calls.filter(([u]) => u === "/payroll/legal-holds/7").length).toBeGreaterThan(1));
  });
});

describe("Sweep modal", () => {
  it("shows what will be deleted and what is held back, then the counts", async () => {
    mockSearch = new URLSearchParams("modal=retention-sweep");
    signIn(MANAGER);
    routes(BASE);
    mockPost.mockResolvedValue({ as_of: "2026-10-24", trigger: "MANUAL", due: 5, held: 2, redacted: 3, remaining: 0, not_due: 8, no_retention_date: 0, more: false });
    render(<LegalHoldsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Run the retention sweep" });
    expect(await within(dialog).findByTestId("sweep-due")).toHaveTextContent("5");
    expect(within(dialog).getByTestId("sweep-held")).toHaveTextContent("2");
    expect(within(dialog).getByTestId("sweep-deletable")).toHaveTextContent("3");
    expect(within(dialog).getByText("Deleted files cannot be restored")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete 3 stored files" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/legal-holds/sweeps", {}));
    expect(await within(dialog).findByTestId("result-redacted")).toHaveTextContent("3");
    expect(within(dialog).queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Retention sweep done: 3 stored files deleted.");
  });

  it("offers nothing to delete when everything due is held", async () => {
    mockSearch = new URLSearchParams("modal=retention-sweep");
    signIn(MANAGER);
    routes({ ...BASE, "/payroll/legal-holds/summary": summary({ documents_due: 2, documents_due_held: 2, documents_due_deletable: 0 }) });
    render(<LegalHoldsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Run the retention sweep" });
    expect(await within(dialog).findByRole("button", { name: "Nothing to delete" })).toBeDisabled();
  });
});

describe("Erasure request modal", () => {
  beforeEach(() => {
    mockSearch = new URLSearchParams("modal=erasure-request");
    signIn(MANAGER);
    routes(BASE);
  });

  it("is refused with the legal-hold notice", async () => {
    mockPost.mockRejectedValue(payrollError(409, { detail: "This employee's data is under a legal hold and cannot be deleted or anonymised.", code: "LEGAL_HOLD" }));
    render(<LegalHoldsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Employee erasure request" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Process request" }));
    expect((await within(dialog).findAllByText("Choose the employee.")).length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Employee ID/), { target: { value: "42" } });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Subject access request" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Process request" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/legal-holds/erasure-requests", { employee_id: 42, reason: "Subject access request" }));
    expect(await within(dialog).findByText("This data is under a legal hold")).toBeInTheDocument();
    expect(within(dialog).getByText(/cannot be deleted or anonymised/)).toBeInTheDocument();
  });

  it("shows what was deleted and what is kept until retention ends", async () => {
    mockPost.mockResolvedValue({ employee_id: 42, redacted: 1, kept_until_retention_ends: 2, more: false });
    render(<LegalHoldsRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Employee erasure request" });
    fireEvent.change(within(dialog).getByLabelText(/Employee ID/), { target: { value: "42" } });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Request" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Process request" }));
    expect(await within(dialog).findByTestId("erasure-redacted")).toHaveTextContent("1");
    expect(within(dialog).getByTestId("erasure-kept")).toHaveTextContent("2");
    expect(within(dialog).getByText("Finalized records are kept")).toBeInTheDocument();
  });
});

describe("Compliance tabs", () => {
  it("link to legal holds only for people who can open the page", async () => {
    signIn(me({ [P.PAYROLL_REPORTS_READ]: ["COMPANY"], [P.PAYROLL_LEGAL_HOLD_MANAGE]: ["COMPANY"] }));
    routes({ "/payroll/compliance": overview(), "/payroll/liabilities": { total: 0, items: [], totals: {} } });
    const { unmount } = render(<ComplianceRoute />);
    const nav = await screen.findByRole("navigation", { name: "Compliance sections" });
    expect(within(nav).getByRole("link", { name: "Legal holds & retention" })).toHaveAttribute("href", "/payroll/legal-holds");
    expect(within(nav).getByRole("link", { name: "Statutory" })).toHaveAttribute("aria-current", "page");
    unmount();
    signIn(me({ [P.PAYROLL_REPORTS_READ]: ["COMPANY"] }));
    render(<ComplianceRoute />);
    await screen.findByRole("heading", { name: "Acme India Private Limited" });
    expect(screen.queryByRole("navigation", { name: "Compliance sections" })).not.toBeInTheDocument();
  });
});
