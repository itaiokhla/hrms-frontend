/** A16 Rotations (09-ui-ux/02 §8.2; 03-shifts/02 §2-§3): the list renders patterns and creates one from a template, the
 * editor lists the API's structural refusals, the assignment form sends `auto_publish`, and axe finds no violations on
 * the list and the editor page. */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import {
  RosterApiError, rotationsApi, type AutoPublishRun, type RotationPattern, type RotationTemplate,
} from "@/components/rosters/api";
import { RotationAssignModal } from "@/components/rotations/RotationAssignments";
import { RotationEditorPage } from "@/components/rotations/RotationEditor";
import { RotationsWorkspace } from "@/components/rotations/RotationsWorkspace";
import { shiftsApi } from "@/components/shifts/api";
import { P, type PermissionCode, type Scope } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";
import { useSession } from "@/store/session";

import { push, resetUrl } from "./rotationNav";

expect.extend(toHaveNoViolations);

jest.mock("next/navigation", () => require("./rotationNav").navigationMock());
jest.mock("@/components/rosters/api", () => {
  const actual = jest.requireActual("@/components/rosters/api");
  return {
    ...actual,
    rotationsApi: {
      templates: jest.fn(), list: jest.fn(), get: jest.fn(), create: jest.fn(), addVersion: jest.fn(), activate: jest.fn(),
      assignments: jest.fn(), assign: jest.fn(), endAssignment: jest.fn(), lastAutoPublish: jest.fn(),
    },
  };
});
jest.mock("@/components/shifts/api", () => {
  const actual = jest.requireActual("@/components/shifts/api");
  return { ...actual, shiftsApi: { ...actual.shiftsApi, list: jest.fn() } };
});
jest.mock("@/components/shared/EmployeePicker", () => ({
  EmployeePicker: ({ onChange }: { onChange: (p: { id: number; full_name: string }) => void }) => (
    <button type="button" onClick={() => onChange({ id: 7, full_name: "Ravi Kumar" })}>Pick Ravi Kumar</button>
  ),
}));

const api = rotationsApi as unknown as Record<keyof typeof rotationsApi, jest.Mock>;

function me(permissions: Partial<Record<PermissionCode, Scope[]>>): Me {
  return {
    user: { id: 1, email: "a@b.io", full_name: "Test User", mfa_enabled: false, permission_version: 1, last_login_at: null },
    company: { id: 1, name: "Alpha", slug: "alpha", timezone: "Asia/Kolkata", currency: "INR",
      subscription: { status: "active", plan: "pro", trial_ends_at: null, active: true } },
    employee: { id: 10, employee_code: "E1", first_name: "Test", last_name: "User", position: null, department: null, has_photo: false },
    roles: [], permissions, is_company_admin: false, registry_version: "test", attendance: { v2: true },
  };
}

const KAVYA = { [P.SHIFT_MANAGE]: ["COMPANY"], [P.SHIFT_ASSIGN]: ["COMPANY"], [P.SHIFT_READ]: ["COMPANY"], [P.ROSTER_READ]: ["COMPANY"] } as const;

const template: RotationTemplate = {
  key: "SIX_ON_TWO_OFF_SLOW", number: 13, name: "6-on-2-off block rotation", cycle_days: 24,
  tokens: "MMMMMMOOAAAAAAOONNNNNNOO", crew_rows: null, crew_offsets: { A: 0, B: 6, C: 12, D: 18 },
  coverage: { M: 1, A: 1, N: 1 }, week_anchor_weekday: null, note: "",
  default_shifts: { M: { start: "06:00:00", end: "14:00:00" }, A: { start: "14:00:00", end: "22:00:00" }, N: { start: "22:00:00", end: "06:00:00" } },
};

const version = (no: number, status: string, id = 30 + no) => ({
  id, pattern_id: 3, version_no: no, status, cycle_days: 24, tokens: template.tokens, crew_rows: null,
  crew_offsets: { A: 0, B: 6, C: 12, D: 18 }, token_map: { M: { shift_id: 5 }, A: { shift_id: 6 }, N: { shift_id: 7 } },
  coverage: { M: 1, A: 1, N: 1 }, week_anchor_weekday: 0, lints_muted: [], content_hash: "x", row_version: 1,
});

