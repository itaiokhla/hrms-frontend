/** AS-M6 (03-shifts/03 §12.3, SP-AS-045): the employee board lists claimable open shifts; "Show shifts I can't take"
 * asks the server for the others (`eligible_only=false`), which show their reasons and no Claim button. FU-AS-51 (g):
 * the board's filters and saved views (list key `roster.open_shifts`) live in the URL, and each card links to its page. */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { OpenShiftsBoard } from "@/components/rosters/requests/ShiftRequestLists";
import { P, type PermissionCode, type Scope } from "@/lib/permissions.generated";
import { savedViewsApi, type SavedViewList } from "@/lib/savedViews";
import { shiftRequestsApi, type OpenShift } from "@/lib/shiftRequests";
import type { Me } from "@/lib/types";
import { useSession } from "@/store/session";

import { currentQuery, resetUrl } from "./navMock";

jest.mock("next/navigation", () => require("./navMock").navigationMock());
jest.mock("@/lib/shiftRequests", () => {
  const actual = jest.requireActual("@/lib/shiftRequests");
  return { ...actual, shiftRequestsApi: { ...actual.shiftRequestsApi, openShifts: jest.fn() } };
});
jest.mock("@/lib/savedViews", () => {
  const actual = jest.requireActual("@/lib/savedViews");
  return { ...actual, savedViewsApi: { ...actual.savedViewsApi, list: jest.fn(), create: jest.fn() } };
});

const base = {
  branch_id: 1, team_id: null, site_id: null, shift_id: 5, shift_code: "EARLY", custom_start_time: null,
  custom_end_time: null, required_count: 1, filled_count: 0, pending_claims: 0, required_tags: [], status: "OPEN",
  source: "MANUAL", approval_required: true, priority_until: null, expires_at: "2026-11-14T00:30:00+00:00",
  warnings: [], my_claim: null,
};
const mine = { ...base, id: 11, shift_date: "2026-11-14", can_claim: true, reasons: [] } as unknown as OpenShift;
const other = { ...base, id: 12, shift_date: "2026-11-15", can_claim: false, reasons: ["BRANCH"] } as unknown as OpenShift;
const openShifts = shiftRequestsApi.openShifts as jest.Mock;
const listViews = savedViewsApi.list as jest.Mock;
const createView = savedViewsApi.create as jest.Mock;

const views = (extra: Partial<SavedViewList> = {}): SavedViewList => ({
  list_key: "roster.open_shifts", default_sort: "shift_date", sort_keys: ["shift_date"], columns: [], page_sizes: [25, 50],
  limit: 20, views: [],
  system_views: [{ id: "sys:i_can_take", key: "i_can_take", name: "Shifts I can take", query: { eligible_only: true }, is_hidden: false, position: 0 }],
  ...extra,
});

function me(permissions: Partial<Record<PermissionCode, Scope[]>>): Me {
  return {
    user: { id: 1, email: "a@b.io", full_name: "Test User", mfa_enabled: false, permission_version: 1, last_login_at: null },
    company: { id: 1, name: "Alpha", slug: "alpha", timezone: "Asia/Kolkata", currency: "INR",
      subscription: { status: "active", plan: "pro", trial_ends_at: null, active: true } },
    employee: { id: 10, employee_code: "E1", first_name: "Test", last_name: "User", position: null, department: null, has_photo: false },
    roles: [], permissions, is_company_admin: false, registry_version: "test", attendance: { v2: true },
  };
}

beforeEach(() => {
  resetUrl();
  openShifts.mockReset();
  openShifts.mockImplementation((_from?: string, _to?: string, _status?: string, eligibleOnly?: boolean) =>
    Promise.resolve({ items: eligibleOnly === false ? [mine, other] : [mine], can_post: false, from: "", to: "" }));
  listViews.mockReset();
  listViews.mockResolvedValue(views());
  createView.mockReset();
});
afterEach(() => act(() => useSession.setState({ me: null })));

test("the default board asks for claimable shifts only; the toggle adds the others with their reasons", async () => {
  render(<OpenShiftsBoard />);
  expect(await screen.findByTestId("open-shift-11")).toBeInTheDocument();
  expect(openShifts).toHaveBeenLastCalledWith(undefined, undefined, undefined, undefined);
  expect(screen.queryByTestId("open-shift-12")).not.toBeInTheDocument();
  expect(screen.getByTestId("claim-11")).toBeInTheDocument();

  fireEvent.click(screen.getByTestId("open-shifts-show-all"));
  expect(await screen.findByTestId("open-shift-12")).toBeInTheDocument();
  await waitFor(() => expect(openShifts).toHaveBeenLastCalledWith(undefined, undefined, undefined, false));
  expect(screen.queryByTestId("claim-12")).not.toBeInTheDocument();
  expect(currentQuery()).toBe("eligible_only=false");
});

