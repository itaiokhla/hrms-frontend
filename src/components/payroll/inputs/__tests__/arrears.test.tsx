import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import WageInputsPage from "@/app/(app)/payroll/inputs/page";
import { payrollError } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { arrearsProposal, me, plain, signIn } from "./fixtures";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSearch = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  usePathname: () => "/payroll/inputs",
  useSearchParams: () => mockSearch,
  useParams: () => ({}),
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("@/lib/payroll/api", () => {
  const actual = jest.requireActual("@/lib/payroll/api");
  return {
    ...actual,
    payrollApi: {
      get: (...a: unknown[]) => mockGet(...a),
      post: (...a: unknown[]) => mockPost(...a),
      patch: jest.fn(),
      delete: jest.fn(),
    },
  };
});

const READ_ONLY = me({ [P.PAYROLL_INPUTS_READ]: ["COMPANY"], [P.PAYROLL_RUN_READ]: ["LEGAL_ENTITY"] });
const APPROVER = me({ [P.EMPLOYEE_READ]: ["COMPANY"], [P.PAYROLL_INPUTS_READ]: ["COMPANY"], [P.PAYROLL_RUN_READ]: ["COMPANY"], [P.PAYROLL_RUN_APPROVE]: ["COMPANY"] });
const PROCESSOR = me(
  { [P.EMPLOYEE_READ]: ["COMPANY"], [P.PAYROLL_INPUTS_READ]: ["COMPANY"], [P.PAYROLL_RUN_READ]: ["COMPANY"], [P.PAYROLL_RUN_CREATE]: ["COMPANY"], [P.PAYROLL_CONFIGURATION_READ]: ["COMPANY"] },
  42,
);

const EMPLOYEES = {
  total: 2,
  items: [
    { id: 142, employee_code: "E0142", full_name: "Asha Rao" },
    { id: 42, employee_code: "E0042", full_name: "Pat Manager" },
  ],
};

function routes(overrides: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    "/payroll/arrears-proposals": { total: 1, items: [arrearsProposal({}, false)] },
    "/payroll/arrears-proposals/5": arrearsProposal(),
    "/employees": EMPLOYEES,
    "/payroll/org/pay-groups": [{ id: 3, name: "Monthly India", status: "ACTIVE", legal_entity_id: 1 }],
    "/payroll/wage-inputs": { total: 0, items: [] },
    ...overrides,
  };
  mockGet.mockImplementation((url: string) => {
    const value = table[url];
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve(value ?? { total: 0, items: [] });
  });
}

const listCalls = () => mockGet.mock.calls.filter((c) => c[0] === "/payroll/arrears-proposals");

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams("tab=arrears");
  window.localStorage.clear();
});

