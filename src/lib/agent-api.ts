import { api } from "@/lib/api";
import type {
  AgentActionOutcome,
  AgentMessagesPage,
  AgentStatus,
  AgentThread,
  AgentTurn,
} from "@/lib/agent-types";

/**
 * Assistant API (docs/leave_agent.md §21). Uses the shared `api` client, so the session cookies, the CSRF header,
 * the single-flight session refresh and error handling are the same as everywhere else. Nothing here is stored in
 * localStorage; the provider / model is server configuration and never sent from the browser.
 */

/** A chat turn may call the model several times; the server bounds it (steps x provider timeout). */
const TURN_TIMEOUT_MS = 180_000;

const seg = (value: string) => encodeURIComponent(value);

export const agentApi = {
  status: () => api.get<AgentStatus>("/agent/status"),

  threads: () => api.get<{ items: AgentThread[] }>("/agent/threads"),

  createThread: () => api.post<AgentThread>("/agent/threads", { module: "leave" }),

  messages: (threadId: string) => api.get<AgentMessagesPage>(`/agent/threads/${seg(threadId)}/messages`),

  /** `clientMessageId` is generated once per message and reused when that message is retried. */
  send: (threadId: string, content: string, clientMessageId: string) =>
    api.post<AgentTurn>(
      `/agent/threads/${seg(threadId)}/messages`,
      { content, client_message_id: clientMessageId },
      { timeout: TURN_TIMEOUT_MS },
    ),

  confirm: (actionId: string, confirmationToken: string) =>
    api.post<AgentActionOutcome>(`/agent/actions/${seg(actionId)}/confirm`, { confirmation_token: confirmationToken }),

  cancel: (actionId: string) => api.post<AgentActionOutcome>(`/agent/actions/${seg(actionId)}/cancel`, {}),
};

/** A fresh id for one message (letters, digits and dashes; the server accepts 8-100 characters). */
export function newClientMessageId(): string {
  const cryptoApi = typeof globalThis !== "undefined" ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (cryptoApi?.randomUUID) return `m-${cryptoApi.randomUUID()}`;
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return `m-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const statusCache = new Map<number, Promise<AgentStatus>>();

/**
 * The assistant's status for the signed-in user, fetched once per page load and user (the sidebar entry and the
 * page share it). A failed call counts as "not available" and is retried next time.
 */
export function loadAgentStatus(userId: number, force = false): Promise<AgentStatus> {
  let pending = force ? undefined : statusCache.get(userId);
  if (!pending) {
    pending = agentApi.status().catch(() => {
      statusCache.delete(userId);
      return { enabled: false } as AgentStatus;
    });
    statusCache.set(userId, pending);
  }
  return pending;
}

/** Forget the cached status (tests). */
export function resetAgentStatus(): void {
  statusCache.clear();
}