test("the saved-views control lists the persona views; 'Shifts I can take' sends eligible_only=true, All clears it", async () => {
  render(<OpenShiftsBoard />);
  const view = await screen.findByRole("tab", { name: "Shifts I can take" });
  expect(listViews).toHaveBeenCalledWith("roster.open_shifts");
  expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");

  fireEvent.click(view);
  await waitFor(() => expect(openShifts).toHaveBeenLastCalledWith(undefined, undefined, undefined, true));
  expect(currentQuery()).toBe("view=sys%3Ai_can_take&eligible_only=true");
  expect(screen.getByRole("tab", { name: "Shifts I can take" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByTestId("open-shifts-show-all")).not.toBeChecked();

  // Changing a filter under a view marks it modified (Reset brings the stored query back).
  fireEvent.click(screen.getByTestId("open-shifts-show-all"));
  await waitFor(() => expect(openShifts).toHaveBeenLastCalledWith(undefined, undefined, undefined, false));
  expect(screen.getByLabelText("modified")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  await waitFor(() => expect(openShifts).toHaveBeenLastCalledWith(undefined, undefined, undefined, true));

  fireEvent.click(screen.getByRole("tab", { name: "All" }));
  await waitFor(() => expect(openShifts).toHaveBeenLastCalledWith(undefined, undefined, undefined, undefined));
  expect(currentQuery()).toBe("");
});

test("a saved view that shows every shift (eligible_only=false) applies through the URL and ticks the toggle", async () => {
  listViews.mockResolvedValue(views({ views: [{ id: 7, list_key: "roster.open_shifts", name: "Everything", query: { eligible_only: false, from: "2026-11-01" },
    is_shared: false, is_default: false, position: 0, own: true, owner_name: null, row_version: 1, allowed_actions: ["update", "delete"] }] }));
  render(<OpenShiftsBoard />);
  fireEvent.click(await screen.findByRole("tab", { name: "Everything" }));
  await waitFor(() => expect(openShifts).toHaveBeenLastCalledWith("2026-11-01", undefined, undefined, false));
  expect(screen.getByTestId("open-shifts-show-all")).toBeChecked();
  expect(screen.getByLabelText("From")).toHaveValue("2026-11-01");
  expect(screen.queryByLabelText("modified")).not.toBeInTheDocument();
});

test("Save as new view stores the board's filters with eligible_only as a boolean", async () => {
  createView.mockImplementation((_key: string, body: { name: string; query: Record<string, unknown> }) => Promise.resolve({
    id: 9, list_key: "roster.open_shifts", ...body, is_shared: false, is_default: false, position: 1, own: true, owner_name: null,
    row_version: 1, allowed_actions: [] }));
  render(<OpenShiftsBoard />);
  await screen.findByTestId("open-shift-11");
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-10" } });
  fireEvent.click(screen.getByTestId("open-shifts-show-all"));
  await waitFor(() => expect(openShifts).toHaveBeenLastCalledWith("2026-11-10", undefined, undefined, false));

  fireEvent.click(screen.getByRole("button", { name: "Save as new view…" }));
  fireEvent.change(await screen.findByLabelText(/Name/), { target: { value: "Next fortnight" } });
  fireEvent.click(screen.getByRole("button", { name: "Save view" }));
  await waitFor(() => expect(createView).toHaveBeenCalledWith("roster.open_shifts",
    { name: "Next fortnight", query: { from: "2026-11-10", eligible_only: false }, is_shared: false, is_default: false }));
  await waitFor(() => expect(currentQuery()).toBe("view=9&from=2026-11-10&eligible_only=false"));
});

test("each card links to its open-shift page", async () => {
  render(<OpenShiftsBoard />);
  const link = await screen.findByRole("link", { name: /14 Nov 2026 · EARLY/ });
  expect(link).toHaveAttribute("href", "/attendance/open-shifts/11");
});

test("planners also filter by status; employees do not get the status filter", async () => {
  const { unmount } = render(<OpenShiftsBoard />);
  await screen.findByTestId("open-shift-11");
  expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
  unmount();

  act(() => useSession.setState({ me: me({ [P.ROSTER_PLAN]: ["BRANCH"], [P.ROSTER_READ]: ["BRANCH"] }), status: "authenticated" }));
  render(<OpenShiftsBoard />);
  await screen.findByTestId("open-shift-11");
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "FILLED" } });
  await waitFor(() => expect(openShifts).toHaveBeenLastCalledWith(undefined, undefined, "FILLED", undefined));
  expect(screen.getByText("Status: Filled")).toBeInTheDocument();
});
