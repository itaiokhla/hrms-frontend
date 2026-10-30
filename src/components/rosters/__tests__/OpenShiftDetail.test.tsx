/** FU-AS-51 (g): `/attendance/open-shifts/{id}` (03-shifts/03 §12.3, §6.5). The viewer's own claim and Claim (with the
 * board's warnings flow), the ranked claims only when the API returns them (planners / approvers), Cancel only for
 * planners, NotFoundState for a bad or unknown id, and no axe violations. */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { OpenShiftDetail } from "@/components/rosters/requests/OpenShiftDetail";
import { ConfirmProvider } from "@/components/ui/overlay";
import { ApiError } from "@/lib/api";
import { P, type PermissionCode, type Scope } from "@/lib/permissions.generated";
import { shiftRequestsApi, type OpenShift, type OpenShiftClaim } from "@/lib/shiftRequests";
import type { Me } from "@/lib/types";
import { useSession } from "@/store/session";

expect.extend(toHaveNoViolations);

jest.mock("next/navigation", () => require("./navMock").navigationMock());
jest.mock("@/lib/shiftRequests", () => {
  const actual = jest.requireActual("@/lib/shiftRequests");
  return { ...actual, shiftRequestsApi: { ...actual.shiftRequestsApi, openShift: jest.fn(), claim: jest.fn(), cancelOpenShift: jest.fn() } };
});

const openShift = shiftRequestsApi.openShift as jest.Mock;
const claimApi = shiftRequestsApi.claim as jest.Mock;
const cancelApi = shiftRequestsApi.cancelOpenShift as jest.Mock;

const base = {
  id: 31, shift_date: "2026-11-14", branch_id: 1, team_id: null, site_id: null, shift_id: 5, shift_code: "EARLY",
  custom_start_time: null, custom_end_time: null, required_count: 2, filled_count: 1, pending_claims: 0,
  required_tags: ["FORKLIFT"], status: "OPEN", source: "MANUAL", approval_required: true, priority_until: null,
  posted_at: "2026-11-01T09:00:00+00:00", expires_at: "2026-11-14T00:30:00+00:00", filled_at: null, note: null,
  released_by_employee_id: null, row_version: 1,
} as unknown as OpenShift;

/** The employee view: eligibility and own claim, no claims list. */
const asEmployee = (extra: Partial<OpenShift> = {}): OpenShift =>
  ({ ...base, can_claim: true, reasons: [], warnings: [], my_claim: null, ...extra });

const claimRow = (id: number, name: string, extra: Partial<OpenShiftClaim> = {}): OpenShiftClaim => ({
  id, kind: "PICKUP", status: "PENDING_APPROVAL", shift_date: "2026-11-14", counter_date: null, requester_employee_id: id + 100,
  requester_name: name, target_employee_id: null, target_name: null, entry: null, counter_entry: null, open_shift_id: 31,
  requested_change: null, requested_shift_code: null, reason: null, approval_required: true, expires_at: null,
  submitted_at: "2026-11-02T10:00:00+00:00", accepted_at: null, decided_at: null, decision_note: null,
  applied_publication_id: null, close_reason: null, checks: [],
  can: { accept: false, decline: false, withdraw: false, approve: true, reject: true },
  ranking: { week_hours_before: 32, week_hours_after: 40, worst_severity: "WARN", tags: ["FORKLIFT"], in_priority_group: true },
  ...extra,
});

/** The planner view: the claims with their ranking inputs (§6.5). */
const asPlanner = (claims: OpenShiftClaim[]): OpenShift => ({ ...base, scheduled_minutes: 480, claims });

