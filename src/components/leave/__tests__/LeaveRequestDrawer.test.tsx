/** Leave request drawer (leave v2): actions from allowed_actions, change dialog, change decisions, discussion. */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { LeaveRequestDetail } from "@/components/leave/LeaveRequestDrawer";
import { ConfirmProvider } from "@/components/ui/overlay";
import { leaveApi } from "@/lib/leave/api";
import type { LeaveChange, LeaveDetail } from "@/lib/leave/types";

import { access, detail } from "./fixtures";

jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/lib/leave/api", () => {
  const actual = jest.requireActual("@/lib/leave/api");
  return {
    ...actual,
    leaveApi: {
      access: jest.fn(), get: jest.fn(), changes: jest.fn(), messages: jest.fn(), postMessage: jest.fn(), attachments: jest.fn(),
      documentRequests: jest.fn(), withdraw: jest.fn(), submit: jest.fn(), approve: jest.fn(), reject: jest.fn(),
      returnForChanges: jest.fn(), requestChange: jest.fn(), types: jest.fn(), approveChange: jest.fn(), rejectChange: jest.fn(),
      withdrawChange: jest.fn(), acknowledgeChange: jest.fn(), upload: jest.fn(),
    },
  };
});
const api = leaveApi as jest.Mocked<typeof leaveApi>;

function change(overrides: Partial<LeaveChange> = {}): LeaveChange {
  return {
    id: 70, leave_id: 5, employee_id: 42, kind: "CANCEL", status: "PENDING", proposed: {}, reason: null, initiator: "EMPLOYEE",
    from_version: 1, decision_note: null, units_delta: 0, created_at: "2026-11-02T10:00:00Z", decided_at: null, applied_at: null,
    acknowledged_at: null, row_version: 1, can_decide: false, ...overrides,
  };
}

function open(leave: LeaveDetail, opts: { changes?: LeaveChange[]; access?: Parameters<typeof access>[0] } = {}) {
  api.access.mockResolvedValue(access(opts.access));
  api.get.mockResolvedValue(leave);
  api.changes.mockResolvedValue(opts.changes ?? []);
  api.messages.mockResolvedValue([]);
  api.attachments.mockResolvedValue([]);
  api.documentRequests.mockResolvedValue([]);
  const onClose = jest.fn();
  const onEdit = jest.fn();
  render(
    <ConfirmProvider>
      <LeaveRequestDetail id={leave.id} onClose={onClose} onEdit={onEdit} />
    </ConfirmProvider>,
  );
  return { onClose, onEdit };
}

beforeEach(() => jest.clearAllMocks());

it("shows the request and withdraws a pending request after confirming", async () => {
  api.withdraw.mockResolvedValue(detail({ status_v2: "WITHDRAWN", allowed_actions: [] }));
  open(detail());
  expect(await screen.findByTestId("leave-detail")).toHaveAttribute("data-status", "PENDING");
  expect(screen.getByTestId("leave-detail-dates")).toHaveTextContent("9 Nov – 11 Nov 2026");
  expect(screen.getByText("“Family wedding”")).toBeInTheDocument();
  expect(within(screen.getByTestId("approval-steps")).getByText(/Reporting manager/)).toBeInTheDocument();
  expect(screen.queryByTestId("leave-action-approve")).not.toBeInTheDocument();

  fireEvent.click(screen.getByTestId("leave-action-withdraw"));
  const dialog = await screen.findByRole("dialog", { name: "Withdraw this request?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Withdraw" }));
  await waitFor(() => expect(api.withdraw).toHaveBeenCalledWith(5));
});

