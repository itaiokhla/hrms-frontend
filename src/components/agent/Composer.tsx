"use client";

import { SendHorizontal } from "lucide-react";
import { useId, type KeyboardEvent } from "react";

import { VoiceInput } from "@/components/agent/VoiceInput";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending?: boolean;
  disabled?: boolean;
  maxChars?: number;
}

/**
 * Editable message box (docs/leave_agent.md §21, §22): Enter sends, Shift+Enter adds a line, a counter shows the
 * length limit. Voice only fills this box (appending to what is there); the user always reviews and presses Send.
 */
export function Composer({ value, onChange, onSend, sending = false, disabled = false, maxChars = 4000 }: ComposerProps) {
  const id = useId();
  const length = value.length;
  const over = length > maxChars;
  const canSend = !sending && !disabled && value.trim().length > 0 && !over;

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) onSend();
    }
  };

  const append = (text: string) => {
    const joined = value.trim() ? `${value.replace(/\s+$/, "")} ${text}` : text;
    onChange(joined);
  };

  return (
    <div className="rounded-2xl border border-border/80 bg-surface p-2 shadow-card">
      <label htmlFor={id} className="sr-only">
        Message to the assistant
      </label>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask about your leave, or say what you need — for example “Apply casual leave next Monday”."
        className="min-h-[72px] resize-none border-0 shadow-none focus:ring-0"
        maxLength={maxChars + 500}
        disabled={disabled}
        aria-invalid={over || undefined}
        data-testid="agent-composer"
      />
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <VoiceInput onTranscript={append} disabled={disabled || sending} />
        <div className="ml-auto flex items-center gap-3">
          <span className={cn("text-xs tabular-nums text-muted-foreground", over && "text-danger")} aria-live="polite">
            {length}/{maxChars}
          </span>
          <Button size="sm" onClick={onSend} disabled={!canSend} loading={sending} data-testid="agent-send">
            <SendHorizontal className="h-4 w-4" aria-hidden />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
