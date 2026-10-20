import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MyAttendanceCard } from "../MyAttendanceCard";
import type { AttendancePolicy, AttendanceRecord, MyAttendance, TrackingStatus } from "@/lib/types";

const post = jest.fn();
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return { ...actual, api: { ...actual.api, post: (...args: unknown[]) => post(...args) } };
});
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const NOW = "2026-10-19T08:00:00+00:00";

const policy = (overrides: Partial<AttendancePolicy> = {}): AttendancePolicy => ({
  version: "v1", require_face: false, require_face_for_lunch: false, allow_multiple_lunches: true, lunch_is_paid: false,
  lunch_open_at_punch_out: "CONFIRM_AUTO_CLOSE", max_shift_hours: 16,
  location: { punch: "REQUIRED", lunch: "OPTIONAL", exception: "ALLOW_WITH_REASON", reject_low_accuracy: false,
    preferred_accuracy_m: 50, acceptable_accuracy_m: 100, timeout_ms: 20000, max_attempts: 3, max_fix_age_seconds: 120,
    retention_days: 90 },
  tracking: { enabled: true, interval_minutes: 120, grace_minutes: 15, pause_on_lunch: true, movement_threshold_m: 1000 },
  ...overrides,
});

const tracking = (overrides: Partial<TrackingStatus> = {}): TrackingStatus => ({
  attendance_id: null, state: "NO_SESSION", stop_reason: null, schedule_state: null, next_due_at: null, grace_until: null,
  overdue_since: null, interval_minutes: 120, grace_minutes: 15, missed_count: 0, pending_missed: 0, last_capture: null,
  last_attempt: null, policy_version: "v1", capture: policy().location, server_now: NOW, ...overrides,
});

const record = (overrides: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  id: 7, employee_id: 3, employee_name: "Esha", date: "2026-10-19", check_in_time: "2026-10-19T03:30:00+00:00",
  check_out_time: null, working_seconds: 16200, status: "present", source: "self", is_manual: false, face_match_score: 0.62,
  notes: null, attendance_state: "WORKING", closed_reason: null, breaks: [], tracking_state: "ACTIVE", location: null,
  hours: { gross_seconds: 16200, lunch_seconds: 0, break_seconds: 0, excluded_seconds: 0, net_seconds: 16200, provisional: true,
    complete: true, issues: [] },
  ...overrides,
});

const view = (overrides: Partial<MyAttendance> = {}): MyAttendance => ({
  state: "not_checked_in", attendance_state: "NOT_PUNCHED_IN", record: null, last_session: null, events: [],
  actions: ["PUNCH_IN"], overnight: false, tracking: tracking(), policy: policy(), server_now: NOW, ...overrides,
});

/** Renders and lets the permission-state lookup settle, so no update happens outside act(). */
const renderCard = async (data: MyAttendance, onChange = jest.fn()) => {
  await act(async () => {
    render(<MyAttendanceCard data={data} onChange={onChange} onReload={jest.fn()} />);
  });
};

const buttonNames = () => screen.queryAllByRole("button").map((b) => b.textContent?.trim());

describe("MyAttendanceCard", () => {
  beforeEach(() => post.mockReset());

  it("offers only Punch in before the shift", async () => {
    await renderCard(view());
    expect(buttonNames()).toEqual(["Punch in"]);
    expect(screen.getByText("You haven't punched in yet.")).toBeInTheDocument();
    expect(screen.getByTestId("tracking-headline")).toHaveTextContent("Location checks start when you punch in");
  });

  it("shows live counters and the next location check while working", async () => {
    jest.useFakeTimers({ now: Date.parse(NOW) });
    await renderCard(view({
      state: "working", attendance_state: "WORKING", record: record(), actions: ["LUNCH_IN", "PUNCH_OUT"],
      tracking: tracking({ attendance_id: 7, state: "ACTIVE", schedule_state: "SCHEDULED", next_due_at: "2026-10-19T05:30:00+00:00" }),
    }));
    expect(buttonNames()).toEqual(["Start lunch", "Punch out"]);
    expect(screen.getByTestId("counter-net")).toHaveTextContent("4:30:00");
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(screen.getByTestId("counter-net")).toHaveTextContent("4:30:05"); // provisional, advancing
    expect(screen.getByTestId("tracking-headline")).toHaveTextContent("Next location check about");
    jest.useRealTimers();
  });

  it("pauses net time and location checks on lunch, and counts missed checks honestly", async () => {
    jest.useFakeTimers({ now: Date.parse(NOW) });
    await renderCard(view({
      state: "working", attendance_state: "ON_LUNCH", actions: ["LUNCH_OUT", "PUNCH_OUT"],
      record: record({ attendance_state: "ON_LUNCH", breaks: [{ id: 1, kind: "LUNCH", started_at: "2026-10-19T07:30:00+00:00", ended_at: null, is_paid: false, end_reason: null }],
        hours: { gross_seconds: 16200, lunch_seconds: 1800, break_seconds: 1800, excluded_seconds: 1800, net_seconds: 14400, provisional: true, complete: true, issues: [] } }),
      tracking: tracking({ attendance_id: 7, state: "PAUSED", missed_count: 2 }),
    }));
    expect(buttonNames()).toEqual(["End lunch", "Punch out"]);
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(screen.getByTestId("counter-net")).toHaveTextContent("4:00:00");
    expect(screen.getByTestId("counter-lunch")).toHaveTextContent("0:30:10");
    expect(screen.getByTestId("tracking-headline")).toHaveTextContent("paused during lunch");
    expect(screen.getByTestId("missed-count")).toHaveTextContent("2 scheduled checks missed");
    jest.useRealTimers();
  });

  it("never shows invented hours for a shift closed without a punch-out", async () => {
    await renderCard(view({
      state: "completed", attendance_state: "PUNCHED_OUT", actions: [],
      record: record({ attendance_state: "PUNCHED_OUT", closed_reason: "MISSING_PUNCH_OUT", hours: {
        gross_seconds: null, lunch_seconds: 0, break_seconds: 0, excluded_seconds: 0, net_seconds: null, provisional: false,
        complete: false, issues: ["MISSING_PUNCH_OUT"] } }),
    }));
    expect(buttonNames()).toEqual([]);
    expect(screen.getByText(/Shift closed without a punch-out/)).toBeInTheDocument();
    expect(screen.getByTestId("counter-net")).toHaveTextContent("—");
  });

  it("has no location UI at all when the company collects none, and punches in with one click", async () => {
    const off = policy({ location: { ...policy().location, punch: "OFF", lunch: "OFF" }, tracking: { ...policy().tracking, enabled: false } });
    const next = view({ attendance_state: "WORKING", record: record(), actions: ["LUNCH_IN", "PUNCH_OUT"], policy: off });
    post.mockResolvedValue(next);
    const onChange = jest.fn();
    await renderCard(view({ policy: off }), onChange);
    expect(screen.queryByTestId("location-panel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Punch in" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(next));
    const [url, form] = post.mock.calls[0] as [string, FormData];
    expect(url).toBe("/attendance/me/check-in");
    const meta = JSON.parse(String(form.get("meta")));
    expect(meta.idempotency_key).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(meta).not.toHaveProperty("location"); // nothing is collected when the policy is off
  });
});