it("lets the approver approve with a note and requires a reason to reject or return", async () => {
  api.approve.mockResolvedValue(detail({ status_v2: "APPROVED" }));
  api.returnForChanges.mockResolvedValue(detail({ status_v2: "RETURNED" }));
  open(detail({ employee_id: 7, employee_name: "Ravi Kumar", can_act: true, acting_as: "approver", allowed_actions: ["APPROVE", "REJECT", "RETURN"], flags: ["EMERGENCY"], source: "HR_RECORDED" }),
    { access: { permissions: { "leave:approve": ["TEAM"] } } });
  await screen.findByTestId("leave-detail");
  expect(screen.getByTestId("leave-flags")).toHaveTextContent("HR recorded");
  expect(screen.getByTestId("leave-flags")).toHaveTextContent("Emergency");
  expect(screen.queryByTestId("leave-action-withdraw")).not.toBeInTheDocument();

  fireEvent.click(screen.getByTestId("leave-action-approve"));
  let dialog = await screen.findByRole("dialog", { name: "Approve this request?" });
  fireEvent.change(within(dialog).getByTestId("approve-dialog-text"), { target: { value: "Enjoy" } });
  fireEvent.click(within(dialog).getByTestId("approve-dialog-confirm"));
  await waitFor(() => expect(api.approve).toHaveBeenCalledWith(5, "Enjoy"));

  fireEvent.click(screen.getByTestId("leave-action-return"));
  dialog = await screen.findByRole("dialog", { name: "Send back for changes?" });
  fireEvent.click(within(dialog).getByTestId("return-dialog-confirm"));
  expect(await within(dialog).findByText("Please write a reason.")).toBeInTheDocument();
  fireEvent.change(within(dialog).getByTestId("return-dialog-text"), { target: { value: "Split it in two" } });
  fireEvent.click(within(dialog).getByTestId("return-dialog-confirm"));
  await waitFor(() => expect(api.returnForChanges).toHaveBeenCalledWith(5, "Split it in two"));
});

it("edits and submits a draft", async () => {
  api.submit.mockResolvedValue(detail({ status_v2: "PENDING" }));
  const { onEdit } = open(detail({ status: "draft", status_v2: "DRAFT", allowed_actions: ["EDIT", "SUBMIT", "WITHDRAW"] }));
  await screen.findByTestId("leave-detail");
  expect(screen.getByTestId("leave-action-withdraw")).toHaveTextContent("Delete draft");
  fireEvent.click(screen.getByTestId("leave-action-edit"));
  expect(onEdit).toHaveBeenCalledWith(5);
  fireEvent.click(screen.getByTestId("leave-action-submit"));
  await waitFor(() => expect(api.submit).toHaveBeenCalledWith(5));
});

