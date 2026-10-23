import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import RunEmployeePage from "@/app/(app)/payroll/runs/[id]/employees/[eid]/page";
import { ConfirmProvider } from "@/components/ui/overlay";

import { explainProps, toSource } from "../EmployeeInRun";
import type { RunEmployeeDetail } from "../types";
import { PAYROLL_ADMIN, VIEWER, employeeDetail, notFound, plain, run, signIn } from "./fixtures";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSearch = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  usePathname: () => "/payroll/runs/41/employees/501",
  useSearchParams: () => mockSearch,
  useParams: () => ({ id: "41", eid: "501" }),
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

function routes(detail: RunEmployeeDetail | Error = employeeDetail(), current = run()) {
  mockGet.mockImplementation((url: string) => {
    if (url === "/payroll/runs/41") return Promise.resolve(current);
    if (url === "/payroll/runs/41/employees/501") return detail instanceof Error ? Promise.reject(detail) : Promise.resolve(detail);
    return Promise.resolve([]);
  });
}

const wrap = (node: ReactNode) => render(<ConfirmProvider>{node}</ConfirmProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  window.localStorage.clear();
});

describe("Employee in run (full page)", () => {
  it("shows lines with rate, this-period amounts from strings and the FIXTURE badge", async () => {
    signIn(PAYROLL_ADMIN);
    routes();
    wrap(<RunEmployeePage />);
    expect(await screen.findByRole("heading", { name: "Asha Rao" })).toBeInTheDocument();
    expect(screen.getByText("Basic salary")).toBeInTheDocument();
    const text = plain(document.body.textContent);
    expect(text).toMatch(/55,124\.50/);
    expect(text).toMatch(/41,250\.00/);
    expect(screen.getByText("FIXTURE — not law")).toBeInTheDocument();
    expect(screen.getByText("1 HR-only line(s) are hidden for your role.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Nov 2026 · Monthly IN/ })).toHaveAttribute("href", "/payroll/runs/41?tab=employees");
  });

  it("opens “Why this amount?” with the formula, rounding and permitted sources", async () => {
    signIn(PAYROLL_ADMIN);
    routes();
    wrap(<RunEmployeePage />);
    const why = await screen.findByRole("button", { name: "Why this amount? Basic salary" });
    expect(why).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(why);
    expect(why).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("Why this amount?")).toBeInTheDocument();
    expect(screen.getAllByText(/Monthly basic prorated for 27.5 of 30 paid days/).length).toBeGreaterThan(0);
  });

  it("offers wage input, hold and recalculate to someone who may, and nothing to a reader", async () => {
    signIn(PAYROLL_ADMIN);
    routes();
    const { unmount } = wrap(<RunEmployeePage />);
    const bar = await screen.findByRole("toolbar", { name: "Employee actions" });
    expect(within(bar).getByRole("link", { name: /Add wage input/ })).toHaveAttribute("href", "/payroll/inputs?modal=wage-input&employee=142");
    expect(within(bar).getByRole("button", { name: /Put on hold/ })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: /Recalculate this employee/ })).toBeInTheDocument();
    unmount();

    signIn(VIEWER);
    // The server computes available actions per user: a reader gets none.
    routes(employeeDetail(), run({ available_actions: [] }));
    wrap(<RunEmployeePage />);
    await screen.findByText("Basic salary");
    expect(screen.queryByRole("toolbar", { name: "Employee actions" })).not.toBeInTheDocument();
  });

  it("recalculates only this employee (by employee id)", async () => {
    signIn(PAYROLL_ADMIN);
    routes();
    mockPost.mockResolvedValue({ run: { id: 41, number: "PR-2026-0041", status: "CALCULATING", row_version: 7 }, job: { id: 9, status: "QUEUED" }, employees: 1, action: "RECALCULATE" });
    wrap(<RunEmployeePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Recalculate this employee/ }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/runs/41/calculate", { employee_ids: [142], row_version: 6 }, { idempotencyKey: expect.any(String) }));
  });

  it("holds the employee with a required note", async () => {
    signIn(PAYROLL_ADMIN);
    routes();
    mockSearch = new URLSearchParams("modal=hold&employee=501");
    mockPost.mockResolvedValue({ id: 501, employee_id: 142, status: "CALCULATED", hold_type: "PAYMENT", row_version: 4 });
    wrap(<RunEmployeePage />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Put on hold" }));
    expect(await within(dialog).findByText(/Add a note/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/^Note/), { target: { value: "Bank account disputed" } });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "BANK_ISSUE" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Put on hold" }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/payroll/runs/41/employees/501/hold", { hold_type: "PAYMENT", reason_code: "BANK_ISSUE", note: "Bank account disputed" }),
    );
  });

  it("shows a forbidden or unknown employee as not found", async () => {
    signIn(PAYROLL_ADMIN);
    routes(notFound());
    wrap(<RunEmployeePage />);
    expect(await screen.findByText("Employee in this run not found")).toBeInTheDocument();
  });
});

describe("explain helpers", () => {
  it("builds the explanation, formula, rounding and sources without exposing restricted links", () => {
    const line = employeeDetail().lines[0];
    const props = explainProps(line);
    expect(props.explanation).toBe("Monthly basic prorated for 27.5 of 30 paid days.");
    expect(props.formula).toBe("45000 × 27.5 / 30");
    expect(props.rounding).toBe("Half up to 0.01 (41250.000 → 41250.00)");
    expect(props.sources).toEqual([
      { label: "#12", href: "/payroll/compensation/12", kind: "Salary" },
      { label: "Restricted record", kind: "Attendance day" },
    ]);
    expect(toSource({ type: "wage_input", id: 3, link: "https://evil.example" })).toEqual({ label: "#3", href: undefined, kind: "Wage input" });
  });
});
