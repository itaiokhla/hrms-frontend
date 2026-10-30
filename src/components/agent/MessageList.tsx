"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bot, Info, RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";

import { ActionCard } from "@/components/agent/ActionCard";
import { Button } from "@/components/ui/button";
import { MotionSafe } from "@/components/ui/primitives";
import type { ActionRequiredBlock, AgentMessage } from "@/lib/agent-types";
import { cn } from "@/lib/cn";

/** A message shown before the server answered (or after it failed, with a retry). */
export interface LocalMessage extends AgentMessage {
  pending?: boolean;
  error?: string | null;
}

export interface MessageListProps {
  messages: LocalMessage[];
  onConfirm: (block: ActionRequiredBlock) => Promise<void>;
  onCancel: (block: ActionRequiredBlock) => Promise<void>;
  onRetry?: (message: LocalMessage) => void;
  thinking?: boolean;
}

/**
 * The conversation (docs/leave_agent.md §21). Every message is rendered as plain text (React escapes it; no HTML,
 * no Markdown renderer), with line breaks kept. Assistant messages carry typed action blocks rendered by ActionCard.
 */
export function MessageList({ messages, onConfirm, onCancel, onRetry, thinking = false }: MessageListProps) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, thinking]);

  return (
    <MotionSafe>
      <ol className="space-y-4" aria-label="Conversation" aria-live="polite" data-testid="agent-messages">
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.li
              key={message.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
              data-role={message.role}
            >
              {message.role === "system_event" ? (
                <p className="mx-auto flex max-w-[90%] items-start gap-1.5 rounded-xl bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="whitespace-pre-wrap break-words">{message.content}</span>
                </p>
              ) : (
                <div className={cn("max-w-[85%]", message.role === "user" ? "items-end" : "items-start")}>
                  <div
                    className={cn(
                      "flex gap-2.5",
                      message.role === "user" && "flex-row-reverse",
                    )}
                  >
                    {message.role === "assistant" && (
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary" aria-hidden>
                        <Bot className="h-4 w-4" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <div
                        className={cn(
                          "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm",
                          message.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "border border-border/80 bg-surface shadow-card",
                          message.pending && "opacity-70",
                        )}
                        data-testid={`agent-message-${message.role}`}
                      >
                        {message.content}
                      </div>
                      {message.blocks.map((block) => (
                        <ActionCard key={block.action_id} block={block} onConfirm={onConfirm} onCancel={onCancel} />
                      ))}
                      {message.error && (
                        <div className="mt-1.5 flex flex-wrap items-center justify-end gap-2 text-xs text-danger" role="alert">
                          <span>{message.error}</span>
                          {onRetry && (
                            <Button size="sm" variant="ghost" onClick={() => onRetry(message)}>
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                              Retry
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
        {thinking && (
          <li className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="agent-thinking">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-primary" aria-hidden>
              <Bot className="h-4 w-4" />
            </span>
            <span className="inline-flex gap-1" aria-label="The assistant is working">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
            </span>
          </li>
        )}
      </ol>
      <div ref={end} />
    </MotionSafe>
  );
}