function me(permissions: Partial<Record<PermissionCode, Scope[]>>): Me {
  return {
    user: { id: 1, email: "a@b.io", full_name: "Test User", mfa_enabled: false, permission_version: 1, last_login_at: null },
    company: { id: 1, name: "Alpha", slug: "alpha", timezone: "Asia/Kolkata", currency: "INR",
      subscription: { status: "active", plan: "pro", trial_ends_at: null, active: true } },
    employee: { id: 10, employee_code: "E1", first_name: "Test", last_name: "User", position: null, department: null, has_photo: false },
    roles: [], permissions, is_company_admin: false, registry_version: "test", attendance: { v2: true },
  };
}
const employee = me({ [P.ROSTER_READ]: ["SELF"], [P.ROSTER_REQUEST]: ["SELF"] });
const planner = me({ [P.ROSTER_READ]: ["BRANCH"], [P.ROSTER_PLAN]: ["BRANCH"], [P.ROSTER_APPROVE]: ["BRANCH"] });
const signIn = (user: Me) => act(() => useSession.setState({ me: user, status: "authenticated" }));

const branches = [{ id: 1, name: "Pune Plant" }];
const renderDetail = (id = "31") =>
  render(<ConfirmProvider><main><OpenShiftDetail id={id} branches={branches} /></main></ConfirmProvider>);

beforeEach(() => {
  openShift.mockReset();
  claimApi.mockReset();
  cancelApi.mockReset();
});
afterEach(() => act(() => useSession.setState({ me: null })));

test("an employee sees the facts and their claim state with Claim, but no claims list and no Cancel", async () => {
  signIn(employee);
  openShift.mockResolvedValue(asEmployee());
  renderDetail();
  expect(await screen.findByRole("heading", { level: 1, name: "Open shift · 14 Nov 2026 · EARLY" })).toBeInTheDocument();
  expect(openShift).toHaveBeenCalledWith(31);
  expect(screen.getByText("Pune Plant")).toBeInTheDocument();
  expect(screen.getByTestId("open-shift-filled")).toHaveTextContent("1 of 2 filled");
  expect(screen.getByTestId("open-shift-status")).toHaveTextContent("Open");
  expect(screen.getByText("FORKLIFT")).toBeInTheDocument();
  expect(within(screen.getByTestId("open-shift-my-claim")).getByText("You have not claimed this shift.")).toBeInTheDocument();
  expect(screen.getByTestId("claim-31")).toBeInTheDocument();
  expect(screen.queryByTestId("open-shift-claims")).not.toBeInTheDocument();
  expect(screen.queryByTestId("open-shift-cancel-31")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Back to Open shifts/ })).toHaveAttribute("href", "/attendance/open-shifts");
});

