import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import OvertimePage from "@/app/(app)/overtime/page";
import TaskPage from "@/app/(app)/tasks/[id]/page";
import TasksPage from "@/app/(app)/tasks/page";
import { payrollError } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { parseDuration } from "../Overtime";
import { me, overtime, plain, signIn, task } from "./fixtures";

let mockSearch = new URLSearchParams();
let mockParams: Record<string, string> = {};
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/tasks",
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

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockParams = {};
});

/* ------------------------------------------------------------------ overtime */

describe("parseDuration", () => {
  it("reads hours, decimals and clock times", () => {
    expect(parseDuration("2")).toBe(120);
    expect(parseDuration("1.5")).toBe(90);
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("abc")).toBeNull();
  });
});

describe("Overtime", () => {
  const EMPLOYEE = me({ [P.OVERTIME_REQUEST]: ["SELF"] }, 42);
  const MANAGER = me({ [P.OVERTIME_REQUEST]: ["SELF"], [P.OVERTIME_APPROVE]: ["REPORTING_TREE"] }, 42);

  it("is denied without overtime permissions", () => {
    signIn(me({ [P.PAYROLL_INPUTS_READ]: ["COMPANY"] }));
    render(<OvertimePage />);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("gives employees their own list and no approval tab, with hours (no amounts)", async () => {
    signIn(EMPLOYEE);
    mockGet.mockResolvedValue({ total: 1, items: [overtime({ employee_id: 42 })] });
    render(<OvertimePage />);
    expect(screen.getByRole("tab", { name: "My overtime" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Waiting for my approval" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide amounts" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("2.5 h").length).toBeGreaterThan(0));
    expect(mockGet).toHaveBeenCalledWith("/overtime/entries", { params: { mine: true, skip: 0, limit: 50 } });
  });

  it("validates the request form inline", async () => {
    signIn(EMPLOYEE);
    mockSearch = new URLSearchParams("modal=overtime-request");
    mockGet.mockResolvedValue({ total: 0, items: [] });
    render(<OvertimePage />);
    const dialog = await screen.findByRole("dialog", { name: "Request overtime" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    expect(await within(dialog).findAllByText("Choose the date you worked overtime.")).not.toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/^Date/), { target: { value: "2026-10-18" } });
    fireEvent.change(within(dialog).getByLabelText(/^Hours/), { target: { value: "1:30" } });
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: "Release night" } });
    mockPost.mockResolvedValue({ id: 1, status: "PENDING_APPROVAL" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/overtime/entries", { date: "2026-10-18", minutes: 90, reason: "Release night", comp_off: false }));
  });

  it("lets managers approve part of a request", async () => {
    signIn(MANAGER);
    mockSearch = new URLSearchParams("tab=approvals");
    mockGet.mockResolvedValue({ total: 1, items: [overtime()] });
    mockPost.mockResolvedValue({ id: 41, status: "APPROVED" });
    render(<OvertimePage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Approve" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Approve" });
    fireEvent.change(within(dialog).getByLabelText("Hours to approve"), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/overtime/entries/41/approve", { minutes_approved: 120, comp_off: undefined, remarks: undefined, expected_step: 1 }));
  });
});

/* ------------------------------------------------------------------ tasks */

describe("Tasks", () => {
  const MANAGER = me({ [P.TASK_MANAGE]: ["REPORTING_TREE"], [P.TASK_APPROVE]: ["REPORTING_TREE"], [P.EMPLOYEE_READ]: ["REPORTING_TREE"] }, 42);
  const ADMIN = me({ [P.TASK_MANAGE]: ["COMPANY"], [P.PAYROLL_CONFIGURATION_READ]: ["COMPANY"] }, 42);

  it("reads tasks.enabled from the settings API and shows the off state", async () => {
    signIn(ADMIN);
    mockGet.mockImplementation((url: string) =>
      url === "/payroll/settings/resolve" ? Promise.resolve({ key: "tasks.enabled", value: false, level: "TENANT", valid: true }) : Promise.resolve({ total: 0, items: [] }),
    );
    render(<TasksPage />);
    expect(await screen.findByText("The tasks module is turned off")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/payroll/settings/resolve", { params: { key: "tasks.enabled" } });
  });

  it("falls back to the tasks API's TASKS_DISABLED answer when settings are not readable", async () => {
    signIn(MANAGER);
    mockGet.mockImplementation((url: string) =>
      url === "/tasks" ? Promise.reject(payrollError(403, { detail: "The tasks module is turned off for this company.", code: "TASKS_DISABLED" })) : Promise.resolve({ total: 0, items: [] }),
    );
    render(<TasksPage />);
    expect(await screen.findByText("The tasks module is turned off")).toBeInTheDocument();
  });

  it("shows the board without rates for managers (no pay amounts, contract §25)", async () => {
    signIn(MANAGER);
    mockGet.mockImplementation((url: string) => (url === "/tasks" ? Promise.resolve({ total: 1, items: [task()] }) : Promise.resolve({ total: 0, items: [] })));
    render(<TasksPage />);
    expect(await screen.findByText("Install 40 meters")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Waiting for approval" })).toHaveTextContent("Install 40 meters");
    expect(plain(document.body.textContent)).not.toMatch(/25\.50/);
  });

  it("checks that splits add up to exactly 100%", async () => {
    signIn(MANAGER);
    mockSearch = new URLSearchParams("modal=new-task");
    mockGet.mockImplementation((url: string) =>
      url === "/employees" ? Promise.resolve({ total: 2, items: [{ id: 142, employee_code: "E1", full_name: "Asha Rao" }, { id: 143, employee_code: "E2", full_name: "Vik Singh" }] }) : Promise.resolve({ total: 0, items: [] }),
    );
    render(<TasksPage />);
    const dialog = await screen.findByRole("dialog", { name: "New task" });
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: "Install" } });
    fireEvent.change(within(dialog).getByLabelText(/^Task type/), { target: { value: "INSTALL" } });
    fireEvent.change(within(dialog).getByLabelText(/^Quantity/), { target: { value: "40" } });
    fireEvent.change(within(dialog).getByLabelText(/^Unit/), { target: { value: "pieces" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Add assignee/ }));
    await waitFor(() => expect(within(dialog).getAllByRole("option", { name: /Vik Singh/ }).length).toBe(2));
    const selects = within(dialog).getAllByLabelText(/^Assignee \d/);
    fireEvent.change(selects[0], { target: { value: "142" } });
    fireEvent.change(selects[1], { target: { value: "143" } });
    const splits = within(dialog).getAllByLabelText("Split %");
    fireEvent.change(splits[0], { target: { value: "60" } });
    fireEvent.change(splits[1], { target: { value: "30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create task" }));
    expect(await within(dialog).findAllByText(/must add up to exactly 100%/)).not.toHaveLength(0);
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(splits[1], { target: { value: "40" } });
    mockPost.mockResolvedValue({ id: 60, status: "DRAFT", row_version: 1 });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost.mock.calls[0][1]).toMatchObject({
      quantity: "40",
      assignees: [
        { employee_id: 142, split_percent: "60" },
        { employee_id: 143, split_percent: "40" },
      ],
    });
  });

  it("approves a partial quantity on the task page", async () => {
    signIn(MANAGER);
    mockParams = { id: "51" };
    mockGet.mockImplementation((url: string) => (url === "/tasks/51" ? Promise.resolve(task()) : Promise.resolve({ total: 0, items: [] })));
    mockPost.mockResolvedValue({ id: 51, status: "APPROVED" });
    render(<TaskPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog", { name: "Approve" });
    fireEvent.change(within(dialog).getByLabelText(/Accepted quantity/), { target: { value: "30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/tasks/51/approve", { accepted_quantity: "30", remarks: undefined, expected_step: 1 }));
  });

  it("does not let an assignee approve their own task", async () => {
    signIn(me({ [P.TASK_APPROVE]: ["COMPANY"] }, 142));
    mockParams = { id: "51" };
    mockGet.mockImplementation((url: string) => (url === "/tasks/51" ? Promise.resolve(task()) : Promise.resolve({ total: 0, items: [] })));
    render(<TaskPage />);
    await screen.findByText("Assignees");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});
