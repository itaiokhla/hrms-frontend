"use client";

import { ShieldCheck } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { ApiError, errorMessage } from "@/lib/api";
import { setStepUpHandler, stepUpApi, withStepUp, type StepUpStatus } from "@/lib/payroll/api";

export interface StepUpAuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after POST /api/v1/payroll/step-up answered 200. */
  onVerified: () => void;
  /** Why this is needed ("Releasing a payment batch needs you to confirm it's you."). */
  reason?: string;
}

type Method = "TOTP" | "EMAIL_OTP";

/**
 * Step-up re-authentication (3.7 §3.2) before release, bank changes and unmasking: a code from the
 * authenticator app, or — for people without MFA — a code e-mailed on request. Resolves only when
 * the backend confirmed the code.
 */
export function StepUpAuthModal({ open, onOpenChange, onVerified, reason }: StepUpAuthModalProps) {
  const id = useId();
  const [method, setMethod] = useState<Method | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setCode("");
      setError(null);
      setSent(null);
      return;
    }
    let live = true;
    setLoading(true);
    stepUpApi
      .status()
      .then((s: StepUpStatus) => {
        if (!live) return;
        setMethod(s.available_methods.includes("TOTP") ? "TOTP" : "EMAIL_OTP");
      })
      .catch(() => live && setMethod("TOTP"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [open]);

  const sendEmail = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await stepUpApi.emailCode();
      setSent(res.expires_in_seconds);
    } catch (err) {
      if (err instanceof ApiError && err.code === "MFA_ENROLLED") setMethod("TOTP");
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = code.replace(/\s+/g, "");
    if (value.length < 6) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await stepUpApi.verify(value);
      setCode("");
      onVerified();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const email = method === "EMAIL_OTP";
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title="Confirm it's you"
      description={reason ?? "This action needs a fresh confirmation of your identity."}
      size="sm"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={id} loading={busy} disabled={loading || (email && sent === null)}>
            Confirm
          </Button>
        </>
      }
    >
      <form id={id} onSubmit={submit} className="space-y-4">
        <div className="flex items-start gap-3 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <p>
            {email
              ? "We'll e-mail you a one-time code. It works only in this browser session."
              : "Enter the 6-digit code from your authenticator app."}
          </p>
        </div>
        {email && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" className="min-h-[44px]" loading={sending} onClick={sendEmail}>
              {sent === null ? "E-mail me a code" : "Send a new code"}
            </Button>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {sent !== null && `Code sent. It expires in ${Math.max(1, Math.round(sent / 60))} min.`}
            </p>
          </div>
        )}
        {(!email || sent !== null) && (
          <Field label={email ? "Code from the e-mail" : "Authenticator code"} error={error ?? undefined}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, "").slice(0, 10))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="font-mono tracking-[0.3em]"
              autoFocus
            />
          </Field>
        )}
        {email && sent === null && error && (
          <p role="alert" className="text-xs font-medium text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ provider */

interface StepUpContextValue {
  /** Ask the person to step up; resolves true once verified, false if they cancel. */
  requestStepUp: (reason?: string) => Promise<boolean>;
  /** Run a request; on STEP_UP_REQUIRED ask, then retry once. */
  withStepUp: <T>(fn: () => Promise<T>) => Promise<T>;
}

const StepUpContext = createContext<StepUpContextValue>({
  requestStepUp: async () => false,
  withStepUp: (fn) => fn(),
});

/**
 * Mount once around payroll pages. It registers itself with `@/lib/payroll/api`, so every request
 * made through `payrollApi` that fails with 403 STEP_UP_REQUIRED opens this modal and is retried
 * after verification. Concurrent requests share one prompt.
 */
export function StepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | undefined>();
  const pending = useRef<{ promise: Promise<boolean>; resolve: (v: boolean) => void } | null>(null);

  const requestStepUp = useCallback((why?: string) => {
    if (pending.current) return pending.current.promise;
    let resolve!: (v: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolve = r));
    pending.current = { promise, resolve };
    setReason(why);
    setOpen(true);
    return promise;
  }, []);

  const settle = (value: boolean) => {
    pending.current?.resolve(value);
    pending.current = null;
    setOpen(false);
  };

  useEffect(() => setStepUpHandler(requestStepUp), [requestStepUp]);
  useEffect(() => () => pending.current?.resolve(false), []);

  return (
    <StepUpContext.Provider value={{ requestStepUp, withStepUp }}>
      {children}
      <StepUpAuthModal open={open} onOpenChange={(o) => !o && settle(false)} onVerified={() => settle(true)} reason={reason} />
    </StepUpContext.Provider>
  );
}

export const useStepUp = () => useContext(StepUpContext);
