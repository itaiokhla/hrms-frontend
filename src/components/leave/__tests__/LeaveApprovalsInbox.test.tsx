/** Leave approvals inbox (leave v2): approve with a note, reject / return need a reason, changes, comp-off, encashment. */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { LeaveApprovalsInbox } from "@/components/leave/LeaveApprovalsInbox";
import { LeaveApiError, leaveApi } from "@/lib/leave/api";
import type { ApprovalsInbox } from "@/lib/leave/types";

import { access, detail, inbox } from "./fixtures";

let mockSearch = new URLSearchParams();
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/leaves/approvals",
  useSearchParams: () => mockSearch,
}));
jest.mock("react-hot-toast", () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/lib/leave/api", () => {
  const actual = jest.requireActual("@/lib/leave/api");
  return {
    ...actual,
    leaveApi: {
      access: jest.fn(), inbox: jest.fn(), approve: jest.fn(), reject: jest.fn(), returnForChanges: jest.fn(),
      approveChange: jest.fn(), rejectChange: jest.fn(), actOnClaim: jest.fn(), actOnEncashment: jest.fn(),
    },
  };
});
const api = leaveApi as jest.Mocked<typeof leaveApi>;

/** After a decision the server no longer lists the item; the inbox reloads on its own change event. */
function decided(list: keyof ApprovalsInbox, id: number) {
  const next = inbox();
  api.inbox.mockResolvedValue({ ...next, [list]: (next[list] as { id: number }[]).filter((x) => x.id !== id) } as ApprovalsInbox);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  api.access.mockResolvedValue(access({ permissions: { "leave:approve": ["TEAM"], "leave:read": ["TEAM"] } }));
  api.inbox.mockResolvedValue(inbox());
});

it("shows flags, source and warnings and approves with the optional note", async () => {
  api.approve.mockResolvedValue(detail({ id: 11, status_v2: "APPROVED" }));
  render(<LeaveApprovalsInbox />);
  const card = await screen.findByTestId("approval-card-11");
  expect(card).toHaveAccessibleName(/Leave request from Ravi Kumar/);
  expect(within(card).getByText("Emergency")).toBeInTheDocument();
  expect(within(card).getByText("Eligibility to verify")).toBeInTheDocument();
  expect(within(card).getByText("On behalf")).toBeInTheDocument();
  expect(within(card).getByText(/too many people would be away/)).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /Leave requests/ })).toHaveTextContent("1");

  fireEvent.change(screen.getByTestId("approval-remarks-11"), { target: { value: "Get well soon" } });
  decided("requests", 11);
  fireEvent.click(screen.getByTestId("approval-approve-11"));
  await waitFor(() => expect(api.approve).toHaveBeenCalledWith(11, "Get well soon"));
  await waitFor(() => expect(screen.queryByTestId("approval-card-11")).not.toBeInTheDocument());
  expect(await screen.findByText("No leave requests waiting for you")).toBeInTheDocument();
});

it("asks for a reason before rejecting and keeps the card when the server refuses", async () => {
  render(<LeaveApprovalsInbox />);
  fireEvent.click(await screen.findByTestId("approval-reject-11"));
  const dialog = await screen.findByRole("dialog", { name: "Reject this request?" });
  fireEvent.click(within(dialog).getByTestId("inbox-reject-dialog-confirm"));
  expect(await within(dialog).findByText("Please write a reason.")).toBeInTheDocument();
  expect(api.reject).not.toHaveBeenCalled();

  api.reject.mockRejectedValueOnce(new LeaveApiError(409, "This request is not awaiting your approval.", "INVALID_TRANSITION"));
  fireEvent.change(within(dialog).getByTestId("inbox-reject-dialog-text"), { target: { value: "Release week" } });
  fireEvent.click(within(dialog).getByTestId("inbox-reject-dialog-confirm"));
  expect(await within(dialog).findByText("This request is not awaiting your approval. Refresh to see where it stands now.")).toBeInTheDocument();
  expect(api.reject).toHaveBeenCalledWith(11, "Release week");
  expect(screen.getByTestId("approval-card-11")).toBeInTheDocument();

  api.reject.mockResolvedValueOnce(detail({ id: 11, status_v2: "REJECTED" }));
  decided("requests", 11);
  fireEvent.click(within(dialog).getByTestId("inbox-reject-dialog-confirm"));
  await waitFor(() => expect(screen.queryByTestId("approval-card-11")).not.toBeInTheDocument());
});

