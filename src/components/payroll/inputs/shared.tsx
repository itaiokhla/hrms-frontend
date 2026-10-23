"use client";

import { AlertTriangle, CheckCircle2, Circle, CircleDot, Info, RefreshCw, SearchX, XCircle } from "lucide-react";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { useCan } from "@/components/access/Can";
import { HideAmountsToggle } from "@/components/payroll/MoneyText";
import { StepUpProvider } from "@/components/payroll/StepUpAuthModal";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card, Skeleton } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { VOCABULARIES } from "@/lib/payroll/catalogues.generated";
import { formatDecimalHours, type StatusTone } from "@/lib/payroll/labels";
import { isConflict, type PayrollApiError } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { lookupsApi } from "./api";
import type { EmployeeOption } from "./types";

/* ------------------------------------------------------------------ page shell (F-23, F-24) */

/**
 * Every page of this area: the step-up provider (F-24; payroll requests that need MFA prompt here),
 * a Suspense boundary for `useSearchParams`/`useModalRoute` (F-23; ConfirmProvider is global in
 * `app/providers.tsx`), and a skeleton while the client boundary resolves.
 */
export function PayrollPage({ children }: { children: ReactNode }) {
  return (
    <StepUpProvider>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </StepUpProvider>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-5 w-96 max-w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/** Workspace header: title, one primary action, and the "Hide amounts" toggle (3.8 §3.2, F-24). */
export function WorkspaceHeader({
  eyebrow = "Payroll",
  title,
  description,
  actions,
  showHideAmounts = true,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  showHideAmounts?: boolean;
}) {
  return (
    <PageHeader
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={
        <>
          {showHideAmounts && <HideAmountsToggle />}
          {actions}
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ statuses outside the generated vocabularies */

interface LocalStatus {
  label: string;
  tone: StatusTone;
  glossary?: string;
}

/**
 * Status vocabularies without a backend state machine (overtime entries, approval requests,
 * wage-input imports, loan actions), generated into `catalogues.generated.ts` (F-22). Same look as
 * `StatusChip`; unknown codes are neutral, never success.
 */
export const LOCAL_VOCABULARIES: Record<string, Record<string, LocalStatus>> = {
  overtime: VOCABULARIES.overtime_entry.states,
  approval: VOCABULARIES.approval_request.states,
  import: VOCABULARIES.wage_input_import.states,
  loan_action: VOCABULARIES.loan_action.states,
  // app/models/corrections.py ARREARS_STATUSES (no generated vocabulary): "settled" means a finalized pay
  // run included the difference, never that money reached the bank.
  arrears: {
    PENDING_APPROVAL: { label: "Awaiting approval", tone: "warning" },
    APPROVED: { label: "Approved", tone: "primary", glossary: "Waiting to be paid by the next regular run or a retro run." },
    SETTLED: { label: "Settled in a run", tone: "success", glossary: "A finalized pay run included the difference." },
    REJECTED: { label: "Rejected", tone: "danger" },
    CANCELLED: { label: "Cancelled", tone: "neutral" },
    SUPERSEDED: { label: "Replaced", tone: "neutral", glossary: "A newer proposal for the same period replaced this one." },
  },
};

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary-soft text-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};
const TONE_ICON = { neutral: Circle, primary: CircleDot, success: CheckCircle2, warning: AlertTriangle, danger: XCircle, info: Info };

function humanize(code: string): string {
  const text = code.replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : "—";
}

export function localStatus(vocabulary: string, code: string | null | undefined): LocalStatus & { code: string } {
  const value = code ?? "";
  return { ...(LOCAL_VOCABULARIES[vocabulary]?.[value] ?? { label: humanize(value), tone: "neutral" as StatusTone }), code: value };
}

export function LocalStatusChip({ vocabulary, code, className }: { vocabulary: string; code: string | null | undefined; className?: string }) {
  const entry = localStatus(vocabulary, code);
  const Icon = TONE_ICON[entry.tone];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", TONE_CLASS[entry.tone], className)}
      data-tone={entry.tone}
      data-status={entry.code}
      title={entry.glossary || undefined}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {entry.label}
    </span>
  );
}

/* ------------------------------------------------------------------ refusal codes */

export interface ErrorWording {
  title: string;
  /** Plain-language explanation; without it the server's own message is shown under the title. */
  text?: string;
}

const SIGNATORY: ErrorWording = {
  title: "Not a signatory of the funding account",
  text: "Only a signatory of the funding account can release this batch. Ask a signatory, or an admin to add you as one.",
};

/**
 * Specific payment and run refusals, worded once for every payroll area (3.7 EC-PAY-20, funding
 * signatories, reversals, value dates, finalized runs, step-up, payslip queries). Any other code keeps the
 * generic conflict wording with the server's message.
 */
export const PAYROLL_ERROR_WORDING: Record<string, ErrorWording> = {
  FX_QUOTE_EXPIRED: {
    title: "Exchange-rate quote expired",
    text: "An exchange-rate quote in this batch expired. Cancel the batch: the payments are re-quoted on the next proposal and approved again. Nothing is paid at the old rate.",
  },
  FX_RATE_MISSING: {
    title: "No exchange rate available",
    text: "No usable exchange rate exists for the account currency, so the payment is held until one does.",
  },
  FUNDING_SIGNATORY: SIGNATORY,
  NOT_A_SIGNATORY: SIGNATORY,
  BATCH_CANCELLED: {
    title: "Payment batch cancelled",
    text: "This batch was cancelled, so its file is no longer available and it can't be submitted. Reload to see its current state.",
  },
  REVERSAL_HOLD: {
    title: "Held by a run reversal",
    text: "An approved run reversal holds this payment. It is cancelled when the reversal is finalized and can't be released by hand.",
  },
  VALUE_DATE_IN_PAST: {
    title: "Value date is in the past",
    text: "Choose today or a later business day as the value date.",
  },
  RUN_FINALIZED: {
    title: "Pay run already finalized",
    text: "This pay run is finalized, so it can't be changed. Correct it with arrears, an off-cycle run or a reversal.",
  },
  // The server's message says which object changed; it stays under the familiar title.
  ROW_VERSION_CONFLICT: { title: "Someone else changed this" },
  STEP_UP_REQUIRED: {
    title: "Confirm it's you",
    text: "This action needs a fresh sign-in check. Try again and complete the verification when asked.",
  },
  QUERIES_DISABLED: {
    title: "Payslip queries are turned off",
    text: "Your company doesn't take payslip questions here. Contact your HR or payroll team directly.",
  },
};

/** The machine code of an API error (`code` on the error, or inside a structured `detail`). */
export function payrollErrorCode(error: unknown): string | null {
  const e = error as { code?: unknown; detail?: { code?: unknown }; data?: { code?: unknown } } | null;
  const code = e?.code ?? e?.detail?.code ?? e?.data?.code;
  return typeof code === "string" ? code : null;
}

/** The specific wording for an error's code, or null for codes without one. */
export function errorWording(error: unknown): ErrorWording | null {
  if (!error) return null;
  const code = payrollErrorCode(error);
  return code && Object.prototype.hasOwnProperty.call(PAYROLL_ERROR_WORDING, code) ? PAYROLL_ERROR_WORDING[code] : null;
}

/* ------------------------------------------------------------------ honest banners */

/**
 * 409 / 412 with a one-click reload (EC-UX-04). Never overwrite silently. Known refusal codes
 * (expired FX quote, finalized run, cancelled batch…) get their own title and explanation; anything
 * else reads "Someone else changed this" with the server's message.
 */
export function ConflictBanner({ error, onReload, className }: { error: unknown; onReload?: () => void; className?: string }) {
  if (!isConflict(error)) return null;
  const wording = errorWording(error);
  const code = payrollErrorCode(error);
  return (
    <div
      role="alert"
      data-code={code ?? undefined}
      className={cn("flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm", className)}
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{wording?.title ?? "Someone else changed this"}</p>
        <p className="text-muted-foreground">{wording?.text ?? (error as ApiError).message}</p>
      </div>
      {onReload && (
        <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={onReload}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Reload
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "danger"; title: ReactNode; children?: ReactNode; className?: string }) {
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      className={cn(
        "flex gap-3 rounded-xl border px-4 py-3 text-sm",
        tone === "info" && "border-info/30 bg-info-soft",
        tone === "warning" && "border-warning/40 bg-warning-soft",
        tone === "danger" && "border-danger/40 bg-danger-soft",
        className,
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "info" ? "text-info" : tone === "warning" ? "text-warning" : "text-danger")} aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-0.5 text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

/** Forbidden objects show as not found (EC-UX-02): a 403 never reveals that the object exists. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || (error.status === 403 && error.code !== "STEP_UP_REQUIRED"));
}

export function NotFoundState({ what, backHref, backLabel }: { what: string; backHref: string; backLabel: string }) {
  return (
    <Card className="mx-auto mt-6 max-w-lg">
      <EmptyState
        icon={<SearchX />}
        title={`${what} not found`}
        description="It may have been removed, or it is outside the people and entities you can see."
        action={
          <Link href={backHref} className="inline-flex min-h-[44px] items-center rounded-xl border border-border px-4 text-sm font-medium hover:bg-surface-muted">
            {backLabel}
          </Link>
        }
      />
    </Card>
  );
}

/** Loading → skeleton, not found → NotFoundState, error → ErrorState with Retry. */
export function DetailGate({
  loading,
  error,
  hasData,
  onRetry,
  what,
  backHref,
  backLabel,
  children,
}: {
  loading: boolean;
  error: unknown;
  hasData: boolean;
  onRetry: () => void;
  what: string;
  backHref: string;
  backLabel: string;
  children: ReactNode;
}) {
  if (error && isNotFound(error)) return <NotFoundState what={what} backHref={backHref} backLabel={backLabel} />;
  if (error && !hasData) return <ErrorState message={(error as ApiError).message ?? "Something went wrong."} onRetry={onRetry} />;
  if (loading && !hasData) return <PageSkeleton />;
  return <>{children}</>;
}

/* ------------------------------------------------------------------ errors */

/** Map 422 field errors (`{field, msg}`) to a record; nested names keep their last part ("amount.amount" → "amount"). */
export function fieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const fields = error instanceof ApiError ? error.fields ?? [] : [];
  fields.forEach((f) => {
    const parts = String(f.field || "").split(".").filter((p) => p && p !== "body");
    const key = parts[0] ?? "form";
    if (!out[key]) out[key] = f.msg;
  });
  return out;
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Something went wrong. Please try again.";
}

/**
 * Inline errors plus a summary at the top of the form (3.8 §8). Conflicts have their own banner;
 * other known refusal codes (not a signatory, value date in the past, step-up…) use the shared wording.
 */
export function ErrorSummary({ error, fields }: { error: unknown; fields?: Record<string, string> }) {
  if (isConflict(error)) return null;
  const list = Object.entries(fields ?? {}).filter(([, m]) => !!m);
  if (!error && !list.length) return null;
  const wording = list.length ? null : errorWording(error);
  return (
    <div role="alert" className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm">
      <p className="font-medium text-danger">{list.length ? "Some fields need attention." : wording ? wording.title : errorText(error)}</p>
      {wording && <p className="mt-0.5 text-muted-foreground">{wording.text ?? errorText(error)}</p>}
      {list.length > 0 && (
        <ul className="mt-1 list-disc ps-5 text-muted-foreground">
          {list.map(([k, m]) => (
            <li key={k}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ approve / reject */

export interface DecisionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  decision: "approve" | "reject";
  /** What is being decided (one line), e.g. "Bonus for Asha Rao · Nov 2026". */
  subject: ReactNode;
  /** Summary shown above the comment (amount, flags to acknowledge…). */
  summary?: ReactNode;
  /** Extra controls (approved minutes, accepted quantity…). */
  extra?: ReactNode;
  /** Flags the approver must acknowledge before approving. */
  acknowledge?: string[];
  onSubmit: (remarks: string) => Promise<void>;
  onReload?: () => void;
}

/** Approve / reject (3.8 §6): summary, flags acknowledged, comment; reject requires a reason. */
export function DecisionModal({ open, onOpenChange, decision, subject, summary, extra, acknowledge = [], onSubmit, onReload }: DecisionModalProps) {
  const [remarks, setRemarks] = useState("");
  const [acked, setAcked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reasonError, setReasonError] = useState<string | undefined>();

  useEffect(() => {
    if (open) {
      setRemarks("");
      setAcked(false);
      setError(null);
      setReasonError(undefined);
    }
  }, [open, decision]);

  const reject = decision === "reject";
  const needsAck = !reject && acknowledge.length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reject && !remarks.trim()) {
      setReasonError("Give a reason for the rejection. The requester will see it.");
      return;
    }
    if (needsAck && !acked) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(remarks.trim());
      onOpenChange(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const formId = `decision-${decision}`;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={reject ? "Reject" : "Approve"}
      description={subject}
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={reject ? "secondary" : "primary"}
            className={cn("min-h-[44px]", reject && "text-danger")}
            loading={busy}
            disabled={needsAck && !acked}
          >
            {reject ? "Reject" : "Approve"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
        <ConflictBanner error={error} onReload={onReload ? () => { onOpenChange(false); onReload(); } : undefined} />
        <ErrorSummary error={error} fields={fieldErrors(error)} />
        {summary}
        {needsAck && (
          <div className="rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm">
            <p className="font-medium">Check these before approving</p>
            <ul className="mt-1 list-disc ps-5 text-muted-foreground">
              {acknowledge.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
            <label className="mt-2 flex min-h-[44px] items-center gap-2">
              <input type="checkbox" className="h-4 w-4" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
              I have checked these
            </label>
          </div>
        )}
        {extra}
        <Field label={reject ? "Reason" : "Comment (optional)"} required={reject} error={reasonError} hint={reject ? "Shown to the requester." : undefined}>
          <Textarea
            value={remarks}
            maxLength={1000}
            rows={3}
            onChange={(e) => {
              setRemarks(e.target.value);
              if (reasonError) setReasonError(undefined);
            }}
          />
        </Field>
      </form>
    </Modal>
  );
}

/** A required reason for cancel / pause / dispute actions, with the consequence stated first. */
export function ReasonModal({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  reasonLabel = "Reason",
  optional = false,
  danger = false,
  children,
  onSubmit,
  onReload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  consequence: ReactNode;
  confirmLabel: string;
  reasonLabel?: string;
  optional?: boolean;
  danger?: boolean;
  children?: ReactNode;
  onSubmit: (reason: string) => Promise<void>;
  onReload?: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reasonError, setReasonError] = useState<string | undefined>();
  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
      setReasonError(undefined);
    }
  }, [open]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!optional && !reason.trim()) {
      setReasonError("Give a reason. It is kept in the audit trail.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
      onOpenChange(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const formId = `reason-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={title}
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Keep as is
          </Button>
          <Button type="submit" form={formId} variant={danger ? "secondary" : "primary"} className={cn("min-h-[44px]", danger && "text-danger")} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm">{consequence}</p>
        <ConflictBanner error={error} onReload={onReload ? () => { onOpenChange(false); onReload(); } : undefined} />
        <ErrorSummary error={error} fields={fieldErrors(error)} />
        {children}
        <Field label={optional ? `${reasonLabel} (optional)` : reasonLabel} required={!optional} error={reasonError}>
          <Textarea rows={3} maxLength={1000} value={reason} onChange={(e) => { setReason(e.target.value); setReasonError(undefined); }} />
        </Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ employees */

/**
 * Names for employee ids shown in lists that only carry `employee_id` (wage inputs, loans, claims).
 * Needs `employee:read`; without it the id is shown ("Employee #142") rather than a guess.
 */
export function useEmployeeDirectory(): { name: (id: number | null | undefined) => string; options: EmployeeOption[] } {
  const { me } = useCan();
  const allowed = can(me, P.EMPLOYEE_READ);
  const [items, setItems] = useState<EmployeeOption[]>([]);
  useEffect(() => {
    if (!allowed) return;
    let live = true;
    lookupsApi
      .employees("", 200)
      .then((page) => live && setItems(page.items ?? []))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [allowed]);
  const map = useMemo(() => new Map(items.map((e) => [e.id, e])), [items]);
  return {
    options: items,
    name: (id) => {
      if (id === null || id === undefined) return "—";
      const e = map.get(id);
      return e ? e.full_name : `Employee #${id}`;
    },
  };
}

/** Employee picker: search by name or code with `employee:read`, else the numeric employee id. */
export function EmployeeField({
  value,
  onChange,
  error,
  label = "Employee",
  required = true,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  error?: string;
  label?: string;
  required?: boolean;
}) {
  const { me } = useCan();
  const searchable = can(me, P.EMPLOYEE_READ);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<EmployeeOption[]>([]);

  useEffect(() => {
    if (!searchable) return;
    let live = true;
    const t = setTimeout(() => {
      lookupsApi
        .employees(q, 20)
        .then((page) => live && setResults(page.items ?? []))
        .catch(() => live && setResults([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, searchable]);

  if (!searchable) {
    return (
      <Field label={`${label} ID`} required={required} error={error} hint="Your role can't search employees; enter the employee's ID.">
        <Input
          inputMode="numeric"
          value={value ?? ""}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            onChange(Number.isFinite(n) && n > 0 ? n : null);
          }}
        />
      </Field>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label={`Find ${label.toLowerCase()}`} hint="Name or employee code">
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </Field>
      <Field label={label} required={required} error={error}>
        <Select value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Choose…</option>
          {value !== null && !results.some((r) => r.id === value) && <option value={value}>Employee #{value}</option>}
          {results.map((r) => (
            <option key={r.id} value={r.id}>
              {r.full_name} ({r.employee_code})
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ formatting */

/** Overtime minutes as payroll hours ("7.75 h", tooltip "7 h 45 m"). */
export function Hours({ minutes }: { minutes: number | null | undefined }) {
  if (minutes === null || minutes === undefined) return <span className="text-muted-foreground">—</span>;
  const h = formatDecimalHours(minutes / 60);
  return (
    <span className="tabular-nums" title={h.title}>
      <bdi dir="ltr">{h.text}</bdi>
    </span>
  );
}

/** Decimal strings (quantities, percentages) shown left-to-right with tabular figures; never converted to Number. */
export function Decimal({ value, suffix }: { value: string | null | undefined; suffix?: string }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">—</span>;
  const trimmed = value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
  return (
    <span className="tabular-nums">
      <bdi dir="ltr">{trimmed}</bdi>
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

export const linkButton =
  "inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium shadow-sm transition-colors hover:bg-surface-muted";

/** Filter bar container: wraps on small screens, 44px controls. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-end gap-3 border-b border-border p-4 [&_input]:min-h-[44px] [&_select]:min-h-[44px]", className)}>{children}</div>;
}

export function isPayrollApiError(error: unknown): error is PayrollApiError {
  return error instanceof ApiError;
}
