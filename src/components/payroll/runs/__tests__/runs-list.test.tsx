import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import PayRunsPage from "@/app/(app)/payroll/runs/page";
import { ConfirmProvider } from "@/components/ui/overlay";

import { PAYROLL_ADMIN, VIEWER, me, plain, run, signIn } from "./fixtures";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSearch = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  usePathname: () => "/payroll/runs",
  useSearchParams: () => mockSearch,
  useParams: () => ({}),
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("@/lib/payroll/api", () => {
  const actual = jest.requireActual("@/lib/payroll/api");
  return {
    ...actual,
    payrollApi: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  };
});

const MINE = run({ id: 41, available_actions: ["SUBMIT_FOR_APPROVAL", "RECALCULATE"] });
const OTHERS = run({ id: 40, number: "PR-2026-0040", label: "Oct 2026 · Monthly IN", status: "FINALIZED", stage: 6, available_actions: [], totals: { INR: { net: "512000.00" }, USD: { net: "7650.25" } } });

function routes({ list = { total: 2, items: [MINE, OTHERS] } as unknown, existing = [] as unknown[], mine = { total: 1, items: [MINE] } as unknown } = {}) {
  mockGet.mockImplementation((url: string, options?: { params?: Record<string, unknown> }) => {
    if (url === "/payroll/runs") {
      if (options?.params?.pay_period_id) return Promise.resolve({ total: existing.length, items: existing });
      if (options?.params?.needs_my_action) return Promise.resolve(mine);
      return list instanceof Error ? Promise.reject(list) : Promise.resolve(list);
    }
    if (url === "/legal-entities") return Promise.resolve([{ id: 1, code: "ACME-IN", legal_name: "Acme India Pvt Ltd" }]);
    if (url === "/payroll/org/pay-groups") return Promise.resolve([{ id: 3, code: "IN-M", name: "Monthly IN", legal_entity_id: 1, currency: "INR", status: "ACTIVE" }]);
    if (url === "/payroll/pay-groups/3/periods") return Promise.resolve({ total: 1, items: [{ id: 5, pay_group_id: 3, start: "2026-11-01", end: "2026-11-30", pay_date: "2026-11-30", input_cutoff: "2026-11-25", approval_deadline: "2026-11-27", status: "OPEN" }] });
    if (url === "/payroll/run-population-preview")
      return Promise.resolve({
        eligible: 12,
        included: 10,
        excluded: 2,
        excluded_by_reason: { NO_SALARY: 2 },
        items: [
          { employee_id: 142, status: "INCLUDED", exclusion_reason: null, employee_code: "E0142", employee_name: "Asha Rao" },
          { employee_id: 143, status: "EXCLUDED", exclusion_reason: "NO_SALARY", employee_code: "E0143", employee_name: "Vikram S" },
        ],
      });
    return Promise.resolve([]);
  });
}

const wrap = (node: ReactNode) => render(<ConfirmProvider>{node}</ConfirmProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  window.localStorage.clear();
});

