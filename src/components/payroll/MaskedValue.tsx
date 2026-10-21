"use client";

import { Eye, EyeOff } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

export const REVEAL_SECONDS = 30;

export interface MaskedValueProps {
  /** The masked form from the server, e.g. "••••4321". The full value is never sent until revealed. */
  masked: string;
  /** What is hidden, for labels: "account number", "IBAN". */
  label?: string;
  /**
   * Reveal with a reason (audited server-side, needs e.g. payroll:bank_details:read_full); resolves
   * with the full value. Omit when the viewer may not reveal: no button is shown.
   */
  onReveal?: (reason: string) => Promise<string>;
  /** Seconds before the value hides again (default 30). */
  autoHideSeconds?: number;
  className?: string;
}

/**
 * A masked value (3.8 §7, §6 "Reveal bank details"): masked by default; Reveal asks for a reason,
 * shows the value for 30 seconds with a countdown, then hides it again. The full value lives only
 * in component state (never storage) and is dropped on hide or unmount.
 */
export function MaskedValue({ masked, label = "value", onReveal, autoHideSeconds = REVEAL_SECONDS, className }: MaskedValueProps) {
  const [full, setFull] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>();
  const formId = `${useId()}-reveal`;

  const hide = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = undefined;
    setFull(null);
    setLeft(0);
  };
  useEffect(() => () => timer.current && clearInterval(timer.current), []);
  useEffect(() => {
    if (full !== null && left <= 0) hide();
  }, [full, left]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!onReveal) return;
    if (!reason.trim()) {
      setError("Enter why you need to see it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const value = await onReveal(reason.trim());
      setFull(value);
      setLeft(autoHideSeconds);
      setAsking(false);
      setReason("");
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
      <bdi dir="ltr" className="font-mono tabular-nums" aria-label={full ? `${label}: ${full}` : `${label}, masked: ${masked}`}>
        {full ?? masked}
      </bdi>
      {full ? (
        <>
          <span className="text-xs text-muted-foreground" aria-live="off">
            Hides in {left} s
          </span>
          <Button variant="ghost" size="sm" className="h-11 sm:h-8" onClick={hide}>
            <EyeOff className="h-3.5 w-3.5" aria-hidden />
            Hide
          </Button>
        </>
      ) : (
        onReveal && (
          <Button variant="ghost" size="sm" className="h-11 sm:h-8" onClick={() => setAsking(true)}>
            <Eye className="h-3.5 w-3.5" aria-hidden />
            Reveal<span className="sr-only"> {label}</span>
          </Button>
        )
      )}
      <Modal
        open={asking}
        onOpenChange={(o) => {
          setAsking(o);
          if (!o) setError(null);
        }}
        title={`Reveal ${label}?`}
        description={`Revealing is recorded in the audit log with your reason. It hides again after ${autoHideSeconds} seconds.`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={busy}>
              Reveal
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={submit}>
          <Field label="Reason" required error={error ?? undefined}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="For example: verifying a failed payment" />
          </Field>
        </form>
      </Modal>
    </span>
  );
}
