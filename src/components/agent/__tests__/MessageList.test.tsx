/** Assistant conversation: plain-text rendering, typed blocks, retry; voice only fills the composer (§21, §22). */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { Composer } from "@/components/agent/Composer";
import { MessageList, type LocalMessage } from "@/components/agent/MessageList";
import type { ActionRequiredBlock } from "@/lib/agent-types";

const card: ActionRequiredBlock = {
  type: "action_required",
  action_id: "a1",
  action_type: "leave.apply",
  risk: "R2",
  status: "prepared",
  summary: "Apply 1 day(s) of Casual Leave: 2026-11-02",
  details: { leave_type_name: "Casual Leave", start_date: "2026-11-02", end_date: "2026-11-02", days: 1 },
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  confirmation_token: "tok",
  result: null,
  failure_code: null,
};

function msg(overrides: Partial<LocalMessage>): LocalMessage {
  return { id: "m", role: "assistant", content: "", created_at: "2026-10-19T03:30:00Z", blocks: [], ...overrides };
}

it("renders every message as text, never as HTML", () => {
  const html = "Sure! <b>bold</b> <img src=x onerror=alert(1)> <a href='javascript:alert(1)'>click</a>";
  const { container } = render(
    <MessageList
      messages={[msg({ id: "u", role: "user", content: "<script>alert('x')</script>" }), msg({ id: "a", content: html })]}
      onConfirm={jest.fn()}
      onCancel={jest.fn()}
    />,
  );
  for (const tag of ["b", "img", "a", "script"]) expect(container.querySelector(`[data-testid="agent-messages"] ${tag}`)).toBeNull();
  expect(screen.getByTestId("agent-message-assistant").textContent).toBe(html);
  expect(screen.getByTestId("agent-message-user").textContent).toBe("<script>alert('x')</script>");
});

it("keeps line breaks, marks roles and renders status updates and action cards", () => {
  const onConfirm = jest.fn().mockResolvedValue(undefined);
  render(
    <MessageList
      messages={[
        msg({ id: "u", role: "user", content: "Apply casual leave\non Monday" }),
        msg({ id: "a", content: "Please confirm the card.", blocks: [card] }),
        msg({ id: "s", role: "system_event", content: "Leave request #12 was submitted and is pending approval." }),
      ]}
      onConfirm={onConfirm}
      onCancel={jest.fn()}
    />,
  );
  expect(screen.getByTestId("agent-message-user")).toHaveClass("whitespace-pre-wrap");
  expect(screen.getByText(/#12 was submitted/)).toBeInTheDocument();
  expect(screen.getAllByRole("listitem").map((li) => li.getAttribute("data-role"))).toEqual(["user", "assistant", "system_event"]);
  fireEvent.click(screen.getByRole("button", { name: /confirm leave/i }));
  expect(onConfirm).toHaveBeenCalledWith(card);
});

it("offers a retry on a message that failed to send", () => {
  const onRetry = jest.fn();
  const failed = msg({ id: "local-1", role: "user", content: "What is my balance?", error: "The assistant took too long to answer." });
  render(<MessageList messages={[failed]} onConfirm={jest.fn()} onCancel={jest.fn()} onRetry={onRetry} />);
  expect(screen.getByRole("alert")).toHaveTextContent("took too long");
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  expect(onRetry).toHaveBeenCalledWith(failed);
});

it("shows the working indicator while a turn runs", () => {
  render(<MessageList messages={[msg({ id: "u", role: "user", content: "hi" })]} onConfirm={jest.fn()} onCancel={jest.fn()} thinking />);
  expect(screen.getByTestId("agent-thinking")).toBeInTheDocument();
});

describe("voice input", () => {
  type Handler = ((event: unknown) => void) | null;
  let instance: { start: jest.Mock; stop: jest.Mock; abort: jest.Mock; onresult: Handler; onend: (() => void) | null; onerror: Handler };

  beforeEach(() => {
    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: Handler = null;
      onerror: Handler = null;
      onend: (() => void) | null = null;
      start = jest.fn();
      stop = jest.fn(() => this.onend?.());
      abort = jest.fn();
      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        instance = this as unknown as typeof instance;
      }
    }
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognition;
  });

  afterEach(() => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });

  function Harness({ onSend }: { onSend: () => void }) {
    const [value, setValue] = useState("Apply leave");
    return <Composer value={value} onChange={setValue} onSend={onSend} maxChars={100} />;
  }

  it("puts the transcript into the editable composer and never sends it by itself", async () => {
    const onSend = jest.fn();
    render(<Harness onSend={onSend} />);
    const mic = await screen.findByRole("button", { name: /speak your message/i });
    fireEvent.click(mic); // the microphone is requested only now
    expect(instance.start).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("agent-voice-listening")).toBeInTheDocument();
    act(() => {
      instance.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: "on 2 November" } } } });
      instance.onend?.();
    });
    const box = screen.getByTestId("agent-composer") as HTMLTextAreaElement;
    expect(box.value).toBe("Apply leave on 2 November");
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "Apply casual leave on 2 November" } }); // still editable
    expect(box.value).toBe("Apply casual leave on 2 November");
    expect(screen.getByText("32/100")).toBeInTheDocument();
  });
});
