import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import LiabilityRoute from "@/app/(app)/payroll/compliance/liabilities/[id]/page";
import ComplianceRoute from "@/app/(app)/payroll/compliance/page";
import StatutoryReportRoute from "@/app/(app)/payroll/compliance/reports/[id]/page";
import { P } from "@/lib/permissions.generated";

import { conflict, entity, liability, me, notFound, overview, plain, serverError, signIn, statutoryReport } from "./fixtures";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockSearch = new URLSearchParams();
let mockParams: Record<string, string> = {};
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
  usePathname: () => "/payroll/compliance",
  useSearchParams: () => mockSearch,
  useParams: () => mockParams,
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("@/lib/payroll/api", () => {
  const actual = jest.requireActual("@/lib/payroll/api");
  return { ...actual, payrollApi: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});
const mockHttpGet = jest.fn();
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return { ...actual, http: { ...actual.http, get: (...a: unknown[]) => mockHttpGet(...a) } };
});

/** Route GETs by path (query params ignored); unknown paths fail like a 404. */
function routes(map: Record<string, unknown>) {
  mockGet.mockImplementation((url: string) => {
    if (!(url in map)) return Promise.reject(notFound("Thing"));
    const value = map[url];
    const resolved = typeof value === "function" ? (value as () => unknown)() : value;
    return resolved instanceof Error ? Promise.reject(resolved) : Promise.resolve(resolved);
  });
}

const LIABILITIES = { total: 1, items: [liability()], totals: { INR: { OPEN: "432000.00" } } };
const READER = me({ [P.PAYROLL_REPORTS_READ]: ["COMPANY"] });
const SUBMITTER = me({ [P.PAYROLL_STATUTORY_REVIEW]: ["COMPANY"], [P.PAYROLL_STATUTORY_SUBMIT]: ["COMPANY"] });

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockParams = {};
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = jest.fn(() => "blob:x");
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = jest.fn();
});

