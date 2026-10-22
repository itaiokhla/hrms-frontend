import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import PayslipPage from "@/app/(app)/payroll/payslips/[id]/page";
import PayslipsPage from "@/app/(app)/payroll/payslips/page";
import { P } from "@/lib/permissions.generated";

import { me, notFound, payslip, payslipDetail, plain, serverError, signIn } from "./fixtures";

const mockPush = jest.fn();
let mockSearch = new URLSearchParams();
let mockParams: Record<string, string> = {};
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/payroll/payslips",
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

const READER = me({ [P.PAYROLL_PAYSLIP_READ]: ["COMPANY"] });
const PUBLISHER = me({ [P.PAYROLL_PAYSLIP_READ]: ["COMPANY"], [P.PAYROLL_PAYSLIP_PUBLISH]: ["COMPANY"], [P.PAYROLL_REPORTS_EXPORT]: ["COMPANY"] });

/** Route GETs by URL; unknown URLs fail like a 404 would. */
function routes(map: Record<string, unknown | (() => unknown)>) {
  mockGet.mockImplementation((url: string) => {
    const hit = Object.entries(map).find(([k]) => url === k || url.startsWith(`${k}?`));
    if (!hit) return Promise.reject(notFound("Thing"));
    const value = typeof hit[1] === "function" ? (hit[1] as () => unknown)() : hit[1];
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockParams = {};
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

describe("Payslips (HR)", () => {
  it("is denied to employees who only read their own payslips", () => {
    signIn(me({ [P.PAYROLL_PAYSLIP_READ]: ["SELF"] }));
    render(<PayslipsPage />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("lists payslips with exact string amounts and no publish controls for readers", async () => {
    signIn(READER);
    routes({ "/payroll/payslips": { total: 1, items: [payslip()] } });
    render(<PayslipsPage />);
    expect((await screen.findAllByText("Asha Rao")).length).toBeGreaterThan(0);
    expect(plain(document.body.textContent)).toMatch(/82,410\.50/);
    expect(screen.getAllByText("Generated").length).toBeGreaterThan(0);
    expect(mockGet).toHaveBeenCalledWith("/payroll/payslips", { params: { skip: 0, limit: 50 } });
    expect(screen.queryByRole("checkbox", { name: /Select all payslips/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Publish run/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download ZIP/ })).not.toBeInTheDocument();
    // Hide amounts toggle in the workspace header (F-24).
    expect(screen.getByRole("button", { name: "Hide amounts" })).toBeInTheDocument();
  });

  it("filters by status and sends the filter to the API", async () => {
    signIn(READER);
    routes({ "/payroll/payslips": { total: 0, items: [] } });
    render(<PayslipsPage />);
    expect(await screen.findByText("No payslips yet")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "EMAIL_FAILED" } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/payroll/payslips", { params: { status: "EMAIL_FAILED", skip: 0, limit: 50 } }));
    expect(await screen.findByText("No payslips match these filters")).toBeInTheDocument();
  });

  it("shows an error with retry", async () => {
    signIn(READER);
    routes({ "/payroll/payslips": serverError() });
    render(<PayslipsPage />);
    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
    routes({ "/payroll/payslips": { total: 1, items: [payslip()] } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findAllByText("Asha Rao")).length).toBeGreaterThan(0);
  });

  it("bulk-publishes selected generated payslips with a required reason and reports skipped ones", async () => {
    signIn(PUBLISHER);
    routes({ "/payroll/payslips": { total: 2, items: [payslip(), payslip({ id: 502, employee: { id: 43, name: "Omar Ali", employee_code: "E0043" } })] } });
    mockPost.mockResolvedValue({ published: [501], skipped: [502] });
    render(<PayslipsPage />);
    await screen.findAllByText("Omar Ali");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all payslips on this page" }));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", { name: /Publish 2/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    expect(await within(dialog).findByText("Give a reason. It is kept in the audit trail.")).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Payment confirmed by bank" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/payslips/publish", { document_ids: [501, 502], reason: "Payment confirmed by bank" }));
    expect(await screen.findByText("Some payslips were not changed")).toBeInTheDocument();
    expect(screen.getByText(/1 skipped/)).toBeInTheDocument();
  });

  it("opens the viewer from a row click through the modal route", async () => {
    signIn(READER);
    routes({ "/payroll/payslips": { total: 1, items: [payslip()] } });
    render(<PayslipsPage />);
    const rows = await screen.findAllByText("Asha Rao");
    fireEvent.click(rows[0]);
    expect(mockPush).toHaveBeenCalledWith("/payroll/payslips?modal=payslip&id=501", { scroll: false });
  });

  it("renders the deep-linked viewer with sections, honest labels and a signed PDF download", async () => {
    signIn(READER);
    mockSearch = new URLSearchParams("modal=payslip&id=501");
    routes({
      "/payroll/payslips": { total: 1, items: [payslip()] },
      "/payroll/payslips/501": payslipDetail(),
      "/payroll/payslips/501/download": { url: "/api/v1/payroll/downloads/tok", expires_at: "2026-11-30T10:05:00Z", expires_in_seconds: 300 },
    });
    render(<PayslipsPage />);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("region", { name: "Earnings" });
    expect(within(dialog).getByRole("link", { name: /Open full page/ })).toHaveAttribute("href", "/payroll/payslips/501");
    expect(within(dialog).getAllByText("FIXTURE — not law").length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("region", { name: "Paid by your employer" })).toBeInTheDocument();
    expect(within(dialog).getByText("Paid by your employer — not part of your take-home pay")).toBeInTheDocument();
    expect(plain(within(dialog).getByRole("region", { name: "Net pay" }).textContent)).toMatch(/82,410\.50/);
    // Payment status comes from evidence, never "Paid" without it.
    expect(within(dialog).queryByText(/^Paid on/)).not.toBeInTheDocument();
    // Readers without pay-run access get no "Why this amount?" buttons (no trace available).
    expect(within(dialog).queryByRole("button", { name: /Why this amount/ })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Download PDF/ }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/payroll/payslips/501/download"));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it("explains an amount from the run trace when the viewer can read pay runs", async () => {
    signIn(me({ [P.PAYROLL_PAYSLIP_READ]: ["COMPANY"], [P.PAYROLL_RUN_READ]: ["COMPANY"] }));
    mockParams = { id: "501" };
    routes({
      "/payroll/runs": { total: 0, items: [] },
      "/payroll/payslips/501": payslipDetail(),
      "/payroll/runs/9/employees/77": { lines: [{ component: "BASIC", kind: "EARNING", amount: { amount: "50000.00", currency: "INR" }, explanation: "Monthly basic for 30 of 30 days.", trace: { formula: "50000 × 30 ÷ 30" }, sources: [] }] },
    });
    render(<PayslipPage />);
    const why = await screen.findByRole("button", { name: "Why this amount? Basic" });
    fireEvent.click(why);
    expect(await screen.findByText("Monthly basic for 30 of 30 days.")).toBeInTheDocument();
    expect(screen.getByText("50000 × 30 ÷ 30")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/payroll/runs/9/employees/77");
  });

  it("shows forbidden or missing payslips as not found on the full page", async () => {
    signIn(READER);
    mockParams = { id: "999" };
    routes({});
    render(<PayslipPage />);
    expect(await screen.findByText("Payslip not found")).toBeInTheDocument();
  });

  it("renders an Arabic payslip right-to-left and marks superseded versions", async () => {
    signIn(READER);
    mockParams = { id: "501" };
    routes({
      "/payroll/payslips/501": payslipDetail({ status: "SUPERSEDED", superseded_at: "2026-12-02T09:00:00Z" }, { languages: ["ar", "en"] }),
      "/payroll/payslips": { total: 1, items: [payslip({ id: 610, version: 2, status: "PUBLISHED" })] },
    });
    render(<PayslipPage />);
    const article = await screen.findByRole("article");
    expect(article).toHaveAttribute("dir", "rtl");
    expect(article).toHaveAttribute("lang", "ar");
    expect(screen.getByText("A newer version of this payslip exists")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Open the latest version" })).toHaveAttribute("href", "/payroll/payslips/610");
  });

  it("states reversals and revisions honestly", async () => {
    signIn(READER);
    mockParams = { id: "501" };
    routes({ "/payroll/payslips/501": payslipDetail({ status: "REVERSED", version: 2 }, { title_key: "REVISED_PAYSLIP", replaces: "PS/ACME/2026-11/0001" }) });
    render(<PayslipPage />);
    expect(await screen.findByText("This payslip was reversed")).toBeInTheDocument();
    expect(screen.getByText("Revised payslip · version 2")).toBeInTheDocument();
    expect(screen.getByText("It replaces payslip PS/ACME/2026-11/0001.")).toBeInTheDocument();
  });

  it("publishes a run manually from the deep link with a reason", async () => {
    signIn(PUBLISHER);
    mockSearch = new URLSearchParams("modal=publish&run=9");
    routes({ "/payroll/payslips": { total: 0, items: [] } });
    mockPost.mockResolvedValue({ run_id: 9, published: 0, waiting: 0, published_manually: 12 });
    render(<PayslipsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Publish payslips manually" });
    expect(within(dialog).getByText(/It cannot be undone/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Bank confirmed credit" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Publish now/ }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/runs/9/publish", { reason: "Bank confirmed credit" }));
  });

  it("queues a ZIP for the chosen run and shows generation failures with retry", async () => {
    signIn(PUBLISHER);
    mockSearch = new URLSearchParams("run_id=9");
    routes({
      "/payroll/payslips": { total: 0, items: [] },
      "/payroll/runs/9/payslips/generation": { run_id: 9, total: 3, counts: { QUEUED: 0, GENERATED: 2, FAILED: 1 }, failed: [{ task_id: 1, run_employee_id: 78, employee: { id: 43, name: "Omar Ali", employee_code: "E0043" }, attempts: 3, retries: 0, error: "Font missing" }], published: 0 },
    });
    mockPost.mockResolvedValue({ id: 31, status: "QUEUED" });
    render(<PayslipsPage />);
    expect(await screen.findByText("Font missing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Download ZIP/ }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/payslips/zip", { run_id: 9 }));
    mockPost.mockResolvedValue({ run_id: 9, requeued: 1 });
    fireEvent.click(screen.getByRole("button", { name: /Retry failed/ }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/runs/9/payslips/retry-failed"));
  });
});
