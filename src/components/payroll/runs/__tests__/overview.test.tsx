import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import PayrollOverviewPage from "@/app/(app)/payroll/page";
import { ConfirmProvider } from "@/components/ui/overlay";
import { P } from "@/lib/permissions.generated";

import { waitingFor } from "../Overview";
import { INPUTS_ONLY, PAYROLL_ADMIN, VIEWER, me, overview, plain, run, signIn } from "./fixtures";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSearch = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  usePathname: () => "/payroll",
  useSearchParams: () => mockSearch,
  useParams: () => ({}),
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock("react-countup", () => ({ __esModule: true, default: ({ end }: { end: number }) => <>{end}</> }));
jest.mock("@/components/payroll/settings/SetupChecklist", () => ({ SetupChecklist: () => <div>Setup checklist</div> }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("@/lib/payroll/api", () => {
  const actual = jest.requireActual("@/lib/payroll/api");
  return {
    ...actual,
    payrollApi: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  };
});

function routes(data: unknown = overview()) {
  mockGet.mockImplementation((url: string) => {
    if (url === "/payroll/overview") return data instanceof Error ? Promise.reject(data) : Promise.resolve(data);
    if (url === "/payroll/runs/41") return Promise.resolve(run());
    if (url === "/legal-entities") return Promise.resolve([{ id: 1, code: "ACME-IN", legal_name: "Acme India Pvt Ltd" }]);
    if (url === "/payroll/org/pay-groups") return Promise.resolve([{ id: 3, code: "IN-M", name: "Monthly IN", legal_entity_id: 1, currency: "INR", status: "ACTIVE" }]);
    if (url === "/branches") return Promise.resolve([]);
    if (url.startsWith("/payroll/overview/")) return Promise.resolve({ kpi: "without_salary", total: 1, items: [{ assignment_id: 1, employee_id: 142, employee_code: "E0142", employee_name: "Asha Rao", legal_entity_id: 1, pay_group_id: 3, pay_group: "IN-M", branch_id: null, currency: "INR", with_salary: false, processed: false, paid: false, on_hold: false, run_ids: [] }] });
    return Promise.resolve([]);
  });
}

const wrap = (node: ReactNode) => render(<ConfirmProvider>{node}</ConfirmProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  window.localStorage.clear();
});

describe("Payroll overview", () => {
  it("denies the page to someone without any payroll access", () => {
    signIn(me({}));
    wrap(<PayrollOverviewPage />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalledWith("/payroll/overview", expect.anything());
  });

  it("keeps the setup checklist and the role's pages for people without pay-run access", async () => {
    signIn(INPUTS_ONLY);
    routes();
    wrap(<PayrollOverviewPage />);
    expect(await screen.findByText("Setup checklist")).toBeInTheDocument();
    expect(screen.getByText("Your payroll pages")).toBeInTheDocument();
    expect(screen.queryByText("Total employees")).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalledWith("/payroll/overview", expect.anything());
  });

  it("gives a legacy payroll manager with pay-run and configuration access the KPIs, with the settings and legacy links", async () => {
    signIn(me({ [P.PAYROLL_READ]: ["COMPANY"], [P.PAYROLL_RUN_READ]: ["COMPANY"], [P.PAYROLL_CONFIGURATION_READ]: ["COMPANY"] }));
    routes();
    wrap(<PayrollOverviewPage />);
    expect(await screen.findByText("Total employees")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Payroll", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Legacy payroll/ })).toHaveAttribute("href", "/payroll/legacy");
    expect(screen.getByRole("link", { name: /Payroll settings/ })).toHaveAttribute("href", "/settings/payroll/general");
    // The checklist belongs to the shell of people without pay-run access.
    expect(screen.queryByText("Setup checklist")).not.toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/payroll/overview", { params: {} });
  });

  it("shows KPIs, Draft money per currency, the current run, exceptions with Fix links and deadlines", async () => {
    signIn(PAYROLL_ADMIN);
    routes();
    wrap(<PayrollOverviewPage />);
    expect(await screen.findByText("Total employees")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide amounts" })).toBeInTheDocument();
    // "Without salary → Assign" link with the count
    expect(screen.getByRole("link", { name: /2 → Assign/ })).toHaveAttribute("href", "/payroll/compensation");
    // Paid comes from settlement evidence only
    expect(screen.getByText("Settlement evidence only")).toBeInTheDocument();
    // Money is labelled with the run stage and kept per currency
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
    expect(plain(document.body.textContent)).toMatch(/USD/);
    // No statutory card when no pack defines statutory items
    expect(screen.queryByText("Statutory")).not.toBeInTheDocument();
    // Current run with its stepper and "Waiting for"
    expect(await screen.findByText("Review and submission for approval")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open run" })[0]).toHaveAttribute("href", "/payroll/runs/41");
    // Exceptions panel
    expect(screen.getAllByText(/1 without a bank account/).length).toBeGreaterThan(0);
    const fixLinks = screen.getAllByRole("link", { name: /^Fix/ });
    expect(fixLinks.map((l) => l.getAttribute("href"))).toEqual(expect.arrayContaining(["/payroll/compensation", "/payroll/runs/41?tab=exceptions"]));
    // Deadlines
    expect(screen.getByText("Input cutoff")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/payroll/overview", { params: {} });
  });

  it("shows the statutory card only where a pack defines items, with its watermark", async () => {
    signIn(PAYROLL_ADMIN);
    routes(overview({ statutory: [{ legal_entity_id: 1, pack_version: "IN 0.1", watermark: "FIXTURE — not law", items: [{ code: "PF", label: "Provident fund", amount: "36000.00", currency: "INR", stage: "Draft" }] }] }));
    wrap(<PayrollOverviewPage />);
    expect(await screen.findByText("Statutory")).toBeInTheDocument();
    expect(screen.getByText("Provident fund")).toBeInTheDocument();
    expect(screen.getByText("FIXTURE — not law")).toBeInTheDocument();
  });

  it("says to add employees first when nobody is in a pay group", async () => {
    signIn(PAYROLL_ADMIN);
    routes(overview({ empty_state: "NO_EMPLOYEES", kpis: { eligible: 0, with_salary: 0, without_salary: 0, processed: 0, paid: 0, on_hold: 0 }, money: [], deadlines: [] }));
    wrap(<PayrollOverviewPage />);
    expect(await screen.findByText("Add employees first")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to employees" })).toHaveAttribute("href", "/employees");
    expect(screen.getByText("Setup checklist")).toBeInTheDocument();
  });

  it("shows the zero-salary checklist and never a zero paid amount", async () => {
    signIn(PAYROLL_ADMIN);
    routes(
      overview({
        empty_state: "NO_SALARIES",
        kpis: { eligible: 12, with_salary: 0, without_salary: 12, processed: 0, paid: 0, on_hold: 0 },
        money: [],
        deadlines: [],
        exceptions: { open: 0, blocking: 0, by_code: {} },
        processing_disabled_reason: "Assign salaries before processing payroll.",
      }),
    );
    wrap(<PayrollOverviewPage />);
    expect(await screen.findByText("12 employees · 0 salaries")).toBeInTheDocument();
    expect(screen.getByText("Assign salaries")).toBeInTheDocument();
    expect(plain(document.body.textContent)).not.toMatch(/₹\s?0(\.00)?\s*paid/i);
    expect(screen.getAllByText("No calculated run in this view yet").length).toBeGreaterThan(0);
    // New pay run is blocked with the reason
    const newRun = screen.getAllByRole("button", { name: /New pay run/ })[0];
    expect(newRun).toBeDisabled();
    expect(screen.getAllByText("Assign salaries before processing payroll.").length).toBeGreaterThan(0);
  });

  it("shows an error with Retry", async () => {
    signIn(PAYROLL_ADMIN);
    routes(new Error("boom"));
    wrap(<PayrollOverviewPage />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    routes();
    fireEvent.click(retry);
    expect(await screen.findByText("Total employees")).toBeInTheDocument();
  });

  it("hides New pay run from a reader and opens the deep-linked modal for a creator", async () => {
    signIn(VIEWER);
    routes();
    const { unmount } = wrap(<PayrollOverviewPage />);
    await screen.findByText("Total employees");
    expect(screen.queryByRole("button", { name: /New pay run/ })).not.toBeInTheDocument();
    unmount();

    signIn(PAYROLL_ADMIN);
    wrap(<PayrollOverviewPage />);
    await screen.findByText("Total employees");
    fireEvent.click(screen.getAllByRole("button", { name: /New pay run/ })[0]);
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("modal=new-run"), expect.anything());
  });

  it("drills into a KPI list from the same query", async () => {
    signIn(PAYROLL_ADMIN);
    routes();
    mockSearch = new URLSearchParams("modal=kpi&kpi=without_salary");
    wrap(<PayrollOverviewPage />);
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/payroll/overview/without_salary", { params: { limit: 500 } }));
  });
});

describe("waitingFor", () => {
  it("names the approver of the current step and never says Paid before settlement", () => {
    expect(waitingFor("APPROVAL_PENDING", { id: 1, status: "pending", current_step: 2, pending_reason: null, requested_by: null, can_act: false, acting_as: null, steps: [{ step_order: 2, approver_label: "Finance head", approver: "Ravi K", status: "pending", acted_by: null, acted_at: null, remarks: null }] })).toBe("Ravi K");
    expect(waitingFor("SUBMITTED")).toBe("Bank settlement evidence");
    expect(waitingFor("REVIEW_REQUIRED")).toBe("Review and submission for approval");
  });
});
