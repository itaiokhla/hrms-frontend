/** S5 accessibility pass (FU-AS-54; owner decision IG-AS-150): axe finds no violations on the open-shift board (with
 * the "Show shifts I can't take" toggle and a claimable card) and on the shift-version preview with its compliance
 * block. */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { OpenShiftsBoard } from "@/components/rosters/requests/ShiftRequestLists";
import type { VersionPreview } from "@/components/shifts/api";
import { VersionImpact } from "@/components/shifts/ShiftVersionModal";
import { TabPanel, Tabs } from "@/components/ui/layout";
import { savedViewsApi } from "@/lib/savedViews";
import { shiftRequestsApi, type OpenShift } from "@/lib/shiftRequests";

expect.extend(toHaveNoViolations);

jest.mock("next/navigation", () => require("./navMock").navigationMock());
jest.mock("@/lib/shiftRequests", () => {
  const actual = jest.requireActual("@/lib/shiftRequests");
  return { ...actual, shiftRequestsApi: { ...actual.shiftRequestsApi, openShifts: jest.fn() } };
});
jest.mock("@/lib/savedViews", () => {
  const actual = jest.requireActual("@/lib/savedViews");
  return { ...actual, savedViewsApi: { ...actual.savedViewsApi, list: jest.fn() } };
});

const shift = {
  id: 21, shift_date: "2026-11-14", branch_id: 1, team_id: null, site_id: null, shift_id: 5, shift_code: "EARLY",
  custom_start_time: null, custom_end_time: null, required_count: 2, filled_count: 1, pending_claims: 0,
  required_tags: ["FORKLIFT"], status: "OPEN", source: "MANUAL", approval_required: true, priority_until: null,
  expires_at: "2026-11-14T00:30:00+00:00", warnings: ["UNAVAILABLE"], my_claim: null, can_claim: true, reasons: [],
} as unknown as OpenShift;

test("the open-shift board (with its saved-view tabs and filters) has no axe violations", async () => {
  (shiftRequestsApi.openShifts as jest.Mock).mockResolvedValue({ items: [shift], can_post: false, from: "", to: "" });
  (savedViewsApi.list as jest.Mock).mockResolvedValue({
    list_key: "roster.open_shifts", default_sort: "shift_date", sort_keys: ["shift_date"], columns: [], page_sizes: [25, 50],
    limit: 20, views: [],
    system_views: [{ id: "sys:i_can_take", key: "i_can_take", name: "Shifts I can take", query: { eligible_only: true }, is_hidden: false, position: 0 }],
  });
  const { container } = render(<main><OpenShiftsBoard /></main>);
  expect(await screen.findByTestId("open-shift-21")).toBeInTheDocument();
  expect(await screen.findByRole("tab", { name: "Shifts I can take" })).toBeInTheDocument();
  expect(await axe(container)).toHaveNoViolations();
});

test("the shift-version preview with a compliance block has no axe violations", async () => {
  const preview: VersionPreview = {
    dry_run: true, versions: [], affected_employees: { count: 0, sample: [] },
    dates_by_payroll_state: {} as VersionPreview["dates_by_payroll_state"],
    scheduled_minutes: { old: 480, new: 720 },
    warnings: [{ code: "VERSION_RANGE_TRUNCATED", applied_effective_to: "2026-12-31" }] as VersionPreview["warnings"],
    compliance: [{ rule_key: "DAILY_HOURS_EXCEEDED", severity: "WARN", country: "AE", zone: "Asia/Dubai", employees: 2,
      measured: "12.00", limit: "10", unit: "h", message_key: "roster.rule.daily_hours_exceeded.not_verified" }],
  };
  const { container } = render(<main><VersionImpact preview={preview} name={(id) => `#${id}`} /></main>);
  expect(await axe(container)).toHaveNoViolations();
});

// Chrome axe on /rosters/my-schedule and /attendance/shift-requests: a strip without TabPanels pointed every trigger's
// aria-controls at a panel that never renders (aria-valid-attr-value).
test("a tab strip without panels has no dangling aria-controls; one with panels keeps them", async () => {
  const tabs = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
  const strip = render(<main><Tabs tabs={tabs} value="a" onValueChange={() => {}}><span /></Tabs><p>A content</p></main>);
  for (const tab of screen.getAllByRole("tab")) expect(tab).not.toHaveAttribute("aria-controls");
  expect(await axe(strip.container)).toHaveNoViolations();
  strip.unmount();

  render(<main><Tabs tabs={tabs} value="a" onValueChange={() => {}}><TabPanel value="a">A</TabPanel><TabPanel value="b">B</TabPanel></Tabs></main>);
  const [first] = screen.getAllByRole("tab");
  expect(document.getElementById(first.getAttribute("aria-controls") ?? "")).toHaveAttribute("role", "tabpanel");
});