const pattern = (versions = [version(1, "ACTIVE")], current: number | null = 31): RotationPattern => ({
  id: 3, code: "PUNE-6ON2OFF", name: "Pune 6 on 2 off", template_key: "SIX_ON_TWO_OFF_SLOW", branch_id: null,
  legal_entity_id: null, status: "ACTIVE", current_version_id: current, row_version: 2, versions,
});

const run: AutoPublishRun = {
  job_id: 91, status: "SUCCEEDED", local_date: "2026-10-30", progress_done: 17, progress_total: 17,
  created_at: "2026-10-30T00:30:00+00:00", finished_at: "2026-10-30T00:31:00+00:00",
  summary: { publications: 15, entries: 84000, blocked_employees: 1, chunks: 17, failed_chunks: 2 }, error: null,
};

const shifts = [
  { id: 5, code: "A", name: "Morning", status: "ACTIVE" }, { id: 6, code: "B", name: "Afternoon", status: "ACTIVE" },
  { id: 7, code: "C", name: "Night", status: "ACTIVE" },
];

beforeEach(() => {
  jest.clearAllMocks();
  resetUrl();
  act(() => useSession.setState({ me: me(KAVYA as unknown as Partial<Record<PermissionCode, Scope[]>>), status: "authenticated" }));
  api.templates.mockResolvedValue([template]);
  api.list.mockResolvedValue([pattern()]);
  api.get.mockResolvedValue(pattern());
  api.lastAutoPublish.mockResolvedValue(run);
  api.assignments.mockResolvedValue({ items: [], total: 0, skip: 0, limit: 100 });
  (shiftsApi.list as jest.Mock).mockResolvedValue({ items: shifts, total: 3, skip: 0, limit: 200 });
});

test("the list shows patterns and the last automatic publish, and creates a rotation from a template", async () => {
  api.create.mockResolvedValue({ ...pattern([], null), id: 9, code: "BLR-6ON2OFF", lints: [] });
  render(<main><RotationsWorkspace /></main>);

  // Card mode (below md) renders each row a second time, so the code appears more than once.
  expect((await screen.findAllByText("PUNE-6ON2OFF")).length).toBeGreaterThan(0);
  expect(screen.getByRole("heading", { level: 1, name: "Rotations" })).toBeInTheDocument();
  expect(screen.getAllByText("6-on-2-off block rotation").length).toBeGreaterThan(0);
  expect(await screen.findByTestId("last-auto-publish")).toHaveTextContent("2 of 17 chunks failed");
  expect(screen.getByTestId("last-auto-publish")).toHaveTextContent("1 person needs a planner decision");

  fireEvent.click(screen.getByRole("button", { name: /New rotation/ }));
  const dialog = await screen.findByRole("dialog", { name: "New rotation" });
  fireEvent.change(within(dialog).getByLabelText("Start from"), { target: { value: "SIX_ON_TWO_OFF_SLOW" } });
  expect(within(dialog).getByTestId("template-preview")).toHaveTextContent("MMMMMMOOAAAAAAOONNNNNNOO");
  expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("6-on-2-off block rotation");
  fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "blr-6on2off" } });
  fireEvent.click(within(dialog).getByTestId("create-rotation"));

  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
  expect(api.create.mock.calls[0][0]).toEqual({ code: "BLR-6ON2OFF", name: "6-on-2-off block rotation", template_key: "SIX_ON_TWO_OFF_SLOW" });
  await waitFor(() => expect(push).toHaveBeenCalledWith("/attendance/rotations/9"));
});

