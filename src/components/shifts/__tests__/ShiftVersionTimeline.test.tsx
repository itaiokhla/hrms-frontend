/** AS-M1 exit 3(b): the version timeline shows v1 [2000-01-01..2026-11-30] in force and v2 scheduled from 2026-12-01. */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";

import { ShiftVersionTimeline } from "@/components/shifts/ShiftVersionTimeline";
import type { ShiftVersion } from "@/lib/types";

const base: Omit<ShiftVersion, "id" | "version_no" | "effective_from" | "effective_to" | "core_start_time"> = {
  shift_id: 7, start_time: "08:00", end_time: "20:00", segments: [],
  break_rules: [{ kind: "LUNCH", mode: "AUTO_DEDUCT", minutes: 45, paid: false, auto_deduct_after_minutes: 360 }],
  unpaid_break_minutes: 45, half_split_time: null, core_end_time: "16:00", expected_net_minutes: 480,
  grace_in_minutes: null, grace_out_minutes: null, early_in_window_minutes: 120, late_out_window_minutes: 240,
  anchor_timezone: null, safety_critical: false, outdoor: false, long_duty: false, crosses_midnight: false,
  duration_hours: "12.00", reason: null, voided_at: null, created_at: null,
};
const v1: ShiftVersion = { ...base, id: 1, version_no: 1, effective_from: "2000-01-01", effective_to: "2026-11-30", core_start_time: "11:00" };
const v2: ShiftVersion = { ...base, id: 2, version_no: 2, effective_from: "2026-12-01", effective_to: null, core_start_time: "10:30", reason: "Earlier core start" };

describe("ShiftVersionTimeline", () => {
  it("renders v1 [2000-01-01..2026-11-30] in force and v2 scheduled, in date order", () => {
    render(<ShiftVersionTimeline versions={[v2, v1]} today="2026-10-27" kind="FLEXIBLE" />);
    const list = screen.getByRole("list", { name: "Version timeline" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("v1");
    expect(items[0]).toHaveTextContent("1 Jan 2000 – 30 Nov 2026");
    expect(items[0]).toHaveTextContent("In force");
    expect(items[0]).toHaveTextContent("core 11:00–16:00");
    expect(items[1]).toHaveTextContent("v2");
    expect(items[1]).toHaveTextContent("from 1 Dec 2026");
    expect(items[1]).toHaveTextContent("Scheduled");
    expect(items[1]).toHaveTextContent("core 10:30–16:00");
    expect(items[1]).toHaveTextContent("Earlier core start");
    expect(screen.getByTestId("version-v1").querySelector("time")).toHaveAttribute("dateTime", "2000-01-01");
  });

  it("marks a version that ended as Ended and says so when there are none", () => {
    const { rerender } = render(<ShiftVersionTimeline versions={[v1, v2]} today="2026-12-05" kind="FLEXIBLE" />);
    expect(screen.getByTestId("version-v1")).toHaveTextContent("Ended");
    expect(screen.getByTestId("version-v2")).toHaveTextContent("In force");
    rerender(<ShiftVersionTimeline versions={[]} today="2026-12-05" />);
    expect(screen.getByText("No versions yet.")).toBeInTheDocument();
  });
});