describe("Compliance page", () => {
  it("is denied to people without statutory or report access", () => {
    signIn(me({ [P.PAYROLL_PAYSLIP_READ]: ["SELF"] }));
    render(<ComplianceRoute />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("shows capability, pack, registrations, reports and liabilities read-only for report readers", async () => {
    signIn(READER);
    routes({
      "/payroll/compliance": overview([entity({ statutory_reports: [statutoryReport({ available_actions: [] })] })]),
      "/payroll/liabilities": LIABILITIES,
    });
    render(<ComplianceRoute />);
    expect(await screen.findByRole("heading", { name: "Acme India Private Limited" })).toBeInTheDocument();
    // Capability badge and the API's own note, never reworded.
    expect(screen.getByText("Calculation supported")).toBeInTheDocument();
    expect(screen.getByTestId("capability-note")).toHaveTextContent("FIXTURE — not law: statutory lines use test data.");
    expect(screen.getAllByText("FIXTURE — not law").length).toBeGreaterThan(0);
    // Pack version with its review date and reviewer.
    expect(screen.getByText("IN 2026.09.17")).toBeInTheDocument();
    expect(screen.getByText(/by R\. Mehta/)).toBeInTheDocument();
    expect(screen.getByText("BGBNG0012345000")).toBeInTheDocument();
    // Statutory report with its lifecycle chip.
    expect(screen.getAllByRole("link", { name: "PF electronic challan cum return" })[0]).toHaveAttribute("href", "/payroll/compliance/reports/61");
    expect(screen.getAllByText("Ready to file").length).toBeGreaterThan(0);
    // Liabilities with exact string money; no state-changing actions for a reader.
    await waitFor(() => expect(plain(screen.getByRole("region", { name: "Liabilities and remittances" }).textContent)).toMatch(/432,000\.00/));
    expect(mockGet).toHaveBeenCalledWith("/payroll/liabilities", { params: { legal_entity_id: 1, limit: 100 } });
    expect(screen.queryByRole("button", { name: "Record remittance" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New report/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark submitted" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide amounts" })).toBeInTheDocument();
  });

  it("states an unverified entity and a missing attestation honestly", async () => {
    signIn(READER);
    routes({
      "/payroll/compliance": overview([
        entity({
          capability: { level: "CONFIG_ONLY", label: "Config only", kind: "NOT_VERIFIED", tone: "warning", note: "Statutory calculations not verified", from_packs: "CONFIG_ONLY", recorded: null, recorded_note: null, environment: "PRODUCTION" },
          active_pack: null,
          attestation: { required: true, status: "MISSING", active: null, pending: null, message: "No attestation covers today.", blocks_finalization: true },
          report_definitions: [],
          statutory_reports: [],
          due_calendar: { available: false, reason: "No verified country pack defines due dates for this entity.", items: [], watermark: null },
        }),
      ]),
      "/payroll/liabilities": { total: 0, items: [], totals: {} },
    });
    render(<ComplianceRoute />);
    expect(await screen.findByText("Config only")).toBeInTheDocument();
    expect(screen.getByTestId("capability-note")).toHaveTextContent("Statutory calculations not verified");
    expect(screen.getByText("No country pack covers this entity today.")).toBeInTheDocument();
    expect(screen.getByText("Attestation missing")).toBeInTheDocument();
    expect(screen.getByText("Runs for this entity cannot be finalized until an attestation is approved.")).toBeInTheDocument();
    expect(screen.getByText("No verified country pack defines due dates for this entity.")).toBeInTheDocument();
    expect(screen.getByText("No statutory reports yet")).toBeInTheDocument();
    expect(await screen.findByText("No liabilities")).toBeInTheDocument();
  });

  it("shows an error with retry", async () => {
    signIn(READER);
    routes({ "/payroll/compliance": serverError() });
    render(<ComplianceRoute />);
    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
    routes({ "/payroll/compliance": overview(), "/payroll/liabilities": LIABILITIES });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Acme India Private Limited" })).toBeInTheDocument();
  });

  it("switches between legal entities with tabs", async () => {
    signIn(READER);
    const second = entity({
      legal_entity: { id: 2, code: "ACAE", legal_name: "Acme Gulf FZ-LLC", status: "ACTIVE", base_currency: "AED", country_confirmed: true },
      country: { code: "AE", name: "United Arab Emirates" },
    });
    routes({ "/payroll/compliance": overview([entity(), second]), "/payroll/liabilities": LIABILITIES });
    render(<ComplianceRoute />);
    expect(await screen.findByRole("heading", { name: "Acme India Private Limited" })).toBeInTheDocument();
    const tab = screen.getByRole("tab", { name: "ACAE" });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    expect(await screen.findByRole("heading", { name: "Acme Gulf FZ-LLC" })).toBeInTheDocument();
  });

  it("opens lifecycle actions and remittances through modal routes", async () => {
    signIn(SUBMITTER);
    routes({ "/payroll/compliance": overview(), "/payroll/liabilities": LIABILITIES });
    render(<ComplianceRoute />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Mark submitted" }))[0]);
    expect(mockPush).toHaveBeenCalledWith("/payroll/compliance?modal=statutory-action&id=61&action=MARK_SUBMITTED", { scroll: false });
    fireEvent.click((await screen.findAllByRole("button", { name: "Record remittance" }))[0]);
    expect(mockPush).toHaveBeenCalledWith("/payroll/compliance?modal=remit&id=81", { scroll: false });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(mockPush).toHaveBeenCalledWith("/payroll/compliance?modal=new-statutory&entity=1&code=PF_ECR&period=2026-11-01", { scroll: false });
  });

  it("marks a report submitted with the filing reference and row version", async () => {
    signIn(SUBMITTER);
    mockSearch = new URLSearchParams("modal=statutory-action&id=61&action=MARK_SUBMITTED");
    routes({ "/payroll/compliance": overview(), "/payroll/liabilities": LIABILITIES, "/payroll/statutory-reports/61": statutoryReport() });
    mockPost.mockResolvedValue({ id: 61, status: "SUBMITTED", version: 1, row_version: 5 });
    render(<ComplianceRoute />);
    const dialog = await screen.findByRole("dialog", { name: /Mark submitted · PF electronic challan cum return/ });
    expect(within(dialog).getByText(/Records that you filed this report with the authority/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark submitted" }));
    expect((await within(dialog).findAllByText("Filing reference is required.")).length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Filing reference/), { target: { value: "ECR-2026-10-123" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark submitted" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/statutory-reports/61/mark-submitted", { row_version: 4, filing_ref: "ECR-2026-10-123" }));
  });

  it("shows a 409 conflict with reload and keeps the typed reference", async () => {
    signIn(SUBMITTER);
    mockSearch = new URLSearchParams("modal=statutory-action&id=61&action=MARK_SUBMITTED");
    routes({ "/payroll/compliance": overview(), "/payroll/liabilities": LIABILITIES, "/payroll/statutory-reports/61": statutoryReport() });
    mockPost.mockRejectedValue(conflict());
    render(<ComplianceRoute />);
    const dialog = await screen.findByRole("dialog", { name: /Mark submitted/ });
    fireEvent.change(within(dialog).getByLabelText(/Filing reference/), { target: { value: "ECR-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark submitted" }));
    expect(await within(dialog).findByText("Someone else changed this")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Filing reference/)).toHaveValue("ECR-1");
    fireEvent.click(within(dialog).getByRole("button", { name: /Reload/ }));
    await waitFor(() => expect(mockGet.mock.calls.filter(([u]) => u === "/payroll/statutory-reports/61").length).toBeGreaterThan(1));
  });

  it("asks before discarding a half-filled action form", async () => {
    signIn(SUBMITTER);
    mockSearch = new URLSearchParams("modal=statutory-action&id=61&action=MARK_SUBMITTED");
    routes({ "/payroll/compliance": overview(), "/payroll/liabilities": LIABILITIES, "/payroll/statutory-reports/61": statutoryReport() });
    render(<ComplianceRoute />);
    const dialog = await screen.findByRole("dialog", { name: /Mark submitted/ });
    fireEvent.change(within(dialog).getByLabelText(/Filing reference/), { target: { value: "ECR-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    // No ConfirmProvider in the test: "Discard changes?" resolves to "keep editing", so nothing navigates.
    await waitFor(() => expect(within(dialog).getByLabelText(/Filing reference/)).toHaveValue("ECR-1"));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Filing reference/), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/payroll/compliance", { scroll: false }));
  });

  it("records a remittance with a required reference", async () => {
    signIn(SUBMITTER);
    mockSearch = new URLSearchParams("modal=remit&id=81");
    routes({ "/payroll/compliance": overview(), "/payroll/liabilities": LIABILITIES, "/payroll/liabilities/81": liability() });
    mockPost.mockResolvedValue({ id: 81, status: "REMITTED", remittance_ref: "CHL-9", row_version: 2 });
    render(<ComplianceRoute />);
    const dialog = await screen.findByRole("dialog", { name: "Record remittance" });
    await waitFor(() => expect(plain(dialog.textContent)).toMatch(/432,000\.00/));
    expect(within(dialog).getByRole("link", { name: /Open full page/ })).toHaveAttribute("href", "/payroll/compliance/liabilities/81");
    fireEvent.click(within(dialog).getByRole("button", { name: "Record remittance" }));
    expect((await within(dialog).findAllByText("Give the payment or challan reference.")).length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Payment or challan reference/), { target: { value: "CHL-9" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Record remittance" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/liabilities/81/remit", { remittance_ref: "CHL-9", row_version: 1 }));
  });

  it("creates a statutory report draft from the due-date calendar link", async () => {
    signIn(SUBMITTER);
    mockSearch = new URLSearchParams("modal=new-statutory&entity=1&code=PF_ECR&period=2026-11-01");
    routes({ "/payroll/compliance": overview(), "/payroll/liabilities": LIABILITIES });
    mockPost.mockResolvedValue({ id: 62, status: "DRAFT", version: 1, row_version: 1 });
    render(<ComplianceRoute />);
    const dialog = await screen.findByRole("dialog", { name: "New statutory report" });
    expect(within(dialog).getByLabelText(/Period starts/)).toHaveValue("2026-11-01");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/statutory-reports", { legal_entity_id: 1, report_code: "PF_ECR", period_start: "2026-11-01" }));
  });
});

describe("Statutory report page", () => {
  it("shows the lifecycle, history and downloads the exported file", async () => {
    signIn(SUBMITTER);
    mockParams = { id: "61" };
    routes({ "/payroll/statutory-reports/61": statutoryReport({ available_actions: ["MARK_SUBMITTED"] }) });
    mockHttpGet.mockResolvedValue({ data: new Blob(["a,b"]) });
    render(<StatutoryReportRoute />);
    expect(await screen.findByRole("heading", { name: "PF electronic challan cum return" })).toBeInTheDocument();
    expect(screen.getByText("FIXTURE — not law")).toBeInTheDocument();
    expect(screen.getByText(/it is filed only when you record the filing reference/)).toBeInTheDocument();
    expect(screen.getByText("Exported — ready to file")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark submitted" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Download file of/ }));
    await waitFor(() => expect(mockHttpGet).toHaveBeenCalledWith("/payroll/statutory-reports/61/file", { responseType: "blob" }));
  });

  it("shows forbidden or missing reports as not found", async () => {
    signIn(READER);
    mockParams = { id: "999" };
    routes({});
    render(<StatutoryReportRoute />);
    expect(await screen.findByText("Statutory report not found")).toBeInTheDocument();
  });
});

describe("Liability page", () => {
  it("shows both shares as exact strings and offers reconcile when remitted", async () => {
    signIn(SUBMITTER);
    mockParams = { id: "81" };
    routes({ "/payroll/liabilities/81": liability({ status: "REMITTED", remittance_ref: "CHL-9", remitted_on: "2026-11-10", employer_amount: { amount: "216000.25", currency: "INR" } }) });
    render(<LiabilityRoute />);
    expect(await screen.findByRole("heading", { name: "PF · EPFO" })).toBeInTheDocument();
    expect(plain(document.body.textContent)).toMatch(/216,000\.25/);
    expect(screen.getByText("CHL-9")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconcile" }));
    expect(mockPush).toHaveBeenCalledWith("/payroll/compliance?modal=reconcile&id=81", { scroll: false });
  });

  it("hides actions from readers", async () => {
    signIn(READER);
    mockParams = { id: "81" };
    routes({ "/payroll/liabilities/81": liability() });
    render(<LiabilityRoute />);
    expect(await screen.findByRole("heading", { name: "PF · EPFO" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record remittance" })).not.toBeInTheDocument();
  });
});