test("Claim is hidden when can_claim is false; the reasons and an existing claim are shown instead", async () => {
  signIn(employee);
  openShift.mockResolvedValue(asEmployee({ can_claim: false, reasons: ["BRANCH"], my_claim: { id: 77, status: "PENDING_APPROVAL" } }));
  renderDetail();
  const mine = await screen.findByTestId("open-shift-my-claim");
  expect(within(mine).getByText("Waiting for approval")).toBeInTheDocument();
  expect(within(mine).getByText(/You can't take this shift: Works at another branch/)).toBeInTheDocument();
  expect(screen.queryByTestId("claim-31")).not.toBeInTheDocument();
});

test("Claim reuses the board's flow: new warnings open the confirm dialog and resend with them acknowledged", async () => {
  signIn(employee);
  openShift.mockResolvedValue(asEmployee({ warnings: ["UNAVAILABLE"] }));
  claimApi.mockRejectedValueOnce(Object.assign(new ApiError(422, "Acknowledge the warnings before claiming.", "WARNINGS_UNACKNOWLEDGED"),
    { issues: [{ rule_key: "WEEKLY_HOURS_EXCEEDED", severity: "WARN" }] }));
  claimApi.mockResolvedValueOnce(claimRow(90, "Test User"));
  renderDetail();
  fireEvent.click(await screen.findByTestId("claim-31"));
  await waitFor(() => expect(claimApi).toHaveBeenCalledWith(31, ["UNAVAILABLE"], undefined, false));
  expect(await screen.findByTestId("warnings-list")).toHaveTextContent("Too many hours that week");
  fireEvent.click(screen.getByTestId("warnings-confirm"));
  await waitFor(() => expect(claimApi).toHaveBeenLastCalledWith(31, ["UNAVAILABLE", "WEEKLY_HOURS_EXCEEDED"], undefined, false));
  await waitFor(() => expect(openShift).toHaveBeenCalledTimes(2));  // reloaded after the claim
});

test("a planner sees the claims with their ranking inputs and Cancel (confirmed); no own-claim block", async () => {
  signIn(planner);
  openShift.mockResolvedValue(asPlanner([
    claimRow(1, "Anjali Menon"),
    claimRow(2, "Ravi Kumar", { status: "APPROVED", can: { accept: false, decline: false, withdraw: false, approve: false, reject: false },
      ranking: { week_hours_before: 40, week_hours_after: 48, worst_severity: "PASS", tags: [], in_priority_group: false } }),
  ]));
  cancelApi.mockResolvedValue({ ...base, status: "CANCELLED" });
  renderDetail();
  const table = within(await screen.findByTestId("open-shift-claims")).getByRole("table", { name: "Claims" });
  const [, first, second] = within(table).getAllByRole("row");
  expect(first).toHaveTextContent("Anjali Menon");
  expect(first).toHaveTextContent(/32 h\s*→\s*to\s*40 h/);
  expect(within(first).getByText("Warnings")).toBeInTheDocument();
  expect(within(first).getByText("FORKLIFT")).toBeInTheDocument();
  expect(within(first).getByText("Yes")).toBeInTheDocument();
  expect(within(first).getByTestId("approve-1")).toBeInTheDocument();
  expect(within(first).getByTestId("reject-1")).toBeInTheDocument();
  expect(second).toHaveTextContent("Ravi Kumar");
  expect(within(second).getByText("No issues")).toBeInTheDocument();
  expect(within(second).getByText("No")).toBeInTheDocument();
  expect(within(second).queryByTestId("approve-2")).not.toBeInTheDocument();
  expect(screen.getByText("EARLY · 8 h net")).toBeInTheDocument();
  expect(screen.queryByTestId("open-shift-my-claim")).not.toBeInTheDocument();

  fireEvent.click(screen.getByTestId("open-shift-cancel-31"));
  expect(await screen.findByText("1 pending claim is closed. People already approved keep the shift.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel open shift" }));
  await waitFor(() => expect(cancelApi).toHaveBeenCalledWith(31));
});

test("an empty claims list says so; a planner gets no Cancel once the shift is no longer open", async () => {
  signIn(planner);
  openShift.mockResolvedValue({ ...asPlanner([]), status: "FILLED", filled_count: 2 });
  renderDetail();
  expect(await screen.findByText("No claims yet")).toBeInTheDocument();
  expect(screen.queryByTestId("open-shift-cancel-31")).not.toBeInTheDocument();
});

test("a non-numeric id renders NotFoundState without a call; an unknown or out-of-scope id too", async () => {
  signIn(employee);
  const bad = renderDetail("abc");
  expect(screen.getByText("Open shift not found")).toBeInTheDocument();
  expect(openShift).not.toHaveBeenCalled();
  bad.unmount();

  openShift.mockRejectedValue(new ApiError(404, "Open shift not found.", "NOT_FOUND"));
  renderDetail("404");
  expect(await screen.findByText("Open shift not found")).toBeInTheDocument();
});

test("a failed load offers a retry", async () => {
  signIn(employee);
  openShift.mockRejectedValueOnce(new ApiError(500, "Something went wrong. Please try again."));
  openShift.mockResolvedValueOnce(asEmployee());
  renderDetail();
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(await screen.findByTestId("claim-31")).toBeInTheDocument();
});

test("the detail page has no axe violations (planner view with claims, employee view with a claim)", async () => {
  signIn(planner);
  openShift.mockResolvedValue({ ...asPlanner([claimRow(1, "Anjali Menon")]), can_claim: true, reasons: [], warnings: ["UNAVAILABLE"], my_claim: null });
  const { container, unmount } = renderDetail();
  await screen.findByTestId("open-shift-claims");
  expect(await axe(container)).toHaveNoViolations();
  unmount();

  signIn(employee);
  openShift.mockResolvedValue(asEmployee({ can_claim: false, reasons: ["TAG_MISSING"], my_claim: { id: 5, status: "REJECTED" } }));
  const second = renderDetail();
  await screen.findByTestId("open-shift-my-claim");
  expect(await axe(second.container)).toHaveNoViolations();
});
