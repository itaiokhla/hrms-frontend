/**
 * Leave setup (09-ui-ux/02 §21.1; 13 §7.3): the checklist, LEGACY_V1 vs V2_ACTIVE, and the typed confirmations of
 * go-live ("GO LIVE") and rollback ("ROLL BACK" + reason). The server also asks for a fresh step-up (withStepUp).
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GoLiveModal, RollbackModal, SetupPage, stepLink } from "@/components/leave-admin/SetupPage";
import { resetLeaveAccessCache, typedMatches } from "@/components/leave-admin/shared";
import { LeaveAdminError, leaveAdminApi } from "@/lib/leave/adminApi";
import type { LeaveAccess, LeaveSetup } from "@/lib/leave/adminTypes";

jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/settings/leave/setup",
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/lib/leave/adminApi", () => {
  const actual = jest.requireActual("@/lib/leave/adminApi");
  return {
    ...actual,
    leaveAdminApi: { ...actual.leaveAdminApi, goLive: jest.fn(), rollback: jest.fn(), setup: jest.fn(), access: jest.fn(), reconcile: jest.fn() },
  };
});

const api = leaveAdminApi as jest.Mocked<typeof leaveAdminApi>;

const ACCESS: LeaveAccess = {
  v2_enabled: false, local_today: "2026-10-30", employee_id: 1, permissions: { "leave:manage_policy": ["COMPANY"] },
  manage_company: true, half_day_enabled: true, discussion_enabled: true, return_enabled: true, on_behalf_enabled: true,
};
const SETUP: LeaveSetup = {
  v2_enabled: false,
  state: "LEGACY_V1",
  unassigned: [],
  steps: [
    { key: "types", title: "Review leave types", status: "DONE", detail: "5 type(s)", link: "/settings/leave/types" },
    { key: "plans", title: "Build leave plans", status: "DONE", detail: "1 plan(s)", link: "/settings/leave/plans" },
    { key: "approvals", title: "Set the approval route", status: "OPTIONAL", detail: "Without steps the company administrators approve.", link: "/leaves/policy" },
    { key: "go_live", title: "Go live with leave plans and the ledger", status: "READY", detail: "Reconcile balances, then go live.", link: "/settings/leave/setup" },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  resetLeaveAccessCache();
});

describe("typed confirmation", () => {
  it("matches the expected words, ignoring case and outer spaces only", () => {
    expect(typedMatches("go live", "GO LIVE")).toBe(true);
    expect(typedMatches("  GO LIVE ", "GO LIVE")).toBe(true);
    expect(typedMatches("GO-LIVE", "GO LIVE")).toBe(false);
    expect(typedMatches("GO LIV", "GO LIVE")).toBe(false);
  });
});

describe("go-live modal", () => {
  it("unlocks only after GO LIVE is typed, then sends the confirmation", async () => {
    api.goLive.mockResolvedValue({ status: "V2_ACTIVE", grants_posted: 42, report: {} as never });
    const onDone = jest.fn();
    render(<GoLiveModal open onOpenChange={jest.fn()} onDone={onDone} />);
    const submit = screen.getByTestId("go-live-submit");
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("go-live-confirm-input"), { target: { value: "GO LIV" } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("go-live-confirm-input"), { target: { value: "go live" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.goLive).toHaveBeenCalledWith("GO LIVE");
  });

  it("shows why the server refused (unexplained differences)", async () => {
    api.goLive.mockRejectedValue(new LeaveAdminError(409, "3 balance(s) differ; review the reconciliation first.", "RECONCILIATION_FAILED", []));
    render(<GoLiveModal open onOpenChange={jest.fn()} onDone={jest.fn()} report={{ employees: 10, types: 2, grants_to_post: 20, differences: [], unexplained: 3, negative_balances: 0, year: 2026, v2_enabled: false }} />);
    expect(screen.getByText("Unexplained differences block go-live")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("go-live-confirm-input"), { target: { value: "GO LIVE" } });
    fireEvent.click(screen.getByTestId("go-live-submit"));
    expect(await screen.findByText("3 balance(s) differ; review the reconciliation first.")).toBeInTheDocument();
    expect(screen.getByText(/Review the reconciliation first\./)).toBeInTheDocument();
  });
});

describe("rollback modal", () => {
  it("needs ROLL BACK and a reason", async () => {
    api.rollback.mockResolvedValue({ status: "LEGACY_V1", reversed_rows: 7 });
    const onDone = jest.fn();
    render(<RollbackModal open onOpenChange={jest.fn()} onDone={onDone} />);
    const submit = screen.getByTestId("rollback-submit");
    fireEvent.change(screen.getByTestId("rollback-confirm-input"), { target: { value: "ROLL BACK" } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("rollback-reason"), { target: { value: "Opening balances were wrong" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.rollback).toHaveBeenCalledWith("ROLL BACK", "Opening balances were wrong");
  });
});

describe("setup page", () => {
  it("explains the state, lists the checklist and offers go-live to company-wide administrators", async () => {
    api.setup.mockResolvedValue(SETUP);
    api.access.mockResolvedValue(ACCESS);
    render(<SetupPage />);
    expect(await screen.findByTestId("setup-step-plans")).toHaveTextContent("Build leave plans");
    expect(screen.getByTestId("leave-state")).toHaveTextContent("Legacy leave (LEGACY_V1)");
    expect(screen.getByTestId("leave-state")).toHaveTextContent("Current");
    expect(await screen.findByTestId("go-live-open")).toBeEnabled();
    expect(screen.queryByTestId("rollback-open")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("go-live-open"));
    expect(await screen.findByTestId("go-live-confirm-input")).toBeInTheDocument();
  });

  it("offers rollback once live, and nothing to scoped administrators", async () => {
    api.setup.mockResolvedValue({ ...SETUP, v2_enabled: true, state: "V2_ACTIVE" });
    api.access.mockResolvedValue({ ...ACCESS, v2_enabled: true });
    const { unmount } = render(<SetupPage />);
    expect(await screen.findByTestId("rollback-open")).toBeInTheDocument();
    expect(screen.queryByTestId("go-live-open")).not.toBeInTheDocument();
    unmount();

    resetLeaveAccessCache();
    api.access.mockResolvedValue({ ...ACCESS, manage_company: false, permissions: { "leave:manage_policy": ["LEGAL_ENTITY"] } });
    render(<SetupPage />);
    expect(await screen.findByText("Go-live and rollback need company-wide leave configuration access")).toBeInTheDocument();
    expect(screen.queryByTestId("rollback-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("run-reconcile")).not.toBeInTheDocument();
  });

  it("points the approval step at the approval route editor", () => {
    expect(stepLink(SETUP.steps[2])).toBe("/settings/leave/rules?tab=approval");
    expect(stepLink(SETUP.steps[0])).toBe("/settings/leave/types");
  });
});
