/** Apply leave (leave v2): live preview rendering, half days, reason rule, draft / submit, readable conflicts. */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { ApplyLeaveForm } from "@/components/leave/ApplyLeaveForm";
import { dayKind } from "@/components/leave/LeavePreviewPanel";
import { LeaveApiError, leaveApi } from "@/lib/leave/api";

import { access, balance, detail, leaveType, preview } from "./fixtures";

jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/lib/leave/api", () => {
  const actual = jest.requireActual("@/lib/leave/api");
  return {
    ...actual,
    leaveApi: {
      access: jest.fn(), myBalances: jest.fn(), types: jest.fn(), preview: jest.fn(), create: jest.fn(), update: jest.fn(),
      submit: jest.fn(), get: jest.fn(), attachments: jest.fn(), upload: jest.fn(),
    },
  };
});
const api = leaveApi as jest.Mocked<typeof leaveApi>;

function setup(overrides: { access?: Parameters<typeof access>[0] } = {}) {
  api.access.mockResolvedValue(access(overrides.access));
  api.myBalances.mockResolvedValue({ date: "2026-11-02", v2_enabled: true, balances: [balance(), balance({ leave_type_code: "SL", name: "Sick Leave", available: 3, color_token: "leave-4" })] });
  api.types.mockResolvedValue([leaveType(), leaveType({ id: 2, code: "SL", name: "Sick Leave", display_name: "Sick Leave", allow_half_day: false })]);
  const onDone = jest.fn();
  const onCancel = jest.fn();
  render(<ApplyLeaveForm onDone={onDone} onCancel={onCancel} />);
  return { onDone, onCancel };
}

beforeEach(() => jest.clearAllMocks());

it("previews each day (charged, weekly off, holiday, sandwich), the balance, the split to unpaid and documents", async () => {
  api.preview.mockResolvedValue(preview({
    start_date: "2026-11-06", end_date: "2026-11-09", charged_units: 2, balance_before: 1, balance_after: 0,
    days: [
      { date: "2026-11-06", requested: "FULL", portion: "FULL", charged: 1, charge_reason: "WORKING", working_portion: "FULL", employed: true, weekly_off: false, holiday: null, holiday_type: null },
      { date: "2026-11-07", requested: "FULL", portion: "FULL", charged: 0, charge_reason: null, working_portion: "NONE", employed: true, weekly_off: true, holiday: null, holiday_type: null },
      { date: "2026-11-08", requested: "FULL", portion: "FULL", charged: 0, charge_reason: null, working_portion: "NONE", employed: true, weekly_off: false, holiday: "Diwali", holiday_type: "PUBLIC" },
      { date: "2026-11-09", requested: "FULL", portion: "FULL", charged: 1, charge_reason: "SANDWICH", working_portion: "NONE", employed: true, weekly_off: true, holiday: null, holiday_type: null },
    ],
    issues: [
      { code: "SPLIT_TO_UNPAID", severity: "WARNING", message: "1 day(s) will be unpaid leave." },
      { code: "ELIGIBILITY_VERIFY", severity: "INFO", message: "HR will confirm your eligibility for this leave." },
    ],
    flags: ["ELIGIBILITY_VERIFY"],
    split: { units: 1, dates: ["2026-11-09"], leave_type: "unpaid" },
    documents_required: [{ category: "MEDICAL_CERTIFICATE", due: "AT_SUBMIT", due_date: null }],
    reason_rule: "REQUIRED",
  }));
  setup();

  // The first preview goes out with the employee's local today and full days.
  await waitFor(() => expect(api.preview).toHaveBeenCalled());
  expect(api.preview).toHaveBeenLastCalledWith(expect.objectContaining({
    leave_type: "CL", start_date: "2026-11-02", end_date: "2026-11-02", start_portion: "FULL", end_portion: "FULL",
    is_emergency: false, attachment_ids: [],
  }));
  expect(api.preview.mock.calls[0][0]).not.toHaveProperty("employee_id");

  const panel = await screen.findByTestId("preview-days");
  expect(within(panel).getByTestId("preview-day-2026-11-06")).toHaveAttribute("data-kind", "charged");
  expect(within(panel).getByTestId("preview-day-2026-11-07")).toHaveAttribute("data-kind", "weekly-off");
  expect(within(panel).getByTestId("preview-day-2026-11-08")).toHaveAttribute("data-kind", "holiday");
  expect(within(panel).getByText("Holiday · Diwali")).toBeInTheDocument();
  expect(within(panel).getByTestId("preview-day-2026-11-09")).toHaveAttribute("data-kind", "sandwich");
  expect(screen.getByTestId("preview-charged")).toHaveTextContent("2 days");
  expect(screen.getByTestId("preview-balance")).toHaveTextContent(/1\s*0/);
  expect(screen.getByTestId("preview-split")).toHaveTextContent("1 day will be unpaid leave");
  expect(screen.getByTestId("preview-documents")).toHaveTextContent("Medical certificate");
  const issues = screen.getByTestId("preview-issues");
  expect(within(issues).getByText("1 day(s) will be unpaid leave.").closest("li")).toHaveAttribute("data-severity", "WARNING");
  expect(within(issues).getByText("HR will confirm your eligibility for this leave.").closest("li")).toHaveAttribute("data-severity", "INFO");
  expect(screen.getByTestId("leave-flags")).toHaveTextContent("Eligibility to verify");
  // reason_rule REQUIRED marks the field.
  expect(screen.getByText("Required for this leave type.")).toBeInTheDocument();
  // The type list shows what is available from the balances.
  expect(screen.getByRole("option", { name: "Casual Leave · 5 days available" })).toBeInTheDocument();
});

