/** G-16: the pre-run health check (GET /cutoff) and the retro breakdown linked to the evaluated day revision. */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";

import { RetroBreakdown } from "../RetroBreakdown";
import { CutoffAssistant } from "../runs/CutoffAssistant";

const get = jest.fn();
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return { ...actual, api: { ...actual.api, get: (...args: unknown[]) => get(...args) } };
});

beforeEach(() => get.mockReset());

test("the health check shows blocking items, the window and the lock state", async () => {
  get.mockResolvedValue({
    pay_group: { id: 3, name: "PG-IN" },
    period: { id: 9, start: "2026-11-01", end: "2026-11-30", status: "OPEN", input_cutoff_on: "2026-11-25", pay_date: "2026-11-30" },
    attendance_window: { start: "2026-10-26", end: "2026-11-25", split: true },
    lock_state: "OPEN", employees: 12, runs: [],
    items: [
      { code: "ATTENDANCE_REQUESTS_PENDING", module: "attendance", severity: "BLOCKING", count: 2,
        message: "2 attendance request(s) waiting", link: "/approvals?module=attendance" },
      { code: "DEVICES_BEHIND", module: "attendance", severity: "WARNING", count: 1, message: "1 device(s) have not synced" },
    ],
    blocking: 1, warnings: 1, ready: false,
  });
  render(<CutoffAssistant open onOpenChange={() => undefined} payGroups={[{ id: 3, name: "PG-IN" }]} />);
  expect(await screen.findByText("1 blocking item(s)")).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith("/cutoff", { params: { pay_group_id: 3 } });
  expect(screen.getByTestId("cutoff-lock")).toHaveTextContent("Inputs open");
  expect(screen.getByTestId("cutoff-summary")).toHaveTextContent(/attendance 26 Oct – 25 Nov/);
  expect(screen.getByTestId("cutoff-item-ATTENDANCE_REQUESTS_PENDING")).toHaveTextContent("Blocking");
  expect(screen.getByTestId("cutoff-item-DEVICES_BEHIND")).toHaveTextContent("Warning");
});

test("the retro breakdown links each adjustment to the attendance day revision", async () => {
  get.mockResolvedValue({
    run_employee_id: 41,
    paid_here: [{
      proposal_id: 7, trigger: "ATTENDANCE", status: "SETTLED", reason: null, currency: "INR",
      original_period: { start: "2026-10-01", end: "2026-10-31" },
      lines: [{ component_code: "BASIC", direction: "ARREARS", delta: "1612.90", explanation: null }],
      cause: { record_type: "attendance_day", record_id: 88, version: "3", dates: ["2026-10-14"] },
      attendance_days: [{ employee_id: 5, date: "2026-10-14", attendance_day_id: 88, version: "3",
        link: "/attendance/days/5/2026-10-14" }],
    }],
    corrections_of_this_period: [],
  });
  render(<RetroBreakdown runEmployeeId={41} />);
  const link = await screen.findByTestId("retro-day-link");
  expect(link).toHaveAttribute("href", "/attendance/days/5/2026-10-14");
  expect(link).toHaveTextContent("revision 3");
  expect(screen.getByText(/\+1612.90 INR/)).toBeInTheDocument();
});

test("nothing renders without adjustments", async () => {
  get.mockResolvedValue({ run_employee_id: 41, paid_here: [], corrections_of_this_period: [] });
  const { container } = render(<RetroBreakdown runEmployeeId={41} />);
  await waitFor(() => expect(get).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});
