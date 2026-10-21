"use client";

import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";

export interface TypedConfirmOptions {
  title: string;
  /** Consequences first, in plain words ("Finalizing locks this run. Payslips will be generated…"). */
  message: ReactNode;
  /** Optional bullet list of what will happen. */
  consequences?: ReactNode[];
  /** The text to type, e.g. the run label "Nov 2026 · Staff Monthly". Compared exactly, ignoring outer spaces. */
  confirmText: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
}

export interface TypedConfirmModalProps extends TypedConfirmOptions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs on confirm; the modal stays open (busy) until it settles, and closes on success. */
  onConfirm: () => void | Promise<void>;
}

/** Irreversible actions (3.8 §6): the person types the label to confirm. */
export function TypedConfirmModal({ open, onOpenChange, title, message, consequences, confirmText, confirmLabel = "Confirm", tone = "danger", onConfirm }: TypedConfirmModalProps) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);
  const matches = typed.trim() === confirmText.trim();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!matches || busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // The caller reports the error (toast); the modal stays open so the person can retry.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={title}
      size="md"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={id} variant={tone === "danger" ? "danger" : "primary"} disabled={!matches} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id={id} onSubmit={submit} className="space-y-4">
        <div className="flex gap-3 rounded-2xl bg-warning-soft p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="space-y-2 text-foreground">
            <div>{message}</div>
            {consequences && consequences.length > 0 && (
              <ul className="list-disc space-y-1 ps-5">
                {consequences.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <Field
          label={`Type “${confirmText}” to confirm`}
          hint={typed && !matches ? "The text doesn't match yet." : undefined}
        >
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} autoFocus />
        </Field>
      </form>
    </Modal>
  );
}

/**
 * Promise API like `useConfirm`, without a provider: render `modal` once and
 * `if (!(await confirmTyped({...}))) return;`. A second request while one is open cancels the first
 * (its promise resolves `false`, so it never hangs).
 */
export function useTypedConfirm(): { confirmTyped: (options: TypedConfirmOptions) => Promise<boolean>; modal: ReactNode } {
  const [options, setOptions] = useState<TypedConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const confirmTyped = useCallback((next: TypedConfirmOptions) => {
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOptions(next);
    });
  }, []);
  const settle = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
  };
  const modal = options ? (
    <TypedConfirmModal
      {...options}
      open={!!options}
      onOpenChange={(o) => {
        if (!o) {
          settle(false);
          setOptions(null);
        }
      }}
      onConfirm={() => {
        settle(true);
      }}
    />
  ) : null;
  return { confirmTyped, modal };
}