it("returns a request for changes with what should change", async () => {
  api.returnForChanges.mockResolvedValue(detail({ id: 11, status_v2: "RETURNED" }));
  render(<LeaveApprovalsInbox />);
  fireEvent.click(await screen.findByTestId("approval-return-11"));
  const dialog = await screen.findByRole("dialog", { name: "Send back for changes?" });
  fireEvent.change(within(dialog).getByTestId("inbox-return-dialog-text"), { target: { value: "Please pick the week after" } });
  decided("requests", 11);
  fireEvent.click(within(dialog).getByTestId("inbox-return-dialog-confirm"));
  await waitFor(() => expect(api.returnForChanges).toHaveBeenCalledWith(11, "Please pick the week after"));
  await waitFor(() => expect(screen.queryByTestId("approval-card-11")).not.toBeInTheDocument());
});

it("hides Return when the company turned returning off", async () => {
  api.access.mockResolvedValue(access({ return_enabled: false }));
  render(<LeaveApprovalsInbox />);
  await screen.findByTestId("approval-card-11");
  await waitFor(() => expect(screen.queryByTestId("approval-return-11")).not.toBeInTheDocument());
});

it("approves a change of approved leave", async () => {
  mockSearch = new URLSearchParams("tab=changes");
  api.approveChange.mockResolvedValue({ ...inbox().changes[0], status: "APPROVED" });
  render(<LeaveApprovalsInbox />);
  const card = await screen.findByTestId("change-card-21");
  expect(card).toHaveTextContent("Cancel 1 day: 20 Nov");
  expect(card).toHaveTextContent("“Back early”");
  decided("changes", 21);
  fireEvent.click(within(card).getByTestId("change-approve-21"));
  await waitFor(() => expect(api.approveChange).toHaveBeenCalledWith(21));
  await waitFor(() => expect(screen.queryByTestId("change-card-21")).not.toBeInTheDocument());
});

it("approves a comp-off claim", async () => {
  mockSearch = new URLSearchParams("tab=comp-off");
  api.actOnClaim.mockResolvedValue({ ...inbox().comp_off_claims[0], status: "APPROVED" });
  render(<LeaveApprovalsInbox />);
  const card = await screen.findByTestId("claim-card-31");
  expect(card).toHaveTextContent("weekly off");
  expect(card).toHaveTextContent("8 h 20 min");
  expect(card).toHaveTextContent("Credit: 1 day");
  fireEvent.click(within(card).getByTestId("claim-approve-31"));
  await waitFor(() => expect(api.actOnClaim).toHaveBeenCalledWith(31, "approve"));
});

it("rejects an encashment with a reason", async () => {
  mockSearch = new URLSearchParams("tab=encashments");
  api.actOnEncashment.mockResolvedValue({ ...inbox().encashments[0], status: "REJECTED" });
  render(<LeaveApprovalsInbox />);
  fireEvent.click(await screen.findByTestId("encashment-reject-41"));
  const dialog = await screen.findByRole("dialog", { name: "Reject this encashment?" });
  fireEvent.change(within(dialog).getByTestId("inbox-reject-dialog-text"), { target: { value: "Budget freeze" } });
  decided("encashments", 41);
  fireEvent.click(within(dialog).getByTestId("inbox-reject-dialog-confirm"));
  await waitFor(() => expect(api.actOnEncashment).toHaveBeenCalledWith(41, "reject", "Budget freeze"));
  await waitFor(() => expect(screen.queryByTestId("encashment-card-41")).not.toBeInTheDocument());
});

it("opens the request drawer from a card", async () => {
  render(<LeaveApprovalsInbox />);
  fireEvent.click(await screen.findByTestId("approval-open-11"));
  expect(mockPush).toHaveBeenCalledWith("/leaves/approvals?modal=leave&id=11", { scroll: false });
});

it("shows an empty inbox", async () => {
  api.inbox.mockResolvedValue({ requests: [], changes: [], comp_off_claims: [], encashments: [] });
  render(<LeaveApprovalsInbox />);
  expect(await screen.findByText("No leave requests waiting for you")).toBeInTheDocument();
});
