import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import DownloadsPage from "@/app/(app)/downloads/page";
import ReportDetailPage from "@/app/(app)/payroll/reports/[code]/page";
import ReportsPage from "@/app/(app)/payroll/reports/page";
import { payrollError } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { catalogue, documentExport, me, notFound, plain, preview, reportExport, signIn } from "./fixtures";

const mockPush = jest.fn();
let mockSearch = new URLSearchParams();
let mockParams: Record<string, string> = {};
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/payroll/reports",
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

function routes(map: Record<string, unknown>) {
  mockGet.mockImplementation((url: string) => {
    if (!(url in map)) return Promise.reject(notFound("Thing"));
    const value = map[url];
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(typeof value === "function" ? (value as () => unknown)() : value);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockParams = {};
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = jest.fn(() => "blob:x");
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = jest.fn();
});

/* ------------------------------------------------------------------ download center */

describe("Download center", () => {
  it("lists the person's own exports from both sources with status and signed download", async () => {
    signIn(me({ [P.PAYROLL_REPORTS_READ]: ["COMPANY"], [P.PAYROLL_REPORTS_EXPORT]: ["COMPANY"] }));
    routes({
      "/payroll/exports": { total: 2, items: [documentExport(), documentExport({ id: 32, status: "FAILED", error: "Run is not finalized", kind: "REGISTER_CSV" })] },
      "/payroll/report-exports": { items: [reportExport()] },
    });
    mockPost.mockResolvedValue({ url: "/api/v1/payroll/downloads/abc", expires_at: "x", expires_in_seconds: 300 });
    render(<DownloadsPage />);
    expect((await screen.findAllByText("Payslips (ZIP)")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Payroll register (XLSX)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Run is not finalized").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Generating").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Expires/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Download Payslips (ZIP)" })[0]);
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/exports/31/download"));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it("polls while an export is generating and announces when it is ready", async () => {
    jest.useFakeTimers();
    try {
      signIn(me({ [P.PAYROLL_REPORTS_READ]: ["COMPANY"], [P.PAYROLL_REPORTS_EXPORT]: ["COMPANY"] }));
      let report = reportExport();
      routes({ "/payroll/exports": { total: 0, items: [] }, "/payroll/report-exports": () => ({ items: [report] }) });
      render(<DownloadsPage />);
      expect((await screen.findAllByText("Generating")).length).toBeGreaterThan(0);
      report = reportExport({ status: "READY", file_name: "payroll_register.xlsx", rows: 120, bytes: 4096, expires_at: "2026-12-01T11:00:00Z" });
      await act(async () => {
        jest.advanceTimersByTime(4100);
      });
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Payroll register (XLSX) is ready to download"));
      mockHttpGet.mockResolvedValue({ data: new Blob(["x"]) });
      fireEvent.click(screen.getAllByRole("button", { name: "Download Payroll register (XLSX)" })[0]);
      await waitFor(() => expect(mockHttpGet).toHaveBeenCalledWith("/payroll/report-exports/44/download", { responseType: "blob" }));
    } finally {
      jest.useRealTimers();
    }
  });

  it("shows report exports only to report readers and an empty state with next actions", async () => {
    signIn(me({ [P.PAYROLL_PAYSLIP_READ]: ["COMPANY"] }));
    routes({ "/payroll/exports": { total: 0, items: [] } });
    render(<DownloadsPage />);
    expect(await screen.findByText("No downloads yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open payslips" })).toHaveAttribute("href", "/payroll/payslips");
    expect(screen.queryByRole("link", { name: "Open reports" })).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalledWith("/payroll/report-exports", expect.anything());
  });

  it("refreshes after an expired export is refused", async () => {
    signIn(me({}));
    routes({ "/payroll/exports": { total: 1, items: [documentExport()] } });
    mockPost.mockRejectedValue(payrollError(409, { detail: "This export is not ready.", code: "EXPORT_NOT_READY" }));
    render(<DownloadsPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Download Payslips (ZIP)" }))[0]);
    await waitFor(() => expect(mockGet.mock.calls.filter(([u]) => u === "/payroll/exports").length).toBeGreaterThan(1));
  });
});

/* ------------------------------------------------------------------ reports */

describe("Reports", () => {
  const READER = me({ [P.PAYROLL_REPORTS_READ]: ["COMPANY"] });
  const EXPORTER = me({ [P.PAYROLL_REPORTS_READ]: ["COMPANY"], [P.PAYROLL_REPORTS_EXPORT]: ["COMPANY"] });

  it("is denied without report access", () => {
    signIn(me({ [P.PAYROLL_PAYSLIP_READ]: ["COMPANY"] }));
    render(<ReportsPage />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("groups the catalogue by purpose and states unavailable reports honestly", async () => {
    signIn(READER);
    routes({ "/payroll/reports": { ...catalogue(), groups: catalogue().groups.map((g) => ({ ...g, reports: g.reports.map((r) => ({ ...r, exportable: false })) })) } });
    render(<ReportsPage />);
    expect(await screen.findByRole("region", { name: "Payroll" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Money out" })).toBeInTheDocument();
    expect(screen.getByText("Payments are not available yet.")).toBeInTheDocument();
    expect(screen.getByText("Small groups hidden")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Preview Payroll register" })).toHaveAttribute("href", "/payroll/reports/payroll_register");
    expect(screen.queryByRole("button", { name: /^Export / })).not.toBeInTheDocument();
  });

  it("queues an export from the deep-linked modal and points to downloads", async () => {
    signIn(EXPORTER);
    mockSearch = new URLSearchParams("modal=report&code=payroll_register");
    routes({ "/payroll/reports": catalogue() });
    mockPost.mockResolvedValue({ id: 44, job_id: 44, status: "QUEUED", report_code: "payroll_register", format: "XLSX" });
    render(<ReportsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Export · Payroll register" });
    fireEvent.change(within(dialog).getByLabelText("Format"), { target: { value: "XLSX" } });
    fireEvent.change(within(dialog).getByLabelText("Period from"), { target: { value: "2026-11-30" } });
    fireEvent.change(within(dialog).getByLabelText("Period to"), { target: { value: "2026-11-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Queue export" }));
    expect((await within(dialog).findAllByText("The period ends before it starts.")).length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Period to"), { target: { value: "2026-12-31" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Queue export" }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/payroll/reports/payroll_register/exports", { format: "XLSX", filters: { period_from: "2026-11-30", period_to: "2026-12-31" } }),
    );
    expect(await within(dialog).findByRole("link", { name: /Open downloads/ })).toHaveAttribute("href", "/downloads");
  });

  it("previews the first rows with per-currency totals and exact string money", async () => {
    signIn(READER);
    mockParams = { code: "payroll_register" };
    routes({ "/payroll/reports": catalogue(), "/payroll/reports/payroll_register/preview": preview() });
    render(<ReportDetailPage />);
    expect(await screen.findByText("Showing the first 2 of 120 rows. Export to get every row.")).toBeInTheDocument();
    const totals = screen.getByRole("region", { name: "Totals per currency" });
    expect(plain(totals.textContent)).toMatch(/82,410\.50/);
    expect(plain(totals.textContent)).toMatch(/4,100\.250/);
    expect(within(totals).getByText("KWD")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/payroll/reports/payroll_register/preview", { params: {} });
    // Readers without export rights see no export action.
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
  });

  it("re-runs the preview with filters and discloses the FX basis of a converted total", async () => {
    signIn(READER);
    mockParams = { code: "payroll_register" };
    routes({
      "/payroll/reports": catalogue(),
      "/payroll/reports/payroll_register/preview": preview({
        converted: { currency: "USD", available: true, date: "2026-11-30", totals: { net: { amount: "14321.40", currency: "USD" } }, label: "Converted at ECB reference rates", rates: [{ base: "INR", quote: "USD", rate: "0.0120", source: "ECB", as_of: "2026-11-30" }] },
      }),
    });
    render(<ReportDetailPage />);
    await screen.findByText(/Showing the first 2/);
    fireEvent.change(screen.getByLabelText(/Convert totals to/), { target: { value: "usd" } });
    fireEvent.click(screen.getByRole("button", { name: /Update preview/ }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/payroll/reports/payroll_register/preview", { params: { convert_to: "USD" } }));
    const converted = await screen.findByRole("region", { name: "Converted to USD" });
    expect(within(converted).getByText(/Converted at ECB reference rates/)).toBeInTheDocument();
    expect(within(converted).getByText(/ECB · 30 Nov 2026/)).toBeInTheDocument();
  });

  it("shows unknown report codes as not found", async () => {
    signIn(READER);
    mockParams = { code: "nope" };
    routes({ "/payroll/reports": catalogue() });
    render(<ReportDetailPage />);
    expect(await screen.findByText("Report not found")).toBeInTheDocument();
  });

  it("keeps the fixture watermark and server notes in the preview", async () => {
    signIn(READER);
    mockParams = { code: "payroll_register" };
    routes({ "/payroll/reports": catalogue(), "/payroll/reports/payroll_register/preview": preview({ watermark: "FIXTURE — not law", notes: ["2 group(s) with fewer than 5 employees are hidden (privacy.small_group_suppression_size)."] }) });
    render(<ReportDetailPage />);
    expect(await screen.findByText("FIXTURE — not law")).toBeInTheDocument();
    expect(screen.getByText(/fewer than 5 employees are hidden/)).toBeInTheDocument();
  });
});
