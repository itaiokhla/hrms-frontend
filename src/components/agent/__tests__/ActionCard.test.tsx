/** Assistant action card: typed fields as plain text, one confirm per click, expiry, outcomes (docs/leave_agent.md §21). */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ActionCard, isExpired } from "@/components/agent/ActionCard";
import type { ActionRequiredBlock } from "@/lib/agent-types";
import { ApiError } from "@/lib/api";

function block(overrides: Partial<ActionRequiredBlock> = {}): ActionRequiredBlock {
  return {
    type: "action_required",
    action_id: "3f1b0d1e-2c4b-4e5f-9a7b-1c2d3e4f5a6b",
    action_type: "leave.apply",
    risk: "R2",
    status: "prepared",
    summary: "Apply 2 day(s) of Casual Leave: 2026-11-02 to 2026-11-03",
    details: {
      leave_type_name: "Casual Leave", start_date: "2026-11-02", end_date: "2026-11-03", days: 2,
      reason: "Family work", available_before: 8, available_after: 6, warnings: ["1 day(s) will be unpaid leave."],
    },
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    confirmation_token: "signed.token-value",
    result: null,
    failure_code: null,
    ...overrides,
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => jest.useRealTimers());

it("shows the server's summary and allowlisted details as plain text", () => {
  render(<ActionCard block={block()} onConfirm={jest.fn()} onCancel={jest.fn()} />);
  expect(screen.getByTestId("agent-action-summary")).toHaveTextContent("Apply 2 day(s) of Casual Leave");
  expect(screen.getByText("Casual Leave")).toBeInTheDocument();
  expect(screen.getByText("Family work")).toBeInTheDocument();
  expect(screen.getByText("Balance before:").nextSibling).toHaveTextContent("8");
  expect(screen.getByText("Balance after:").nextSibling).toHaveTextContent("6");
  expect(screen.getByText("1 day(s) will be unpaid leave.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /confirm leave/i })).toBeEnabled();
});

it("never renders HTML from the details or the summary", () => {
  const evil = '<img src=x onerror="window.__pwned=1"><b>bold</b>';
  const { container } = render(
    <ActionCard
      block={block({ summary: evil, details: { reason: evil, leave_type_name: "<script>alert(1)</script>", secret: { nested: evil } } })}
      onConfirm={jest.fn()}
      onCancel={jest.fn()}
    />,
  );
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("b")).toBeNull();
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByTestId("agent-action-summary").textContent).toBe(evil);
  expect(container.textContent).not.toContain("nested"); // non-allowlisted / object fields are not rendered
});

it("sends one confirmation for a double click and disables the buttons while it is in flight", async () => {
  const pending = deferred();
  const onConfirm = jest.fn(() => pending.promise);
  render(<ActionCard block={block()} onConfirm={onConfirm} onCancel={jest.fn()} />);
  const button = screen.getByRole("button", { name: /confirm leave/i });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
  await act(async () => {
    pending.resolve();
    await pending.promise;
  });
  await waitFor(() => expect(button).toBeEnabled());
});

it("shows the server's refusal and lets the user try again", async () => {
  const onConfirm = jest.fn().mockRejectedValue(
    new ApiError(400, "Insufficient Casual Leave balance. Available: 1 day(s).", "INSUFFICIENT_BALANCE"),
  );
  render(<ActionCard block={block()} onConfirm={onConfirm} onCancel={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /confirm leave/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Insufficient Casual Leave balance");
});

it("an expired action offers no confirm button and asks to prepare it again", () => {
  render(<ActionCard block={block({ status: "expired", confirmation_token: null })} onConfirm={jest.fn()} onCancel={jest.fn()} />);
  expect(screen.getByTestId("agent-action-expired")).toHaveTextContent("expired");
  expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
});

it("a prepared action turns expired on screen when its time runs out", () => {
  jest.useFakeTimers();
  const soon = block({ expires_at: new Date(Date.now() + 1_000).toISOString() });
  expect(isExpired(soon)).toBe(false);
  render(<ActionCard block={soon} onConfirm={jest.fn()} onCancel={jest.fn()} />);
  expect(screen.getByRole("button", { name: /confirm leave/i })).toBeInTheDocument();
  act(() => {
    jest.advanceTimersByTime(1_200);
  });
  expect(screen.queryByRole("button", { name: /confirm leave/i })).toBeNull();
  expect(screen.getByTestId("agent-action-card")).toHaveAttribute("data-status", "expired");
});

it("shows completed, failed and cancelled outcomes without actions", () => {
  const { rerender } = render(
    <ActionCard
      block={block({ status: "completed", confirmation_token: null, result: { leave_request_id: 438, message: "Leave request #438 was submitted and is pending approval." } })}
      onConfirm={jest.fn()}
      onCancel={jest.fn()}
    />,
  );
  expect(screen.getByTestId("agent-action-result")).toHaveTextContent("#438");
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<ActionCard block={block({ status: "failed", confirmation_token: null, failure_code: "PERMISSION_DENIED" })} onConfirm={jest.fn()} onCancel={jest.fn()} />);
  expect(screen.getByText(/Not completed \(Permission denied\)/)).toBeInTheDocument();
  rerender(<ActionCard block={block({ status: "cancelled", confirmation_token: null })} onConfirm={jest.fn()} onCancel={jest.fn()} />);
  expect(screen.getByText("Cancelled")).toBeInTheDocument();
  expect(screen.queryByRole("button")).toBeNull();
});

it("labels approval cards for the approver", () => {
  const onCancel = jest.fn().mockResolvedValue(undefined);
  render(
    <ActionCard
      block={block({ action_type: "leave.reject", risk: "R3", summary: "Reject Priya Shah's Casual Leave", details: { employee_name: "Priya Shah", remarks: "Team offsite" } })}
      onConfirm={jest.fn()}
      onCancel={onCancel}
    />,
  );
  expect(screen.getByText("Reject leave request")).toBeInTheDocument();
  expect(screen.getByText("Priya Shah")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: /confirm rejection/i })).toBeInTheDocument();
});