test("the editor lists the structural refusals the API returns for a draft save", async () => {
  api.get.mockResolvedValue(pattern([version(1, "ACTIVE"), version(2, "DRAFT")], 31));
  api.addVersion.mockRejectedValue(new RosterApiError(422, "index 0: 2 crews hold N, coverage says 1", "ROTATION_PATTERN_INVALID", [
    { code: "ROTATION_PATTERN_INVALID", rule: "COVERAGE_MISMATCH", message: "index 0: 2 crews hold N, coverage says 1" },
    { code: "ROTATION_PATTERN_INVALID", rule: "ROW_LENGTH", message: "row tokens length != cycle_days 24" },
  ]));
  resetUrl("/attendance/rotations/3");
  render(<main><RotationEditorPage id="3" /></main>);

  const editor = await screen.findByTestId("draft-editor");
  expect(within(editor).getByRole("heading", { name: "Draft v2" })).toBeInTheDocument();
  fireEvent.change(within(editor).getByLabelText(/^Cycle\*?$/), { target: { value: "MMMMMMOOAAAAAAOONNNNNNON" } });
  fireEvent.click(within(editor).getByTestId("save-draft"));

  const alert = await within(editor).findByTestId("rotation-error");
  expect(alert).toHaveAttribute("data-code", "ROTATION_PATTERN_INVALID");
  expect(alert).toHaveTextContent("The pattern isn't valid yet.");
  expect(alert).toHaveTextContent("The crews don't cover each letter as the pattern says.");
  expect(alert).toHaveTextContent("index 0: 2 crews hold N, coverage says 1");
  expect(alert).toHaveTextContent("row tokens length != cycle_days 24");
  expect(api.addVersion).toHaveBeenCalledWith(3, expect.objectContaining({
    cycle_days: 24, tokens: "MMMMMMOOAAAAAAOONNNNNNON", crew_rows: null,
    token_map: { M: { shift_id: 5 }, A: { shift_id: 6 }, N: { shift_id: 7 } } }), expect.any(String));
  // An unsaved change keeps Activate off until the draft is saved.
  expect(within(editor).getByTestId("activate-version")).toBeDisabled();
});

test("the assignment form sends the crew, offset, dates and auto_publish", async () => {
  api.assign.mockResolvedValue({ items: [{ id: 1 }] });
  resetUrl("/attendance/rotations/3", "modal=rotation-assign");
  const done = jest.fn();
  render(<main><RotationAssignModal pattern={pattern()} onDone={done} /></main>);

  const dialog = await screen.findByRole("dialog", { name: "Assign rotation" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Pick Ravi Kumar" }));
  expect(within(dialog).getByText("1 selected")).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText("Crew"), { target: { value: "B" } });
  expect(within(dialog).getByLabelText("Offset (days)")).toHaveValue(6);
  fireEvent.change(within(dialog).getByLabelText(/^Anchor date/), { target: { value: "2026-11-02" } });
  fireEvent.change(within(dialog).getByLabelText(/^From/), { target: { value: "2026-11-02" } });
  const auto = within(dialog).getByRole("switch", { name: "Publish automatically" });
  fireEvent.click(auto);
  expect(auto).toHaveAttribute("aria-checked", "true");
  fireEvent.click(within(dialog).getByTestId("assign-submit"));

  await waitFor(() => expect(api.assign).toHaveBeenCalledTimes(1));
  expect(api.assign.mock.calls[0][0]).toEqual({
    pattern_version_id: 31, employee_ids: [7], crew_code: "B", offset_days: 6, anchor_date: "2026-11-02",
    effective_from: "2026-11-02", effective_to: null, auto_publish: true,
  });
  await waitFor(() => expect(done).toHaveBeenCalled());
});

test("the list page has no axe violations", async () => {
  api.assignments.mockResolvedValue({ items: [{
    id: 1, pattern_version_id: 31, pattern_id: 3, pattern_code: "PUNE-6ON2OFF", version_no: 1, target_kind: "EMPLOYEE",
    employee_id: 7, employee_name: "Ravi Kumar", employee_code: "E7", team_id: null, crew_code: "B", offset_days: 6,
    anchor_date: "2026-11-02", effective_from: "2026-11-02", effective_to: null, status: "ACTIVE", auto_publish: true,
  }], total: 1, skip: 0, limit: 500 });
  const { container } = render(<main><RotationsWorkspace /></main>);
  expect((await screen.findAllByText("PUNE-6ON2OFF")).length).toBeGreaterThan(0);
  await screen.findByTestId("last-auto-publish");
  expect(await axe(container)).toHaveNoViolations();
});

test("the editor page (draft editor and cycle grid) has no axe violations", async () => {
  api.get.mockResolvedValue(pattern([version(1, "ACTIVE"), version(2, "DRAFT")], 31));
  resetUrl("/attendance/rotations/3");
  const { container } = render(<main><RotationEditorPage id="3" /></main>);
  await screen.findByTestId("draft-editor");
  await screen.findByTestId("last-auto-publish");
  await waitFor(() => expect(screen.getAllByRole("option", { name: "A · Morning" }).length).toBeGreaterThan(0));
  expect(screen.getAllByTestId("cycle-grid").length).toBeGreaterThan(0);
  expect(await axe(container)).toHaveNoViolations();
});
