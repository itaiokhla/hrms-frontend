/** UA-AS-161 `⋯ End assignment` (03-shifts/02 §3.3): shift:assign holders end an active rotation assignment with a last
 * day and a reason (the row's `row_version` goes along); the toast says what happened; refusals are shown. The rotation
 * calls use the canonical `/rotation-assignments` paths (AS 11 §6.4). */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";

import { RosterApiError, rotationsApi, type RotationAssignment } from "@/components/rosters/api";
import { AssignmentsList } from "@/components/rotations/RotationAssignments";
import { http } from "@/lib/api";
import { P, type PermissionCode, type Scope } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";
import { useSession } from "@/store/session";

import { resetUrl } from "./rotationNav";

jest.mock("next/navigation", () => require("./rotationNav").navigationMock());
// The Radix menu needs layout APIs jsdom lacks; the row action's wiring is what is under test here.
jest.mock("@/components/ui/overlay", () => {
  const actual = jest.requireActual("@/components/ui/overlay");
  return {
    ...actual,
    DropdownMenu: ({ trigger, children }: { trigger: import("react").ReactNode; children: import("react").ReactNode }) => (
      <div>{trigger}{children}</div>
    ),
    MenuItem: ({ children, onSelect }: { children: import("react").ReactNode; onSelect?: () => void }) => (
      <button type="button" role="menuitem" onClick={onSelect}>{children}</button>
    ),
  };
});

const me: Me = {
  user: { id: 1, email: "a@b.io", full_name: "Test User", mfa_enabled: false, permission_version: 1, last_login_at: null },
  company: { id: 1, name: "Alpha", slug: "alpha", timezone: "Asia/Kolkata", currency: "INR",
    subscription: { status: "active", plan: "pro", trial_ends_at: null, active: true } },
  employee: null, roles: [], is_company_admin: false, registry_version: "test", attendance: { v2: true },
  permissions: { [P.SHIFT_ASSIGN]: ["COMPANY"], [P.ROSTER_READ]: ["COMPANY"] } as Partial<Record<PermissionCode, Scope[]>>,
};

const row = (extra: Partial<RotationAssignment> = {}): RotationAssignment => ({
  id: 1, pattern_version_id: 31, pattern_id: 3, pattern_code: "PUNE-6ON2OFF", version_no: 1, target_kind: "EMPLOYEE",
  employee_id: 7, employee_name: "Ravi Kumar", employee_code: "E7", team_id: null, crew_code: "B", offset_days: 6,
  anchor_date: "2026-11-02", effective_from: "2026-11-02", effective_to: null, status: "ACTIVE", auto_publish: true,
  row_version: 2, ...extra,
});

let assignments: jest.SpyInstance;
let endAssignment: jest.SpyInstance;

beforeEach(() => {
  jest.restoreAllMocks();
  resetUrl("/attendance/rotations/3", "tab=assignments");
  act(() => useSession.setState({ me, status: "authenticated" }));
  assignments = jest.spyOn(rotationsApi, "assignments").mockResolvedValue({ items: [row(), row({ id: 2, employee_id: 8,
    employee_name: "Sita Rao", status: "ENDED", effective_to: "2026-11-20" })], total: 2, skip: 0, limit: 50 });
  endAssignment = jest.spyOn(rotationsApi, "endAssignment");
});

async function openEnd() {
  const [menu] = await screen.findAllByRole("button", { name: "More actions for Ravi Kumar" });
  expect(menu).toBeInTheDocument();
  // Only the active row has the action (card mode repeats the row below md).
  expect(screen.queryAllByRole("button", { name: "More actions for Sita Rao" })).toHaveLength(0);
  fireEvent.click(screen.getAllByRole("menuitem", { name: "End assignment…" })[0]);
  return screen.findByRole("dialog", { name: "End assignment" });
}

test("ending sends the last day, reason and row_version, toasts and reloads the list", async () => {
  const success = jest.spyOn(toast, "success");
  endAssignment.mockResolvedValue({ ...row(), status: "ENDED", effective_to: "2026-11-08", row_version: 3, drafts_removed: 6 });
  render(<main><AssignmentsList patternId={3} canAssign /></main>);

  const dialog = await openEnd();
  expect(dialog).toHaveTextContent("Ravi Kumar stops following PUNE-6ON2OFF v1 after the last day.");
  fireEvent.change(within(dialog).getByLabelText(/^Last day/), { target: { value: "2026-11-08" } });
  fireEvent.click(within(dialog).getByTestId("end-submit"));
  expect(await within(dialog).findByText("Give a reason.")).toBeInTheDocument();
  expect(endAssignment).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: " Moves to the day crew " } });
  fireEvent.click(within(dialog).getByTestId("end-submit"));

  await waitFor(() => expect(endAssignment).toHaveBeenCalledTimes(1));
  expect(endAssignment).toHaveBeenCalledWith(1, { effective_to: "2026-11-08", reason: "Moves to the day crew", row_version: 2 },
    expect.any(String));
  await waitFor(() => expect(success).toHaveBeenCalledWith("Assignment ends 8 Nov 2026. Unpublished drafts after it were removed."));
  await waitFor(() => expect(assignments).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "End assignment" })).not.toBeInTheDocument());
});

test("a refusal (someone changed the row) stays in the dialog with plain words", async () => {
  endAssignment.mockRejectedValue(new RosterApiError(409, "This record was changed by someone else.", "ROW_VERSION_CONFLICT"));
  render(<main><AssignmentsList patternId={3} canAssign /></main>);
  const dialog = await openEnd();
  fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: "Leaves the plant" } });
  fireEvent.click(within(dialog).getByTestId("end-submit"));
  const alert = await within(dialog).findByTestId("rotation-error");
  expect(alert).toHaveAttribute("data-code", "ROW_VERSION_CONFLICT");
  expect(alert).toHaveTextContent("Someone else changed this assignment. Reload and try again.");
});

test("viewers without shift:assign get no row action", async () => {
  render(<main><AssignmentsList patternId={3} canAssign={false} /></main>);
  expect((await screen.findAllByText("Ravi Kumar")).length).toBeGreaterThan(0);
  expect(screen.queryAllByRole("button", { name: /More actions/ })).toHaveLength(0);
});

test("the client calls the canonical /rotation-assignments paths with an Idempotency-Key", async () => {
  const request = jest.spyOn(http, "request")
    .mockResolvedValue({ status: 200, data: { items: [], total: 0, skip: 0, limit: 100 } } as never);
  assignments.mockRestore();
  endAssignment.mockRestore();
  await rotationsApi.assignments({ pattern_id: 3 });
  await rotationsApi.assign({ pattern_version_id: 31, employee_ids: [7], crew_code: "B", offset_days: 6,
    anchor_date: "2026-11-02", effective_from: "2026-11-02", effective_to: null, auto_publish: true });
  await rotationsApi.endAssignment(5, { effective_to: "2026-11-08", reason: "x", row_version: 2 }, "key-1");
  const calls = request.mock.calls.map(([config]) => [config.method, config.url]);
  expect(calls).toEqual([["get", "/rotation-assignments"], ["post", "/rotation-assignments"],
    ["post", "/rotation-assignments/5/end"]]);
  expect(request.mock.calls[0][0].params).toEqual({ skip: 0, limit: 100, pattern_id: 3 });
  expect(request.mock.calls[2][0].headers).toEqual({ "Idempotency-Key": "key-1" });
  expect(request.mock.calls[2][0].data).toEqual({ effective_to: "2026-11-08", reason: "x", row_version: 2 });
});