it("closes the drawer when a withdrawn draft is deleted", async () => {
  api.withdraw.mockResolvedValue({ id: 5, deleted: true } as LeaveDetail);
  const { onClose } = open(detail({ status: "draft", status_v2: "DRAFT", allowed_actions: ["EDIT", "SUBMIT", "WITHDRAW"] }));
  fireEvent.click(await screen.findByTestId("leave-action-withdraw"));
  const dialog = await screen.findByRole("dialog", { name: "Delete this draft?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete draft" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it("requests a partial cancellation of approved leave", async () => {
  api.requestChange.mockResolvedValue(change({ kind: "PARTIAL_CANCEL", proposed: { dates: ["2026-11-11"] } }));
  open(detail({ status: "approved", status_v2: "APPROVED", allowed_actions: ["CHANGE"] }));
  fireEvent.click(await screen.findByTestId("leave-action-change"));
  const dialog = await screen.findByRole("dialog", { name: "Change this leave" });
  fireEvent.click(within(dialog).getByRole("radio", { name: "Cancel some days" }));
  fireEvent.click(within(within(dialog).getByTestId("change-dates")).getByLabelText("Wed 11 Nov"));
  fireEvent.change(within(dialog).getByTestId("change-reason"), { target: { value: "Back early" } });
  fireEvent.click(within(dialog).getByTestId("change-submit"));
  await waitFor(() => expect(api.requestChange).toHaveBeenCalledWith(5, { kind: "PARTIAL_CANCEL", proposed: { dates: ["2026-11-11"] }, reason: "Back early" }));
});

it("offers only a full cancellation before the leave v2 cut-over", async () => {
  api.requestChange.mockResolvedValue(change({ status: "APPROVED" }));
  open(detail({ status: "approved", status_v2: "APPROVED", allowed_actions: ["CHANGE"] }), { access: { v2_enabled: false } });
  fireEvent.click(await screen.findByTestId("leave-action-change"));
  const dialog = await screen.findByRole("dialog", { name: "Change this leave" });
  expect(within(dialog).queryByRole("radio", { name: "Change dates" })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByTestId("change-submit"));
  await waitFor(() => expect(api.requestChange).toHaveBeenCalledWith(5, { kind: "CANCEL", proposed: {}, reason: null }));
});

it("decides, withdraws and acknowledges changes from the Changes tab", async () => {
  api.approveChange.mockResolvedValue(change({ status: "APPROVED" }));
  api.acknowledgeChange.mockResolvedValue(change({ id: 72, kind: "RECALL", status: "APPROVED" }));
  api.withdrawChange.mockResolvedValue(change({ id: 71, status: "WITHDRAWN" }));
  open(detail({ status: "approved", status_v2: "APPROVED", allowed_actions: ["CHANGE"] }), {
    changes: [
      change({ id: 70, can_decide: true, kind: "MODIFY", proposed: { start_date: "2026-11-16", end_date: "2026-11-18" } }),
      change({ id: 71, kind: "CANCEL" }),
      change({ id: 72, kind: "RECALL", initiator: "EMPLOYER", proposed: { from_date: "2026-11-10" }, reason: "Client escalation" }),
    ],
  });
  await screen.findByTestId("leave-detail");
  fireEvent.mouseDown(screen.getByRole("tab", { name: /Changes/ }));
  const list = await screen.findByTestId("leave-changes");
  expect(within(list).getByTestId("leave-change-70")).toHaveTextContent("New dates: 16 Nov – 18 Nov 2026");
  expect(within(list).getByTestId("leave-change-72")).toHaveTextContent("Back to work from 10 Nov 2026");

  fireEvent.click(within(list).getByTestId("change-approve-70"));
  await waitFor(() => expect(api.approveChange).toHaveBeenCalledWith(70));
  fireEvent.click(within(list).getByTestId("change-withdraw-71"));
  await waitFor(() => expect(api.withdrawChange).toHaveBeenCalledWith(71));
  fireEvent.click(within(list).getByTestId("change-ack-72"));
  await waitFor(() => expect(api.acknowledgeChange).toHaveBeenCalledWith(72));
});

it("posts to the discussion; approvers can write internal notes", async () => {
  api.postMessage.mockImplementation(async (_id, body, internal) => ({
    id: 900, kind: internal ? "INTERNAL_NOTE" : "COMMENT", visibility: internal ? "APPROVERS_HR" : "PARTICIPANTS", body,
    author: "Arjun Das", mine: true, created_at: "2026-11-02T10:00:00Z",
  }));
  open(detail({ employee_id: 7, can_act: true, allowed_actions: ["APPROVE", "REJECT"] }), { access: { permissions: { "leave:approve": ["TEAM"] } } });
  await screen.findByTestId("leave-detail");
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Discussion" }));
  const box = await screen.findByTestId("leave-discussion");
  expect(await within(box).findByText("No messages yet")).toBeInTheDocument();
  fireEvent.click(within(box).getByRole("switch", { name: "Internal note" }));
  fireEvent.change(within(box).getByTestId("leave-message-input"), { target: { value: "Check coverage first" } });
  fireEvent.click(within(box).getByTestId("leave-message-send"));
  await waitFor(() => expect(api.postMessage).toHaveBeenCalledWith(5, "Check coverage first", true));
});

it("never shows the internal-note switch to the requester", async () => {
  open(detail());
  await screen.findByTestId("leave-detail");
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Discussion" }));
  const box = await screen.findByTestId("leave-discussion");
  await within(box).findByText("No messages yet");
  expect(within(box).queryByRole("switch")).not.toBeInTheDocument();
});
