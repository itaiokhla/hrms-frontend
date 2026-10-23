import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import DownloadsPage from "@/app/(app)/downloads/page";
import ReportDetailPage from "@/app/(app)/payroll/reports/[code]/page";
import ReportsPage from "@/app/(app)/payroll/reports/page";
import { payrollError } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { catalogue, downloadItem, me, notFound, plain, preview, signIn } from "./fixtures";

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
  const EXPORTER = me({ [P.PAYROLL_REPORTS_READ]: ["COMPANY"], [P.PAYROLL_REPORTS_EXPORT]: ["COMPANY"] });

  it("lists the person's own downloads from the unified list and follows the embedded signed link", async () => {
    signIn(EXPORTER);
    routes({
      "/payroll/downloads/mine": {
        total: 3,
        skip: 0,
        limit: 50,
        items: [
          downloadItem(),
          downloadItem({ id: 32, kind: "REGISTER_CSV", title: "Payroll register (CSV)", format: "CSV", status: "FAILED", error: "Run is not finalized", download: null, file_name: null }),
          downloadItem({ source: "REPORT_EXPORT", id: 44, kind: "REPORT", title: "Payroll register (XLSX)", format: "XLSX", run_id: null, report_code: "payroll_register", status: "GENERATING", items: null, download: null, file_name: null, link_endpoint: "/api/v1/payroll/report-exports/44/link" }),
        ],
      },
    });
    const clicked: string[] = [];
    (HTMLAnchorElement.prototype.click as jest.Mock).mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.getAttribute("href") ?? "");
    });
    render(<DownloadsPage />);
    expect((await screen.findAllByText("Payslips (ZIP)")).length).toBeGreaterThan(0);
    expect(mockGet).toHaveBeenCalledWith("/payroll/downloads/mine", { params: { skip: 0, limit: 50 } });
    expect(screen.getAllByText("Run #9 · 120 payslips").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Run is not finalized").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Generating").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Expires/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Download Payslips (ZIP)" })[0]);
    await waitFor(() => expect(clicked).toContain("/api/v1/payroll/downloads/tok-31"));
    // A still-valid embedded link needs no extra request.
    expect(mockPost).not.toHaveBeenCalled();
    // Never the old per-source lists.
    expect(mockGet).not.toHaveBeenCalledWith("/payroll/exports", expect.anything());
    expect(mockGet).not.toHaveBeenCalledWith("/payroll/report-exports", expect.anything());
  });

  it("asks for a fresh signed link when the embedded one has expired (reports through /link)", async () => {
    signIn(EXPORTER);
    const stale = { url: "/api/v1/payroll/downloads/old", expires_at: "2020-01-01T00:00:00Z", expires_in_seconds: 300 };
    routes({
      "/payroll/downloads/mine": {
        total: 2,
        skip: 0,
        limit: 50,
        items: [
          downloadItem({ download: stale }),
          downloadItem({ source: "REPORT_EXPORT", id: 44, kind: "REPORT", title: "Payroll register (XLSX)", format: "XLSX", run_id: null, report_code: "payroll_register", items: 120, download: stale, link_endpoint: "/api/v1/payroll/report-exports/44/link" }),
        ],
      },
    });
    mockPost.mockResolvedValue({ url: "/api/v1/payroll/downloads/fresh", expires_at: "x", expires_in_seconds: 300 });
    render(<DownloadsPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Download Payslips (ZIP)" }))[0]);
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/exports/31/download"));
    fireEvent.click(screen.getAllByRole("button", { name: "Download Payroll register (XLSX)" })[0]);
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/report-exports/44/link"));
    expect(screen.getAllByText("Run #9 · 120 payslips").length).toBeGreaterThan(0);
    expect(screen.getAllByText("120 rows").length).toBeGreaterThan(0);
  });

  it("polls while an export is generating and announces when it is ready", async () => {
    jest.useFakeTimers();
    try {
      signIn(EXPORTER);
      let item = downloadItem({ status: "GENERATING", download: null, file_name: null });
      routes({ "/payroll/downloads/mine": () => ({ total: 1, skip: 0, limit: 50, items: [item] }) });
      render(<DownloadsPage />);
      expect((await screen.findAllByText("Generating")).length).toBeGreaterThan(0);
      item = downloadItem();
      await act(async () => {
        jest.advanceTimersByTime(4100);
      });
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Payslips (ZIP) is ready to download"));
    } finally {
      jest.useRealTimers();
    }
  });

  it("filters by source, pages, and says a report without export access can't be downloaded", async () => {
    signIn(me({ [P.PAYROLL_REPORTS_READ]: ["COMPANY"] }));
    routes({
      "/payroll/downloads/mine": {
        total: 51,
        skip: 0,
        limit: 50,
        items: [downloadItem({ source: "REPORT_EXPORT", id: 44, kind: "REPORT", title: "Payroll register (XLSX)", format: "XLSX", run_id: null, items: 12, download: null })],
      },
    });
    render(<DownloadsPage />);
    // services/reports.can_download: export permission, the report's own permissions and the file's scope.
    expect((await screen.findAllByText("Your report access no longer covers this file")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Download Payroll register (XLSX)" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "REPORT_EXPORT" } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/payroll/downloads/mine", { params: { source: "REPORT_EXPORT", skip: 0, limit: 50 } }));
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/payroll/downloads/mine", { params: { source: "REPORT_EXPORT", skip: 50, limit: 50 } }));
  });

  it("offers no download for a ready payslip ZIP or register the person can no longer export", async () => {
    signIn(me({ [P.PAYROLL_PAYSLIP_READ]: ["COMPANY"] }));
    // services/downloads.py sends no link once payroll:reports:export (or the run's scope) is gone.
    routes({ "/payroll/downloads/mine": { total: 1, skip: 0, limit: 50, items: [downloadItem({ download: null })] } });
    render(<DownloadsPage />);
    expect((await screen.findAllByText("Needs export access to this run")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Download Payslips (ZIP)" })).not.toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("shows an empty state with next actions", async () => {
    signIn(me({ [P.PAYROLL_PAYSLIP_READ]: ["COMPANY"] }));
    routes({ "/payroll/downloads/mine": { total: 0, skip: 0, limit: 50, items: [] } });
    render(<DownloadsPage />);
    expect(await screen.findByText("No downloads yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open payslips" })).toHaveAttribute("href", "/payroll/payslips");
    expect(screen.queryByRole("link", { name: "Open reports" })).not.toBeInTheDocument();
  });

  it("refreshes after an expired export is refused", async () => {
    signIn(me({}));
    // The embedded link went stale, so a fresh one is requested; the server says the export is gone.
    const stale = { url: "/api/v1/payroll/downloads/old", expires_at: "2020-01-01T00:00:00Z", expires_in_seconds: 300 };
    routes({ "/payroll/downloads/mine": { total: 1, skip: 0, limit: 50, items: [downloadItem({ download: stale })] } });
    mockPost.mockRejectedValue(payrollError(409, { detail: "This export is not ready.", code: "EXPORT_NOT_READY" }));
    render(<DownloadsPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Download Payslips (ZIP)" }))[0]);
    await waitFor(() => expect(mockGet.mock.calls.filter(([u]) => u === "/payroll/downloads/mine").length).toBeGreaterThan(1));
  });

  it("shows an error with Retry when the list fails", async () => {
    signIn(me({}));
    routes({ "/payroll/downloads/mine": payrollError(500, { detail: "Database unavailable" }) });
    render(<DownloadsPage />);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
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
    fireEvent.change(within(dialog).getByLabelText("Format"), { target: { value: "PDF" } });
    expect(within(dialog).getByTestId("pdf-cap-note")).toHaveTextContent("first 5,000 rows");
    fireEvent.change(within(dialog).getByLabelText("Format"), { target: { value: "XLSX" } });
    expect(within(dialog).queryByTestId("pdf-cap-note")).not.toBeInTheDocument();
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
    // The server sets `exportable` from the viewer's export permission (reports.catalogue).
    const readerCatalogue = { ...catalogue(), groups: catalogue().groups.map((g) => ({ ...g, reports: g.reports.map((r) => ({ ...r, exportable: false })) })) };
    routes({ "/payroll/reports": readerCatalogue, "/payroll/reports/payroll_register/preview": preview() });
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
