/**
 * Assistant API types (docs/leave_agent.md §18, §21). The UI renders only these typed server fields: it never parses
 * actions out of the assistant's prose and never renders model text as HTML.
 */

export type AgentRole = "user" | "assistant" | "system_event";

export type AgentActionStatus = "prepared" | "executing" | "completed" | "cancelled" | "expired" | "failed";

export interface ActionRequiredBlock {
  type: "action_required";
  action_id: string;
  /** leave.apply | leave.withdraw | leave.cancel | leave.approve | leave.reject */
  action_type: string;
  /** R2 personal write, R3 approval write. */
  risk: string;
  status: AgentActionStatus;
  summary: string;
  details: Record<string, unknown>;
  expires_at: string;
  /** Present only while the action can be confirmed. */
  confirmation_token: string | null;
  result: Record<string, unknown> | null;
  failure_code: string | null;
}

export type AgentBlock = ActionRequiredBlock;

export interface AgentMessage {
  id: string;
  role: AgentRole;
  content: string;
  created_at: string | null;
  blocks: AgentBlock[];
}

export interface AgentThread {
  id: string;
  module: string;
  title: string | null;
  status: "active" | "archived";
  created_at: string | null;
  updated_at: string | null;
}

export interface AgentCapability {
  name: string;
  risk: string;
  kind: "read" | "prepared_write";
}

export interface AgentStatus {
  enabled: boolean;
  /** Only for company administrators while the assistant is unavailable. */
  reason?: string;
  modules?: string[];
  max_message_chars?: number;
  action_ttl_minutes?: number;
  capabilities?: AgentCapability[];
}

export interface AgentMessagesPage {
  thread: AgentThread;
  messages: AgentMessage[];
  has_more: boolean;
}

export interface AgentTurn {
  thread_id: string;
  user_message: AgentMessage;
  message: AgentMessage;
  blocks: AgentBlock[];
  replayed: boolean;
}

export interface AgentActionOutcome {
  action: ActionRequiredBlock;
  replayed?: boolean;
  message: AgentMessage | null;
}
