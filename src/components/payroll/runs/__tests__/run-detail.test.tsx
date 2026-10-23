import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import PayRunPage from "@/app/(app)/payroll/runs/[id]/page";
import { ConfirmProvider } from "@/components/ui/overlay";
import type { Me } from "@/lib/types";

import type { Run, RunSummary } from "../types";
import { APPROVER, PAYROLL_ADMIN, VIEWER, conflict, forbidden, plain, run, signIn, summary } from "./fixtures";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockSearch = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
  usePathname: () => "/payroll/runs/41",
  useSearchParams: () => mockSearch,
  useParams: () => ({ id: "41" }),
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock("@/components/payroll/JobProgress", () => ({ JobProgress: ({ title }: { title: string }) => <div role="status">{title}</div> }));

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockStepStatus = jest.fn();
jest.mock("@/lib/payroll/api", () => {
  const actual = jest.requireActual("@/lib/payroll/api");
  return {
    ...actual,
    payrollApi: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
    stepUpApi: { status: () => mockStepStatus(), emailCode: jest.fn(), verify: jest.fn() },
  };
});

interface Routes {
  current?: Run | Error;
  summary?: RunSummary;
  extra?: Record<string, unknown>;
}

function routes({ current = run(), summary: sum = summary(), extra = {} }: Routes = {}) {
  mockGet.mockImplementation((url: string) => {
    if (url in extra) {
      const value = extra[url];
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    if (url === "/payroll/runs/41") return current instanceof Error ? Promise.reject(current) : Promise.resolve(current);
    if (url === "/payroll/runs/41/summary") return Promise.resolve(sum);
    if (url === "/payroll/statutory-attestations") return Promise.resolve({ total: 0, items: [] });
    if (url === "/payroll/runs/41/employees") return Promise.resolve({ run_id: 41, total: 0, counts: {}, items: [] });
    if (url === "/payroll/runs/41/exceptions") return Promise.resolve({ total: 0, items: [] });
    if (url === "/payroll/runs/41/approvals") return Promise.resolve({ run_id: 41, status: "REVIEW_REQUIRED", row_version: 6, approval_request: null, separation_of_duties: true, decisions: [], self_lines_pending: [] });
    if (url === "/payroll/reversals") return Promise.resolve({ total: 0, items: [] });
    return Promise.resolve([]);
  });
}

const wrap = (node: ReactNode) => render(<ConfirmProvider>{node}</ConfirmProvider>);

function show(user: Me, search = "") {
  signIn(user);
  mockSearch = new URLSearchParams(search);
  return wrap(<PayRunPage />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockStepStatus.mockResolvedValue({ active: true, method: "TOTP", verified_at: null, expires_at: null, available_methods: ["TOTP"] });
  window.localStorage.clear();
});

describe("Run detail", () => {
  it("shows a forbidden run as not found", async () => {
    routes({ current: forbidden() });
    show(PAYROLL_ADMIN);
    expect(await screen.findByText("Pay run not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Pay Runs" })).toHaveAttribute("href", "/payroll/runs");
  });

  it("shows an error with Retry when the run can't load", async () => {
    routes({ current: new Error("boom") });
    show(PAYROLL_ADMIN);
    const retry = await screen.findByRole("button", { name: "Try again" });
    routes();
    fireEvent.click(retry);
    expect((await screen.findAllByText("Nov 2026 · Monthly IN")).length).toBeGreaterThan(0);
  });

  it("renders the header, calculated-by line and only the actions valid for the state and the user", async () => {
    routes();
    show(PAYROLL_ADMIN);
    expect((await screen.findAllByText("Nov 2026 · Monthly IN")).length).toBeGreaterThan(0);
    expect(screen.getByText("PR-2026-0041")).toBeInTheDocument();
    expect(screen.getByText(/Calculated .* by you/)).toBeInTheDocument();
    const bar = screen.getByRole("toolbar", { name: "Run actions" });
    expect(within(bar).getByRole("button", { name: "Submit for approval" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: /Recalculate/ })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: /Hold employee/ })).toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: "Finalize" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide amounts" })).toBeInTheDocument();
  });

  it("gives a reader no actions", async () => {
    routes({ current: run({ available_actions: [] }) });
    show(VIEWER);
    expect(await screen.findByText("No action for you at this stage.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hold employee/ })).not.toBeInTheDocument();
  });

  it("summarises totals per currency with pack badges and the attestation step", async () => {
    routes();
    show(PAYROLL_ADMIN);
    expect(await screen.findByText("Totals")).toBeInTheDocument();
    const text = plain(document.body.textContent);
    expect(text).toMatch(/5,48,250\.75|548,250\.75/);
    expect(text).toMatch(/8,000\.00/);
    expect(screen.getByText(/amounts in different currencies are never added together/)).toBeInTheDocument();
    expect(screen.getAllByText("FIXTURE — not law").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Compliance not verified").length).toBeGreaterThan(0);
    expect(screen.getByText(/Eligible/)).toHaveTextContent("Eligible 12 = included 10 + excluded 2");
    expect(await screen.findByRole("button", { name: "Create attestation" })).toBeInTheDocument();
  });

  it("asks before recalculating and shows a 409 conflict banner with Reload", async () => {
    routes();
    mockPost.mockRejectedValue(conflict());
    show(PAYROLL_ADMIN);
    const bar = await screen.findByRole("toolbar", { name: "Run actions" });
    fireEvent.click(within(bar).getByRole("button", { name: /Recalculate/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Recalculate all" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/runs/41/calculate", { employee_ids: undefined, row_version: 6 }, { idempotencyKey: expect.any(String) }));
    expect(await screen.findByText("Someone else changed this")).toBeInTheDocument();
    expect(screen.getByText("Reload").closest("button")).toBeInTheDocument();
  });

  it("shows the stale banner and recalculates the changed employees", async () => {
    routes({
      current: run({ stale: true }),
      extra: {
        "/payroll/runs/41/stale": {
          run_id: 41,
          stale: true,
          reasons: [],
          all_employees: false,
          employees: [142, 143, 144].map((id) => ({ run_employee_id: id + 400, employee_id: id, employee_code: null, employee_name: `Person ${id}`, changes: [] })),
          actions: [
            { action: "RECALCULATE_SELECTED", available: true, employee_ids: [142, 143, 144] },
            { action: "HANDLE_AS_RETRO", available: false, reason: "Once the run is finalized, later changes become retro proposals automatically." },
          ],
        },
      },
    });
    mockPost.mockResolvedValue({ run: { id: 41, number: "PR-2026-0041", status: "CALCULATING", row_version: 7 }, job: { id: 9, status: "QUEUED" }, employees: 3, action: "RECALCULATE" });
    show(PAYROLL_ADMIN);
    expect(await screen.findByText("Inputs changed for 3 employees since lock")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Handle as retro" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "See arrears proposals" })).toHaveAttribute("href", "/payroll/inputs?tab=arrears");
    // Submission waits for the recalculation
    expect(screen.getByRole("button", { name: "Submit for approval" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Recalculate them" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/runs/41/calculate", { employee_ids: [142, 143, 144], row_version: 6 }, { idempotencyKey: expect.any(String) }));
  });

  it("shows the calculation job while calculating", async () => {
    routes({ current: run({ status: "CALCULATING", calculation_job_id: 9, available_actions: [] }) });
    show(PAYROLL_ADMIN);
    expect(await screen.findByText("Calculating 10 employees")).toBeInTheDocument();
  });

  it("explains what blocks finalization, including the statutory gate", async () => {
    routes({
      current: run({ status: "APPROVED", stage: 5, available_actions: ["FINALIZE", "REOPEN", "CANCEL"] }),
      extra: {
        "/payroll/runs/41/finalization": {
          run_id: 41,
          status: "APPROVED",
          label: "Nov 2026 · Monthly IN",
          row_version: 6,
          can_finalize: false,
          blockers: [{ code: "STATUTORY_NOT_VERIFIED", message: "No verified pack." }],
          self_lines_pending: [],
          statutory: { country: "IN", verified: false, packs: [] },
          finalized_at: null,
          finalized_by_user_id: null,
        },
      },
    });
    show(PAYROLL_ADMIN, "modal=finalize&run=41");
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/no approved statutory attestation/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Finalize" })).not.toBeInTheDocument();
  });

  it("finalizes only after the typed label and a step-up check, with an idempotency key", async () => {
    routes({
      current: run({ status: "APPROVED", stage: 5, available_actions: ["FINALIZE", "REOPEN", "CANCEL"] }),
      extra: {
        "/payroll/runs/41/finalization": {
          run_id: 41,
          status: "APPROVED",
          label: "Nov 2026 · Monthly IN",
          row_version: 6,
          can_finalize: true,
          blockers: [],
          self_lines_pending: [],
          statutory: { country: "IN", verified: true, packs: [] },
          finalized_at: null,
          finalized_by_user_id: null,
        },
      },
    });
    mockPost.mockResolvedValue({ id: 41, number: "PR-2026-0041", status: "FINALIZED", row_version: 7, finalized_at: "2026-11-28T10:00:00" });
    show(PAYROLL_ADMIN, "modal=finalize&run=41");
    // The checklist loads first; the typed confirmation replaces it once nothing blocks.
    const input = await screen.findByLabelText(/Type “Nov 2026 · Monthly IN” to confirm/);
    const dialog = input.closest("[role=dialog]") as HTMLElement;
    const finalize = within(dialog).getByRole("button", { name: "Finalize" });
    expect(finalize).toBeDisabled();
    expect(within(dialog).getByText(/Payslips will be generated/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Type “Nov 2026 · Monthly IN” to confirm/), { target: { value: "Nov 2026 · Monthly IN" } });
    expect(finalize).not.toBeDisabled();
    fireEvent.click(finalize);
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith("/payroll/runs/41/finalize", { confirm_label: "Nov 2026 · Monthly IN", row_version: 6 }, { idempotencyKey: expect.any(String) }),
    );
    expect(mockStepStatus).toHaveBeenCalled();
  });

  it("lets only the current approver approve or reject, and a rejection needs a reason", async () => {
    const pending = run({ status: "APPROVAL_PENDING", stage: 5, approval_request_id: 70, available_actions: ["APPROVE_STEP", "APPROVE_FINAL", "REJECT"] });
    const request = (canAct: boolean) => ({
      id: 70,
      status: "pending",
      current_step: 1,
      pending_reason: null,
      requested_by: "Pat Manager",
      can_act: canAct,
      acting_as: null,
      steps: [{ step_order: 1, approver_label: "Finance head", approver: "Ravi K", status: "pending", acted_by: null, acted_at: null, remarks: null }],
    });
    routes({ current: pending, extra: { "/payroll/approvals/70": request(false) } });
    const { unmount } = show(APPROVER);
    await screen.findAllByText("Nov 2026 · Monthly IN");
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/payroll/approvals/70"));
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    unmount();

    routes({ current: pending, extra: { "/payroll/approvals/70": request(true) } });
    mockPost.mockResolvedValue({ id: 41, number: "PR-2026-0041", status: "REJECTED", row_version: 7 });
    show(APPROVER, "modal=approve&run=41&decision=reject");
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(await within(dialog).findByText("A rejection needs a reason.")).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Bonus for E0142 is wrong" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/runs/41/reject", { row_version: 6, reason: "Bonus for E0142 is wrong", expected_step: 1 }));
  });

  it("requests a reversal of a finalized run with a reason (two approvers, recovery not bank debit)", async () => {
    routes({ current: run({ status: "FINALIZED", stage: 6, available_actions: ["CLOSE", "REOPEN"] }) });
    mockPost.mockResolvedValue({ id: 3, status: "PENDING_APPROVAL", original_run_id: 41, reversal_run_id: null, row_version: 1 });
    show(PAYROLL_ADMIN, "modal=reverse&run=41");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/becomes a recovery in later runs/)).toBeInTheDocument();
    const request = await within(dialog).findByRole("button", { name: "Request reversal" });
    fireEvent.click(request);
    expect(await within(dialog).findByText("Give a reason.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Paid to the wrong pay group" } });
    fireEvent.click(request);
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/runs/41/reverse", { reason: "Paid to the wrong pay group", row_version: 6 }));
  });

  it("does not open the reversal for someone without the reversal rights", async () => {
    routes({ current: run({ status: "FINALIZED", stage: 6, available_actions: [] }) });
    show(VIEWER, "modal=reverse&run=41");
    await screen.findAllByText("Nov 2026 · Monthly IN");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lets a second approver approve a pending reversal", async () => {
    routes({
      current: run({ status: "FINALIZED", stage: 6, available_actions: [] }),
      extra: {
        "/payroll/reversals": {
          total: 1,
          items: [
            {
              id: 3,
              original_run_id: 41,
              reversal_run_id: null,
              status: "PENDING_APPROVAL",
              reason: "Wrong group",
              selected: false,
              preview: { INR: { gross: { amount: "612500.00", currency: "INR" }, net: { amount: "548250.75", currency: "INR" }, employees: 10 } },
              approvals: [{ step: 1, user_id: 8, at: "2026-11-29T10:00:00", comment: null }],
              requested_by_user_id: 7,
              created_at: "2026-11-29T09:00:00",
              row_version: 2,
            },
          ],
        },
      },
    });
    mockPost.mockResolvedValue({ id: 3, status: "APPROVED", original_run_id: 41, reversal_run_id: 77, row_version: 3 });
    show(APPROVER, "modal=reverse&run=41");
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/1 of 2 approvals/)).toBeInTheDocument();
    expect(plain(dialog.textContent)).toMatch(/5,48,250\.75|548,250\.75/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve reversal" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/reversals/3/approve", { comment: null, row_version: 2 }));
  });
});

