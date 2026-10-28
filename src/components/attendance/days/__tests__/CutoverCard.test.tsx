/** Settings › Attendance › Overview: the attendance v2 cut-over card (AS-M3; spine §15.1; 13 §4.6 exit 4). */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CutoverCard } from "@/components/attendance/days/CutoverCard";
import { attendanceCutoverApi, type CutoverStatus } from "@/components/attendance/days/api";

jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/components/access/Can", () => ({ useCan: () => ({ me: { user: { id: 5 } } }) }));
jest.mock("@/components/attendance/days/api", () => {
  const actual = jest.requireActual("@/components/attendance/days/api");
  return { ...actual, attendanceCutoverApi: { status: jest.fn(), prepare: jest.fn(), reconcile: jest.fn(), cutover: jest.fn() } };
});
const api = attendanceCutoverApi as jest.Mocked<typeof attendanceCutoverApi>;

beforeEach(() => jest.clearAllMocks());

const reconciling = (startedBy: number, differences = 0): CutoverStatus => ({
  state: "RECONCILING", prepared: true,
  last_reconcile: { job_id: 41, status: "SUCCEEDED", started_by_user_id: startedBy, created_at: "2026-11-06T04:30:00Z",
                    start: "2026-11-02", end: "2026-11-05", days: 4, differences,
                    items: differences ? [{ employee_id: 7, date: "2026-11-03", field: "worked_seconds", legacy: 31500, v2: 31560 }] : [] },
});

describe("CutoverCard", () => {
  it("never lets the administrator who reconciled approve the switch", async () => {
    api.status.mockResolvedValueOnce(reconciling(5));
    render(<CutoverCard />);
    expect(await screen.findByTestId("cutover-state")).toHaveTextContent("Reconciling");
    expect(screen.getByTestId("reconcile-report")).toHaveTextContent("4 days, 0 differences");
    expect(screen.getByRole("button", { name: /switch on attendance v2/i })).toBeDisabled();
    expect(screen.getByText(/another administrator approves the switch/i)).toBeInTheDocument();
  });

  it("lists the differences and keeps the switch off until a clean reconcile", async () => {
    api.status.mockResolvedValueOnce(reconciling(9, 1));
    render(<CutoverCard />);
    expect(await screen.findByText("worked seconds")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /switch on attendance v2/i })).toBeDisabled();
  });

  it("lets a second administrator switch v2 on", async () => {
    api.status.mockResolvedValueOnce(reconciling(9)).mockResolvedValueOnce({ state: "V2_ACTIVE", prepared: true, last_reconcile: null });
    api.cutover.mockResolvedValueOnce({ state: "V2_ACTIVE", prepared: true, last_reconcile: null });
    render(<CutoverCard />);
    const button = await screen.findByRole("button", { name: /switch on attendance v2/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(api.cutover).toHaveBeenCalledWith(41));
    expect(await screen.findByTestId("cutover-state")).toHaveTextContent("Attendance v2: active");
    expect(screen.queryByTestId("reconcile-report")).not.toBeInTheDocument();
  });
});