it("sends half days and hides the reason when the plan hides it; blocking errors disable submit but not drafts", async () => {
  api.preview.mockResolvedValue(preview({ reason_rule: "HIDDEN" }));
  const { onDone } = setup();
  await screen.findByTestId("preview-charged");
  expect(screen.queryByTestId("leave-reason")).not.toBeInTheDocument();

  // Single day: the half-day choice maps to the API's start/end portions.
  fireEvent.click(within(screen.getByTestId("leave-portion-single")).getByRole("radio", { name: "First half" }));
  await waitFor(() => expect(api.preview).toHaveBeenLastCalledWith(expect.objectContaining({ start_portion: "FULL", end_portion: "FIRST_HALF" })));
  fireEvent.click(within(screen.getByTestId("leave-portion-single")).getByRole("radio", { name: "Second half" }));
  await waitFor(() => expect(api.preview).toHaveBeenLastCalledWith(expect.objectContaining({ start_portion: "SECOND_HALF", end_portion: "FULL" })));

  // A type without half days hides the choice.
  api.preview.mockResolvedValue(preview({
    leave_type: "SL", blocking: true,
    issues: [{ code: "NOTICE_TOO_SHORT", severity: "ERROR", message: "This leave needs 3 calendar days of notice; you gave 0." }],
  }));
  fireEvent.change(screen.getByTestId("leave-type-select"), { target: { value: "SL" } });
  expect(screen.queryByTestId("leave-portion-single")).not.toBeInTheDocument();
  await waitFor(() => expect(api.preview).toHaveBeenLastCalledWith(expect.objectContaining({ leave_type: "SL", start_portion: "FULL", end_portion: "FULL" })));
  expect(await screen.findByText("This leave needs 3 calendar days of notice; you gave 0.")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId("leave-submit")).toBeDisabled());

  api.create.mockResolvedValue(detail({ status_v2: "DRAFT", allowed_actions: ["EDIT", "SUBMIT", "WITHDRAW"] }));
  fireEvent.click(screen.getByTestId("leave-save-draft"));
  await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ leave_type: "SL", draft: true })));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ status_v2: "DRAFT" })));
});

it("submits a request and shows a 409 conflict as a readable message with what to do next", async () => {
  api.preview.mockResolvedValue(preview());
  const { onDone } = setup();
  await screen.findByTestId("preview-charged");
  fireEvent.change(screen.getByTestId("leave-end"), { target: { value: "2026-11-04" } });
  fireEvent.click(within(screen.getByTestId("leave-portion-end")).getByRole("radio", { name: "First half" }));
  fireEvent.change(screen.getByTestId("leave-reason"), { target: { value: "Trip home" } });
  fireEvent.click(screen.getByTestId("leave-emergency"));
  await waitFor(() => expect(api.preview).toHaveBeenLastCalledWith(expect.objectContaining({
    end_date: "2026-11-04", start_portion: "FULL", end_portion: "FIRST_HALF", reason: "Trip home", is_emergency: true,
  })));

  api.create.mockRejectedValueOnce(new LeaveApiError(409, "You already have leave booked on some of these dates.", "LEAVE_OVERLAP", [
    { code: "LEAVE_OVERLAP", severity: "ERROR", message: "You already have leave booked on some of these dates." },
  ]));
  await waitFor(() => expect(screen.getByTestId("leave-submit")).toBeEnabled());
  fireEvent.click(screen.getByTestId("leave-submit"));
  expect(await screen.findByTestId("apply-error")).toHaveTextContent(
    "You already have leave booked on some of these dates. Withdraw or change that leave first.",
  );
  expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ draft: false, end_portion: "FIRST_HALF" }));
  expect(onDone).not.toHaveBeenCalled();

  api.create.mockResolvedValueOnce(detail());
  fireEvent.click(screen.getByTestId("leave-submit"));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id: 5, status_v2: "PENDING" })));
});

it("lets holders of leave:apply_on_behalf choose someone else", async () => {
  api.preview.mockResolvedValue(preview());
  setup({ access: { permissions: { "leave:apply": ["SELF"], "leave:apply_on_behalf": ["TEAM"] } } });
  const group = await screen.findByTestId("apply-for");
  fireEvent.click(within(group).getByRole("radio", { name: "Someone else" }));
  expect(await screen.findByTestId("leave-employee")).toBeInTheDocument();
  // No employee picked yet: nothing to preview or submit.
  expect(screen.getByTestId("leave-submit")).toBeDisabled();
});

describe("dayKind", () => {
  const base = preview().days[0];
  it("labels charged, half, sandwich, holiday, weekly off and not-employed days", () => {
    expect(dayKind(base)).toEqual({ kind: "charged", label: "1 day charged" });
    expect(dayKind({ ...base, charged: 0.5, portion: "FIRST_HALF" }).label).toBe("0.5 day charged (first half)");
    expect(dayKind({ ...base, charge_reason: "SANDWICH" }).kind).toBe("sandwich");
    expect(dayKind({ ...base, charged: 0, holiday: "Holi" }).label).toBe("Holiday · Holi");
    expect(dayKind({ ...base, charged: 0, weekly_off: true }).kind).toBe("weekly-off");
    expect(dayKind({ ...base, employed: false }).kind).toBe("not-employed");
  });
});