describe("Run tabs", () => {
  it("waives an exception only with a reason", async () => {
    const exception = {
      id: 77,
      run_id: 41,
      run_employee_id: 501,
      employee_id: 142,
      code: "MISSING_BANK",
      severity: "WARNING",
      source: "PRECHECK",
      message: "No bank account on file.",
      details: {},
      resolutions: ["FIX", "WAIVE", "DEFER"],
      fix_link: "/payroll/bank-accounts?employee=142",
      waivable: true,
      blocks_finalization: false,
      status: "OPEN",
      resolved_by_user_id: null,
      resolved_at: null,
      resolution_note: null,
      deferred_to: null,
      deferred_to_period_id: null,
      row_version: 1,
    };
    routes({ extra: { "/payroll/runs/41/exceptions": { total: 1, items: [exception] } } });
    mockPost.mockResolvedValue({ id: 77, status: "WAIVED" });
    show(PAYROLL_ADMIN, "tab=exceptions&modal=exception&id=77&action=waive");
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("No bank account on file.")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /Go to where this is fixed/ })).toHaveAttribute("href", "/payroll/bank-details?employee=142");
    fireEvent.click(within(dialog).getByRole("button", { name: "Waive" }));
    expect(await within(dialog).findByText("Give a reason.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Paid by cheque this month" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Waive" }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/payroll/exceptions/77/waive", { reason: "Paid by cheque this month", row_version: 1 }));
  });

  it("lists employees with string amounts and opens the sheet on row click", async () => {
    routes({
      extra: {
        "/payroll/runs/41/employees": {
          run_id: 41,
          total: 1,
          counts: { flags: 1, errors: 0, holds: 0, joiners: 0, leavers: 0, variance: 1, calculated: 1, excluded: 0 },
          items: [
            {
              id: 501,
              employee_id: 142,
              employee_code: "E0142",
              employee_name: "Asha Rao",
              status: "CALCULATED",
              exclusion_reason: null,
              hold_type: null,
              currency: "INR",
              gross: { amount: "61250.00", currency: "INR" },
              deductions: { amount: "6125.50", currency: "INR" },
              reimbursements: null,
              net: { amount: "55124.50", currency: "INR" },
              employer_cost: null,
              previous_net: { amount: "54000.00", currency: "INR" },
              net_change_percent: "2.08",
              flags: [],
              error: null,
              exceptions: { open: 1, blocking: 0 },
              variance_pending: true,
              calculated: true,
              row_version: 3,
            },
          ],
        },
      },
    });
    show(PAYROLL_ADMIN, "tab=employees");
    expect((await screen.findAllByText("Asha Rao")).length).toBeGreaterThan(0);
    expect(plain(document.body.textContent)).toMatch(/55,124\.50/);
    expect(screen.getAllByText("⚑ variance").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText("Asha Rao")[0]);
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("modal=employee&employee=501"), { scroll: false });
  });

  it("shows payments only after finalization", async () => {
    routes();
    show(PAYROLL_ADMIN, "tab=payments");
    expect(await screen.findByText("Payments come after finalization")).toBeInTheDocument();
  });

  it("shows the approvals chain as not submitted yet", async () => {
    routes();
    show(PAYROLL_ADMIN, "tab=approvals");
    expect(await screen.findByText("Not submitted yet")).toBeInTheDocument();
  });
});