describe("Pay Runs list", () => {
  it("denies the page without payroll:run:read", () => {
    signIn(me({}));
    wrap(<PayRunsPage />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("lists runs with number, status, stage and net per currency from string amounts", async () => {
    signIn(PAYROLL_ADMIN);
    routes();
    wrap(<PayRunsPage />);
    expect((await screen.findAllByText("Nov 2026 · Monthly IN")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("PR-2026-0041").length).toBeGreaterThan(0);
    const text = plain(document.body.textContent);
    expect(text).toMatch(/5,48,250\.75|548,250\.75/);
    expect(text).toMatch(/7,650\.25/);
    expect(screen.getByRole("button", { name: "Hide amounts" })).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/payroll/runs", { params: { skip: 0, limit: 50 } });
  });

  it("asks the server for runs that need my action, with normal paging", async () => {
    signIn(PAYROLL_ADMIN);
    routes({ mine: { total: 51, items: [MINE] } });
    wrap(<PayRunsPage />);
    await screen.findAllByText("Oct 2026 · Monthly IN");
    fireEvent.click(screen.getByLabelText("Needs my action"));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/payroll/runs", { params: { needs_my_action: true, skip: 0, limit: 50 } }));
    // The server decides; the client does not filter the page again (OTHERS is not returned at all).
    await waitFor(() => expect(screen.queryAllByText("Oct 2026 · Monthly IN")).toHaveLength(0));
    expect(screen.getAllByText("Nov 2026 · Monthly IN").length).toBeGreaterThan(0);
    // Paging stays available: 51 runs need action, so a second page exists.
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Needs my action"));
    await waitFor(() => {
      const runCalls = mockGet.mock.calls.filter(([url]) => url === "/payroll/runs");
      expect(runCalls[runCalls.length - 1]).toEqual(["/payroll/runs", { params: { skip: 0, limit: 50 } }]);
    });
  });

  it("opens with the filter on from ?mine=1 and explains an empty result", async () => {
    signIn(PAYROLL_ADMIN);
    mockSearch = new URLSearchParams("mine=1");
    routes({ mine: { total: 0, items: [] } });
    wrap(<PayRunsPage />);
    expect(await screen.findByText("Nothing needs your action")).toBeInTheDocument();
    expect(screen.getByText("No run in your scope is waiting for a step you can take now.")).toBeInTheDocument();
    expect(screen.getByLabelText("Needs my action")).toBeChecked();
    expect(mockGet).not.toHaveBeenCalledWith("/payroll/runs", { params: { skip: 0, limit: 50 } });
  });

  it("shows the empty state with New pay run for a creator only", async () => {
    signIn(PAYROLL_ADMIN);
    routes({ list: { total: 0, items: [] } });
    const { unmount } = wrap(<PayRunsPage />);
    expect(await screen.findByText("No pay runs yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /New pay run/ }).length).toBe(2);
    unmount();

    signIn(VIEWER);
    wrap(<PayRunsPage />);
    expect(await screen.findByText("Runs appear here once payroll creates them.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New pay run/ })).not.toBeInTheDocument();
  });

  it("shows an error with Retry", async () => {
    signIn(PAYROLL_ADMIN);
    routes({ list: new Error("boom") });
    wrap(<PayRunsPage />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    routes();
    fireEvent.click(retry);
    expect((await screen.findAllByText("Nov 2026 · Monthly IN")).length).toBeGreaterThan(0);
  });

  it("opens a run on row click", async () => {
    signIn(VIEWER);
    routes();
    wrap(<PayRunsPage />);
    fireEvent.click((await screen.findAllByText("Oct 2026 · Monthly IN"))[0]);
    expect(mockPush).toHaveBeenCalledWith("/payroll/runs/40");
  });
});

describe("New pay run modal", () => {
  async function openModal() {
    mockSearch = new URLSearchParams("modal=new-run");
    wrap(<PayRunsPage />);
    return screen.findByRole("dialog");
  }

  it("validates inline with a summary and sends nothing", async () => {
    signIn(PAYROLL_ADMIN);
    routes();
    const dialog = await openModal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create pay run" }));
    expect(await within(dialog).findByText("Fix these to continue:")).toBeInTheDocument();
    expect(within(dialog).getAllByText("Choose a pay group.").length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("walks entity → pay group → period → type, previews the population, warns about duplicates and creates", async () => {
    signIn(PAYROLL_ADMIN);
    routes({ existing: [run({ id: 39, number: "PR-2026-0039", status: "DRAFT" })] });
    mockPost.mockResolvedValue({ id: 42, number: "PR-2026-0042", status: "DRAFT", row_version: 1, population: {} });
    const dialog = await openModal();
    await waitFor(() => expect(within(dialog).getByRole("option", { name: /Monthly IN · INR/ })).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText(/^Pay group/), { target: { value: "3" } });
    await waitFor(() => expect(within(dialog).getByRole("option", { name: /pay date 2026-11-30/ })).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText(/^Pay period/), { target: { value: "5" } });
    expect(await within(dialog).findByText(/eligible 12 = included 10 \+ excluded 2/)).toBeInTheDocument();
    expect(within(dialog).getByText(/No salary × 2/)).toBeInTheDocument();
    expect(await within(dialog).findByText("A regular run already exists for this period")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/payroll/runs", { params: { pay_group_id: 3, pay_period_id: 5, run_type: "REGULAR", limit: 20 } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Create pay run" }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        "/payroll/runs",
        { run_type: "REGULAR", pay_group_id: 3, pay_period_id: 5, label: null },
        { idempotencyKey: expect.any(String) },
      ),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/payroll/runs/42"));
  });

  it("needs exactly one employee for a final settlement", async () => {
    signIn(PAYROLL_ADMIN);
    routes();
    mockPost.mockResolvedValue({ id: 43, number: "PR-2026-0043", status: "DRAFT", row_version: 1, population: {} });
    const dialog = await openModal();
    await waitFor(() => expect(within(dialog).getByRole("option", { name: /Monthly IN · INR/ })).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("radio", { name: "Final settlement" }));
    fireEvent.change(within(dialog).getByLabelText(/^Pay group/), { target: { value: "3" } });
    await waitFor(() => expect(within(dialog).getByRole("option", { name: /pay date/ })).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText(/^Pay period/), { target: { value: "5" } });
    await within(dialog).findByText(/eligible 12/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create pay run" }));
    expect((await within(dialog).findAllByText("Select exactly one employee.")).length).toBeGreaterThan(0);
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByLabelText(/Vikram S/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create pay run" }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/payroll/runs", { run_type: "FINAL_SETTLEMENT", pay_group_id: 3, pay_period_id: 5, label: null, employee_ids: [143] }, { idempotencyKey: expect.any(String) }),
    );
  });

  it("shows the server's 409 reason", async () => {
    signIn(PAYROLL_ADMIN);
    routes();
    const { payrollError } = jest.requireActual("@/lib/payroll/api");
    mockPost.mockRejectedValue(payrollError(409, { detail: { message: "A regular run already exists for this period." }, code: "DUPLICATE_RUN" }));
    const dialog = await openModal();
    await waitFor(() => expect(within(dialog).getByRole("option", { name: /Monthly IN · INR/ })).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText(/^Pay group/), { target: { value: "3" } });
    await waitFor(() => expect(within(dialog).getByRole("option", { name: /pay date/ })).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText(/^Pay period/), { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create pay run" }));
    expect(await within(dialog).findByText("This run can't be created")).toBeInTheDocument();
    expect(within(dialog).getByText("A regular run already exists for this period.")).toBeInTheDocument();
  });
});