describe("Arrears proposals tab", () => {
  it("lists proposals with exact string amounts, statuses and the original period", async () => {
    signIn(APPROVER);
    routes();
    render(<WageInputsPage />);
    expect((await screen.findAllByText("Asha Rao")).length).toBeGreaterThan(0);
    expect(listCalls()[0]).toEqual(["/payroll/arrears-proposals", { params: { skip: 0, limit: 50 } }]);
    const text = plain(document.body.textContent);
    expect(text).toMatch(/3,300\.50/);
    expect(text).toMatch(/1 Aug – 31 Aug 2026/);
    expect(screen.getAllByText("Awaiting approval").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Salary change").length).toBeGreaterThan(0);
  });

  it("keeps the runs area's deep link and narrows to one run with &run=", async () => {
    signIn(READ_ONLY);
    routes();
    mockSearch = new URLSearchParams("tab=arrears&run=12");
    render(<WageInputsPage />);
    await waitFor(() => expect(listCalls()[0]).toEqual(["/payroll/arrears-proposals", { params: { run_id: "12", skip: 0, limit: 50 } }]));
    expect(screen.getByText("From run #12")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show proposals from every run" }));
    expect(mockReplace).toHaveBeenCalledWith("/payroll/inputs?tab=arrears", { scroll: false });
  });

  it("filters by status and employee on the server and by period over the latest page the API allows", async () => {
    signIn(APPROVER);
    routes();
    render(<WageInputsPage />);
    await screen.findAllByText("Asha Rao");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "APPROVED" } });
    await waitFor(() => expect(listCalls().at(-1)).toEqual(["/payroll/arrears-proposals", { params: { status: "APPROVED", skip: 0, limit: 50 } }]));
    await waitFor(() => expect(within(screen.getByLabelText("Employee")).getAllByRole("option").length).toBe(3));
    fireEvent.change(screen.getByLabelText("Employee"), { target: { value: "142" } });
    await waitFor(() => expect(listCalls().at(-1)).toEqual(["/payroll/arrears-proposals", { params: { status: "APPROVED", employee_id: "142", skip: 0, limit: 50 } }]));
    await screen.findAllByText("Asha Rao");
    // The API has no period filter: a date searches the API's largest page (skip 0) and pages locally.
    fireEvent.change(screen.getByLabelText("Period including"), { target: { value: "2026-09-15" } });
    await waitFor(() => expect(listCalls().at(-1)).toEqual(["/payroll/arrears-proposals", { params: { status: "APPROVED", employee_id: "142", skip: 0, limit: 200 } }]));
    expect(await screen.findByText("No arrears proposals match these filters")).toBeInTheDocument();
    const calls = listCalls().length;
    fireEvent.change(screen.getByLabelText("Period including"), { target: { value: "2026-08-15" } });
    expect((await screen.findAllByText("Asha Rao")).length).toBeGreaterThan(0);
    // Changing the date re-filters what was fetched, without another request.
    expect(listCalls()).toHaveLength(calls);
    expect(screen.queryByText(/Only the most recent proposals were searched/)).not.toBeInTheDocument();
  });

  it("says when the period filter could not search older proposals", async () => {
    signIn(APPROVER);
    routes({ "/payroll/arrears-proposals": { total: 450, items: [arrearsProposal({}, false)] } });
    render(<WageInputsPage />);
    await screen.findAllByText("Asha Rao");
    expect(screen.queryByText(/Only the most recent proposals were searched/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Period including"), { target: { value: "2026-08-15" } });
    expect(await screen.findByText("Only the most recent proposals were searched for this period")).toBeInTheDocument();
    expect(plain(document.body.textContent)).toMatch(/latest 200 proposals/);
  });

  it("never offers an approver decisions on their own arrears", async () => {
    signIn(me({ [P.EMPLOYEE_READ]: ["COMPANY"], [P.PAYROLL_INPUTS_READ]: ["COMPANY"], [P.PAYROLL_RUN_READ]: ["COMPANY"], [P.PAYROLL_RUN_APPROVE]: ["COMPANY"] }, 142));
    routes();
    render(<WageInputsPage />);
    await screen.findAllByText("Asha Rao");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "View" }).length).toBeGreaterThan(0);
  });

  it("warns on a deep-linked decision about the approver's own arrears", async () => {
    signIn(me({ [P.EMPLOYEE_READ]: ["COMPANY"], [P.PAYROLL_INPUTS_READ]: ["COMPANY"], [P.PAYROLL_RUN_READ]: ["COMPANY"], [P.PAYROLL_RUN_APPROVE]: ["COMPANY"] }, 142));
    routes();
    mockSearch = new URLSearchParams("tab=arrears&modal=arrears-approve&id=5");
    render(<WageInputsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Approve" });
    expect(within(dialog).getByText("This is your own pay")).toBeInTheDocument();
  });

  it("without pay-run read beyond SELF says so and never calls the API", async () => {
    signIn(me({ [P.PAYROLL_INPUTS_READ]: ["COMPANY"], [P.PAYROLL_RUN_READ]: ["SELF"] }));
    routes();
    render(<WageInputsPage />);
    expect(await screen.findByText("Arrears proposals aren't visible to your role")).toBeInTheDocument();
    expect(listCalls()).toHaveLength(0);
  });

  it("offers decisions only to approvers and proposals only to processors", async () => {
    signIn(READ_ONLY);
    routes();
    const { unmount } = render(<WageInputsPage />);
    await screen.findAllByText(/Employee #142|Asha Rao/);
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Check a past change/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create retro run/ })).not.toBeInTheDocument();
    unmount();

    signIn(APPROVER);
    const second = render(<WageInputsPage />);
    expect((await screen.findAllByRole("button", { name: "Approve" })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Reject" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Check a past change/ })).not.toBeInTheDocument();
    second.unmount();

    signIn(PROCESSOR);
    render(<WageInputsPage />);
    expect(await screen.findByRole("button", { name: /Check a past change/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create retro run/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("deep-links the proposal detail with the per-component difference", async () => {
    signIn(APPROVER);
    routes();
    mockSearch = new URLSearchParams("tab=arrears&modal=arrears&id=5");
    render(<WageInputsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Arrears for Asha Rao" });
    await within(dialog).findByText("BASIC");
    const row = within(dialog).getByText("PF_EE").closest("tr")!;
    expect(row).toHaveAttribute("data-direction", "RECOVERY");
    expect(plain(row.textContent)).toMatch(/-?1,200\.00/);
    const basic = within(dialog).getByText("BASIC").closest("tr")!;
    expect(plain(basic.textContent)).toMatch(/30,000\.00.*34,500\.50.*4,500\.50/);
    expect(within(dialog).getByText("Basic went up from 1 Aug 2026.")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /Run #12/ })).toHaveAttribute("href", "/payroll/runs/12");
    expect(within(dialog).getByRole("button", { name: "Approve…" })).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("/payroll/arrears-proposals/5");
  });

  it("shows an out-of-scope proposal as not found", async () => {
    signIn(APPROVER);
    routes({ "/payroll/arrears-proposals/77": payrollError(404, { detail: "Arrears proposal not found" }) });
    mockSearch = new URLSearchParams("tab=arrears&modal=arrears&id=77");
    render(<WageInputsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Arrears proposal" });
    expect(await within(dialog).findByText(/was not found, or it is outside the people and entities you can see/)).toBeInTheDocument();
  });

  it("requires a reason to reject and sends it with the row version", async () => {
    signIn(APPROVER);
    routes();
    mockPost.mockResolvedValue({ id: 5, status: "REJECTED", payment_mode: null, recovery_mode: null, row_version: 4 });
    mockSearch = new URLSearchParams("tab=arrears&modal=arrears-reject&id=5");
    render(<WageInputsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Reject" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(await within(dialog).findByText(/Give a reason for the rejection/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Increment was reversed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/arrears-proposals/5/reject", { reason: "Increment was reversed", row_version: 3 }));
  });

  it("makes the approver acknowledge recalculation issues, then approves with the row version", async () => {
    signIn(APPROVER);
    routes({ "/payroll/arrears-proposals/5": arrearsProposal({ issues: [{ code: "MIN_WAGE", severity: "WARNING", message: "Below the minimum wage after recovery" }] }) });
    mockPost.mockResolvedValue({ id: 5, status: "APPROVED", payment_mode: "NEXT_REGULAR_RUN", recovery_mode: "NEXT_RUN", row_version: 4 });
    mockSearch = new URLSearchParams("tab=arrears&modal=arrears-approve&id=5");
    render(<WageInputsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Approve" });
    expect(within(dialog).getByText("Below the minimum wage after recovery")).toBeInTheDocument();
    expect(plain(dialog.textContent)).toMatch(/4,500\.50/);
    const approve = within(dialog).getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText("I have checked these"));
    fireEvent.click(approve);
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/arrears-proposals/5/approve", { comment: null, row_version: 3 }));
  });

  it("words a finalized run and a stale version on decisions", async () => {
    signIn(APPROVER);
    routes();
    mockPost.mockRejectedValueOnce(payrollError(409, { detail: "The run is finalized.", code: "RUN_FINALIZED" }));
    mockPost.mockRejectedValueOnce(payrollError(409, { detail: "This proposal was changed by someone else. Reload and try again.", code: "ROW_VERSION_CONFLICT" }));
    mockSearch = new URLSearchParams("tab=arrears&modal=arrears-approve&id=5");
    render(<WageInputsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Approve" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    expect(await within(dialog).findByText("Pay run already finalized")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    expect(await within(dialog).findByText("Someone else changed this")).toBeInTheDocument();
    expect(within(dialog).getByText("This proposal was changed by someone else. Reload and try again.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Reload/ })).toBeInTheDocument();
  });
});

describe("Check a past change (detect with preview)", () => {
  const preview = {
    items: [
      {
        run_id: 12,
        run_employee_id: 340,
        period: { period_id: 9, start: "2026-08-01", end: "2026-08-31", run_id: 12, run_number: "PR-2026-08", run_employee_id: 340 },
        issues: [],
        lines: [{ component_code: "BASIC", direction: "ARREARS", delta: { amount: "4500.50", currency: "INR" }, original: { amount: "30000.00", currency: "INR" }, recalculated: { amount: "34500.50", currency: "INR" } }],
      },
    ],
  };

  async function fill(dialog: HTMLElement, employee = "142") {
    await waitFor(() => expect(within(dialog).getAllByRole("option", { name: /Asha Rao/ }).length).toBe(1));
    fireEvent.change(within(dialog).getByLabelText(/^Employee/), { target: { value: employee } });
    fireEvent.change(within(dialog).getByLabelText(/Effective from/), { target: { value: "2026-08-01" } });
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: "Back-dated increment" } });
  }

  it("validates, previews the per-component difference, then sends proposals with a stable idempotency key", async () => {
    signIn(PROCESSOR);
    routes();
    mockSearch = new URLSearchParams("tab=arrears&modal=arrears-detect");
    mockPost.mockImplementation((_url: string, body: { preview?: boolean }) =>
      Promise.resolve(body.preview ? preview : { items: [{ run_id: 12, run_employee_id: 340, proposal_id: 6, status: "PENDING_APPROVAL", superseded_id: null, cancelled_id: null, issues: [] }] }),
    );
    render(<WageInputsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Check a past change" });
    const send = within(dialog).getByRole("button", { name: "Send for approval" });
    expect(send).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview differences" }));
    expect(await within(dialog).findAllByText("Choose the employee.")).not.toHaveLength(0);
    expect(mockPost).not.toHaveBeenCalled();

    await fill(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview differences" }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/payroll/arrears-proposals/detect", {
        employee_id: 142, from_date: "2026-08-01", trigger: "COMPENSATION", reason: "Back-dated increment", preview: true,
      }),
    );
    expect(await within(dialog).findByText("1 of 1 finalized period change")).toBeInTheDocument();
    expect(plain(within(dialog).getByText("BASIC").closest("tr")!.textContent)).toMatch(/30,000\.00.*34,500\.50.*4,500\.50/);

    fireEvent.click(send);
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
    const [url, body, options] = mockPost.mock.calls[1];
    expect(url).toBe("/payroll/arrears-proposals/detect");
    expect(body).toEqual({ employee_id: 142, from_date: "2026-08-01", trigger: "COMPENSATION", reason: "Back-dated increment", preview: false });
    expect(typeof options.idempotencyKey).toBe("string");
  });

  it("asks for setting keys when a payroll setting changed", async () => {
    signIn(PROCESSOR);
    routes();
    mockSearch = new URLSearchParams("tab=arrears&modal=arrears-detect");
    mockPost.mockResolvedValue(preview);
    render(<WageInputsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Check a past change" });
    await fill(dialog);
    fireEvent.change(within(dialog).getByLabelText(/What changed/), { target: { value: "SETTING" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview differences" }));
    expect(await within(dialog).findAllByText("Enter the setting keys that changed.")).not.toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Setting keys/), { target: { value: "payroll.overtime.rate, payroll.lop.basis" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview differences" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/arrears-proposals/detect", expect.objectContaining({ trigger: "SETTING", keys: ["payroll.overtime.rate", "payroll.lop.basis"], preview: true })));
  });

  it("never lets a processor propose arrears for their own pay", async () => {
    signIn(PROCESSOR);
    routes();
    mockSearch = new URLSearchParams("tab=arrears&modal=arrears-detect");
    mockPost.mockResolvedValue(preview);
    render(<WageInputsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Check a past change" });
    await fill(dialog, "42");
    expect(within(dialog).getByText("This is your own pay")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview differences" }));
    await within(dialog).findByText("1 of 1 finalized period change");
    expect(within(dialog).getByRole("button", { name: "Send for approval" })).toBeDisabled();
  });
});

describe("Create retro run", () => {
  it("pays the selected approved proposals in the chosen period and opens the new run", async () => {
    signIn(PROCESSOR);
    routes({
      "/payroll/arrears-proposals": {
        total: 2,
        items: [
          arrearsProposal({ id: 5, status: "APPROVED", payment_mode: "OFF_CYCLE" }, false),
          arrearsProposal({ id: 8, status: "APPROVED", payment_mode: "NEXT_REGULAR_RUN", employee_id: 143 }, false),
        ],
      },
      "/payroll/pay-groups/3/periods": { total: 1, items: [{ id: 21, pay_group_id: 3, start: "2026-11-01", end: "2026-11-30", pay_date: "2026-11-30", status: "OPEN" }] },
    });
    mockPost.mockResolvedValue({ id: 99, number: "PR-2026-11-R1", run_type: "RETRO_ADJUSTMENT", status: "DRAFT", row_version: 1 });
    mockSearch = new URLSearchParams("tab=arrears&modal=retro-run");
    render(<WageInputsPage />);
    const dialog = await screen.findByRole("dialog", { name: "Create retro run" });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/payroll/arrears-proposals", { params: { status: "APPROVED", limit: 200 } }));
    await waitFor(() => expect(within(dialog).getAllByRole("checkbox")).toHaveLength(2));
    const [offCycle, nextRun] = within(dialog).getAllByRole("checkbox");
    expect(offCycle).toBeChecked();
    expect(nextRun).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create retro run" }));
    expect(await within(dialog).findAllByText("Choose the period the retro run pays in.")).not.toHaveLength(0);
    expect(mockPost).not.toHaveBeenCalled();
    await waitFor(() => expect(within(dialog).getAllByRole("option", { name: /1 Nov – 30 Nov 2026/ })).toHaveLength(1));
    fireEvent.change(within(dialog).getByLabelText(/Pay in period/), { target: { value: "21" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create retro run" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const [url, body, options] = mockPost.mock.calls[0];
    expect(url).toBe("/payroll/retro-runs");
    expect(body).toEqual({ pay_group_id: 3, pay_period_id: 21, proposal_ids: [5] });
    expect(typeof options.idempotencyKey).toBe("string");
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/payroll/runs/99"));
  });
});
