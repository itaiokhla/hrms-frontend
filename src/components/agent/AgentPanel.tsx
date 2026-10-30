"use client";

import { MessageSquare, Plus, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { Composer } from "@/components/agent/Composer";
import { MessageList, type LocalMessage } from "@/components/agent/MessageList";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { agentApi, newClientMessageId } from "@/lib/agent-api";
import type { ActionRequiredBlock, AgentMessage, AgentStatus, AgentThread } from "@/lib/agent-types";
import { errorMessage } from "@/lib/api";
import { emitLeaveChanged } from "@/lib/leave/events";

/**
 * The assistant (docs/leave_agent.md §21): owns the selected conversation and the request state. History comes from
 * the server (it survives reloads and sign-in again); nothing is kept in localStorage. Every send carries a client
 * message id generated once per message and reused by Retry, so a retried send never runs a second turn.
 */

interface PanelMessage extends LocalMessage {
  client_message_id?: string;
}

const SELF_SUGGESTIONS = ["What is my leave balance?", "Show my recent leave requests", "Apply casual leave next Monday"];
const APPROVER_SUGGESTION = "Show leave requests waiting for my approval";

function replaceBlock(messages: PanelMessage[], action: ActionRequiredBlock): PanelMessage[] {
  return messages.map((m) =>
    m.blocks.some((b) => b.action_id === action.action_id)
      ? { ...m, blocks: m.blocks.map((b) => (b.action_id === action.action_id ? action : b)) }
      : m,
  );
}

function appendUnique(messages: PanelMessage[], extra: AgentMessage[]): PanelMessage[] {
  const seen = new Set(messages.map((m) => m.id));
  return [...messages, ...extra.filter((m) => !seen.has(m.id))];
}

export function AgentPanel({ status }: { status: AgentStatus }) {
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const current = useRef<string | null>(null);
  current.current = threadId;

  const maxChars = status.max_message_chars ?? 4000;
  const canApprove = (status.capabilities ?? []).some((c) => c.name === "get_my_pending_approvals");
  const suggestions = canApprove ? [...SELF_SUGGESTIONS, APPROVER_SUGGESTION] : SELF_SUGGESTIONS;

  const openThread = useCallback(async (id: string | null) => {
    setThreadId(id);
    setLoadError(null);
    if (!id) {
      setMessages([]);
      return;
    }
    setLoading(true);
    try {
      const page = await agentApi.messages(id);
      if (current.current === id) setMessages(page.messages);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { items } = await agentApi.threads();
      setThreads(items);
      await openThread(items[0]?.id ?? null);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [openThread]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  const reload = useCallback(async () => {
    const id = current.current;
    if (!id) return;
    try {
      const page = await agentApi.messages(id);
      if (current.current === id) setMessages(page.messages);
    } catch {
      /* the card keeps showing the error it received */
    }
  }, []);

  const send = async (content: string, clientMessageId: string, retryOf?: string) => {
    setSending(true);
    const localId = retryOf ?? `local-${clientMessageId}`;
    const local: PanelMessage = {
      id: localId, role: "user", content, created_at: null, blocks: [], pending: true, error: null,
      client_message_id: clientMessageId,
    };
    setMessages((ms) => (retryOf ? ms.map((m) => (m.id === retryOf ? local : m)) : [...ms, local]));
    try {
      let id = current.current;
      if (!id) {
        const thread = await agentApi.createThread();
        id = thread.id;
        setThreads((ts) => [thread, ...ts]);
        setThreadId(id);
        current.current = id;
      }
      const turn = await agentApi.send(id, content, clientMessageId);
      setMessages((ms) => appendUnique(ms.map((m) => (m.id === localId ? turn.user_message : m)), [turn.message]));
      setThreads((ts) => ts.map((t) => (t.id === id && !t.title ? { ...t, title: content.slice(0, 60) } : t)));
    } catch (err) {
      setMessages((ms) => ms.map((m) => (m.id === localId ? { ...m, pending: false, error: errorMessage(err) } : m)));
    } finally {
      setSending(false);
    }
  };

  const onSend = () => {
    const content = draft.trim();
    if (!content || sending) return;
    setDraft("");
    void send(content, newClientMessageId());
  };

  const onRetry = (message: LocalMessage) => {
    const m = message as PanelMessage;
    if (sending || !m.client_message_id) return;
    void send(m.content, m.client_message_id, m.id);
  };

  const onConfirm = async (block: ActionRequiredBlock) => {
    if (!block.confirmation_token) return;
    try {
      const outcome = await agentApi.confirm(block.action_id, block.confirmation_token);
      setMessages((ms) => appendUnique(replaceBlock(ms, outcome.action), outcome.message ? [outcome.message] : []));
      if (outcome.action.status === "completed") {
        if (outcome.action.action_type.startsWith("leave.")) emitLeaveChanged();
        const done = outcome.action.result?.message;
        toast.success(typeof done === "string" ? done : "Done.");
      }
    } catch (err) {
      void reload(); // the server's state of the card (expired, failed) replaces the local one
      throw err;
    }
  };

  const onCancel = async (block: ActionRequiredBlock) => {
    try {
      const outcome = await agentApi.cancel(block.action_id);
      setMessages((ms) => appendUnique(replaceBlock(ms, outcome.action), outcome.message ? [outcome.message] : []));
    } catch (err) {
      void reload();
      throw err;
    }
  };

  return (
    <Card className="flex h-[calc(100vh-13rem)] min-h-[480px] flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-3">
        <MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden />
        <label htmlFor="agent-thread" className="sr-only">
          Conversation
        </label>
        <Select
          id="agent-thread"
          className="h-9 max-w-xs"
          value={threadId ?? ""}
          onChange={(event) => void openThread(event.target.value || null)}
          disabled={sending}
        >
          <option value="">New conversation</option>
          {threads.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title || "Conversation"}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="secondary" onClick={() => void openThread(null)} disabled={sending || !threadId}>
          <Plus className="h-4 w-4" aria-hidden />
          New
        </Button>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-5">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="ml-auto h-10 w-1/2" />
            <Skeleton className="h-24 w-3/4" />
          </div>
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={() => void loadThreads()} />
        ) : messages.length === 0 ? (
          <EmptyState
            icon={<Sparkles />}
            title="How can I help with your leave?"
            description="Ask a question or describe what you need. I prepare requests for you to review; nothing is submitted until you press Confirm."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {suggestions.map((s) => (
                  <Button key={s} size="sm" variant="subtle" onClick={() => setDraft(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            }
          />
        ) : (
          <MessageList messages={messages} onConfirm={onConfirm} onCancel={onCancel} onRetry={onRetry} thinking={sending} />
        )}
      </div>

      <div className="border-t border-border/70 p-3">
        <Composer value={draft} onChange={setDraft} onSend={onSend} sending={sending} disabled={loading && !loadError} maxChars={maxChars} />
        <p className="mt-2 px-1 text-[11px] text-muted-foreground">
          The assistant can make mistakes; check each card before confirming. Voice input uses your browser&apos;s
          speech service and only fills the text box. Don&apos;t share medical or other sensitive details here.
        </p>
      </div>
    </Card>
  );
}
