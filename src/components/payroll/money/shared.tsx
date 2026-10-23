"use client";

import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Circle, CircleDot, FlaskConical, Info, XCircle } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { useCan } from "@/components/access/Can";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { canAny, can } from "@/lib/access";
import type { StatusTone } from "@/lib/payroll/labels";
import { P } from "@/lib/permissions.generated";

import { ConflictBanner, Notice, PAYROLL_ERROR_WORDING, errorText, errorWording, payrollErrorCode } from "@/components/payroll/inputs/shared";
import { isConflict } from "@/lib/payroll/api";

import { fundingApi, moneyLookups } from "./api";
import type { FundingAccountOption, FundingChoice, LegalEntityOption, UserOption } from "./types";

// Page shell, banners, gates and modals shared with the other payroll areas (committed in eae8c2a).
export {
  ConflictBanner,
  DetailGate,
  ErrorSummary,
  FilterBar,
  Notice,
  PayrollPage,
  PageSkeleton,
  ReasonModal,
  WorkspaceHeader,
  errorText,
  fieldErrors,
  isNotFound,
  linkButton,
  useEmployeeDirectory,
} from "@/components/payroll/inputs/shared";

/* ------------------------------------------------------------------ statuses without a generated vocabulary */

interface LocalStatus {
  label: string;
  tone: StatusTone;
  glossary?: string;
}

/**
 * Bank change requests (CHANGE_STATUSES in app/models/payments.py) and reconciliation match
 * statuses (app/payroll/services/reconciliation.py QUEUES) have no state machine in
 * `catalogues.generated.ts`; same look as StatusChip, unknown codes neutral (never success).
 */
export const LOCAL_STATUSES: Record<"change" | "match", Record<string, LocalStatus>> = {
  change: {
    SECURITY_REVIEW: { label: "Security review", tone: "danger", glossary: "Held by the velocity limit: a second person releases or rejects it before approval." },
    PENDING_APPROVAL: { label: "Awaiting approval", tone: "warning" },
    APPLIED: { label: "Applied", tone: "success" },
    REJECTED: { label: "Rejected", tone: "danger" },
    CANCELLED: { label: "Withdrawn", tone: "neutral" },
  },
  match: {
    MATCHED: { label: "Matched", tone: "success", glossary: "The bank line settles the payment exactly." },
    LINKED: { label: "Linked", tone: "success", glossary: "Linked to a payment by a person, with a reason." },
    ACCEPTED_VARIANCE: { label: "Accepted difference", tone: "success", glossary: "An amount difference accepted with a reason." },
    RETURN: { label: "Returned", tone: "danger", glossary: "The bank returned the payment." },
    MISMATCH: { label: "Amount differs", tone: "warning", glossary: "The line matches a payment but the amount differs." },
    UNMATCHED: { label: "Unmatched", tone: "warning", glossary: "No payment matches this line." },
    DUPLICATE: { label: "Possible duplicate", tone: "warning", glossary: "This line may settle a payment twice." },
    ESCALATED: { label: "Escalated", tone: "info" },
    IGNORED: { label: "Ignored", tone: "neutral" },
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

export function humanize(code: string | null | undefined): string {
  const text = (code ?? "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : "—";
}

export function LocalChip({ vocabulary, code, className }: { vocabulary: keyof typeof LOCAL_STATUSES; code: string | null | undefined; className?: string }) {
  const value = code ?? "";
  const entry = LOCAL_STATUSES[vocabulary][value] ?? { label: humanize(value), tone: "neutral" as StatusTone };
  const Icon = TONE_ICON[entry.tone];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", TONE_CLASS[entry.tone], className)}
      data-tone={entry.tone}
      data-status={value}
      title={entry.glossary || undefined}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {entry.label}
    </span>
  );
}

/** "SANDBOX" label: simulated adapters say so everywhere (3.7; no money moved). */
export function SandboxBadge({ title = "Simulated: no money moved and no bank or provider was contacted", className }: { title?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-warning/50 bg-warning-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning", className)} title={title}>
      <FlaskConical className="h-3 w-3" aria-hidden />
      Sandbox
    </span>
  );
}

/** Honest wording for a manual submission: never "Paid" without settlement evidence. */
export const MANUAL_UNVERIFIED = "Submitted for manual payment — unverified";

export function isManualChannel(channel: string | null | undefined): boolean {
  return channel === "MANUAL_UPLOAD" || channel === "MANUAL_OFFLINE";
}

/** A line under a status chip saying what the evidence really is. */
export function EvidenceNote({ channel, evidence, status }: { channel: string | null | undefined; evidence: string | null | undefined; status: string }) {
  if (!channel) return null;
  if (channel === "SANDBOX") return <SandboxBadge />;
  if (isManualChannel(channel) && evidence !== "VERIFIED" && ["SUBMITTED", "ACKNOWLEDGED", "PROCESSING", "PARTIALLY_SETTLED", "SETTLED"].includes(status)) {
    return <span className="block text-xs text-warning">{MANUAL_UNVERIFIED}</span>;
  }
  return null;
}

/* ------------------------------------------------------------------ value date (EC-PAY-10) */

export const VALUE_DATE_WARNINGS: Record<string, string> = {
  VALUE_DATE_SHIFTED: "The date falls on a weekend or bank holiday, so it moved to the next business day.",
  VALUE_DATE_AFTER_PAY_DATE: "The money arrives after the pay date. Tell the employees, or choose an earlier date if the bank allows it.",
};

/** Value-date warnings from the server (never computed here). Nothing when there are none. */
export function ValueDateNotice({ warnings, valueDate, requested }: { warnings: string[] | null | undefined; valueDate?: string | null; requested?: string | null }) {
  const list = (warnings ?? []).filter(Boolean);
  if (!list.length) return null;
  const late = list.includes("VALUE_DATE_AFTER_PAY_DATE");
  const moved = requested && valueDate && requested !== valueDate ? ` (${fmtDate(requested)} → ${fmtDate(valueDate)})` : valueDate ? ` (${fmtDate(valueDate)})` : "";
  return (
    <Notice tone="warning" title={late ? `Value date is after the pay date${moved}` : `Value date moved${moved}`}>
      <ul className="mt-1 list-disc ps-5">
        {list.map((w) => (
          <li key={w}>{VALUE_DATE_WARNINGS[w] ?? humanize(w)}</li>
        ))}
      </ul>
    </Notice>
  );
}

/* ------------------------------------------------------------------ release / FX errors */

/**
 * Codes of release and approval refusals, worded for the person (3.7 EC-PAY-20, funding signatories).
 * The wording lives once in the shared PAYROLL_ERROR_WORDING (used by ConflictBanner in every area).
 */
export const PAYMENT_ERROR_TEXT: Record<string, string> = Object.fromEntries(
  (["FX_QUOTE_EXPIRED", "FUNDING_SIGNATORY", "NOT_A_SIGNATORY", "FX_RATE_MISSING"] as const).map((code) => [code, PAYROLL_ERROR_WORDING[code].text ?? ""]),
);

export const paymentErrorCode = payrollErrorCode;

/**
 * Error banner for payment actions: known refusals (expired FX quote, not a signatory, cancelled batch,
 * reversal hold, value date in the past…) in plain words whatever their status, other 409s as the shared
 * conflict banner, anything else as an inline error.
 */
export function PaymentErrorBanner({ error, onReload }: { error: unknown; onReload?: () => void }) {
  if (!error) return null;
  const wording = errorWording(error);
  if (wording?.text) {
    return (
      <Notice tone="danger" title={wording.title}>
        {wording.text}
      </Notice>
    );
  }
  if (isConflict(error)) return <ConflictBanner error={error} onReload={onReload} />;
  return (
    <p role="alert" className="text-sm text-danger">
      {errorText(error)}
    </p>
  );
}

/** Instruction hold reasons that need a sentence, not a code. */
export const STATUS_REASON_TEXT: Record<string, string> = {
  FX_RATE_MISSING: "Held: no usable exchange rate for the account currency (re-quoted automatically once a rate exists).",
  FX_QUOTE_EXPIRED: "Held: the exchange-rate quote expired; the payment is re-quoted on the next batch.",
};

/* ------------------------------------------------------------------ risk flags and reasons */

export const FLAG_LABELS: Record<string, string> = {
  DUPLICATE_ACCOUNT: "Same account as another payee",
  HOLDER_NAME_MISMATCH: "Holder name doesn't match",
  PAYMENT_RETURNED: "A payment was returned",
  NEW_DEVICE: "New browser or device",
  NEW_IP: "New network address",
  VELOCITY_LIMIT: "Too many changes in 90 days",
  HR_CHANGE: "Entered by HR",
};

export function flagLabel(code: string): string {
  return FLAG_LABELS[code] ?? humanize(code);
}

export const CHANNEL_LABELS: Record<string, string> = { SELF: "Employee (self-service)", HR: "HR, on the employee's behalf", BUREAU: "Payroll provider" };

export const METHOD_LABELS: Record<string, string> = {
  BANK_FILE: "Bank file",
  API: "Payout API",
  FORMAT: "Format check",
  DOCUMENT_REVIEW: "Document review",
  PENNY_DROP: "Penny drop",
  PROVIDER_NAME_MATCH: "Provider name match",
  MANUAL_REVIEW: "Manual review",
};

export const HOLD_REASONS: Record<string, string> = {
  DUPLICATE_FINGERPRINT: "Same account registered for another payee",
  PAYMENT_RETURNED: "A payment to this account was returned",
};

/* ------------------------------------------------------------------ countdown */

/** Remaining time until `until` ("2 d 4 h", "35 min"), ticking each minute; null once passed. */
export function useCountdown(until: string | null | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  const end = Date.parse(until.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(until) ? until : `${until}Z`);
  if (!Number.isFinite(end)) return null;
  const minutes = Math.ceil((end - now) / 60_000);
  if (minutes <= 0) return null;
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

/* ------------------------------------------------------------------ names (degrade to ids without the read permission) */

/** People's names for user ids (needs user:read); "You" for the viewer, else "User #id". */
export function useUserNames(): (id: number | null | undefined) => string {
  const { me } = useCan();
  const allowed = can(me, P.USER_READ);
  const { data } = useApi(() => moneyLookups.users(), [], { enabled: allowed });
  const map = useMemo(() => new Map((data?.items ?? []).map((u: UserOption) => [u.id, u.full_name || u.email])), [data]);
  const myId = me?.user.id;
  return useCallback(
    (id) => {
      if (id === null || id === undefined) return "—";
      if (id === myId) return "You";
      return map.get(id) ?? `User #${id}`;
    },
    [map, myId],
  );
}

export function useUsers(): { users: UserOption[]; allowed: boolean } {
  const { me } = useCan();
  const allowed = can(me, P.USER_READ);
  const { data } = useApi(() => moneyLookups.users(), [], { enabled: allowed });
  return { users: data?.items ?? [], allowed };
}

/** Legal entities (org:read or org:manage_entities); names fall back to "Entity #id". */
export function useEntities(): { entities: LegalEntityOption[]; name: (id: number | null | undefined) => string; allowed: boolean } {
  const { me } = useCan();
  const allowed = canAny(me, [P.ORG_READ, P.ORG_MANAGE_ENTITIES]);
  const { data } = useApi(() => moneyLookups.entities(), [], { enabled: allowed });
  const entities = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const map = useMemo(() => new Map(entities.map((e) => [e.id, e.trade_name || e.legal_name])), [entities]);
  return { entities, allowed, name: (id) => (id === null || id === undefined ? "—" : map.get(id) ?? `Entity #${id}`) };
}

/** Who may read the masked funding-account options (services/funding_accounts.py OPTION_PERMISSIONS). */
export const FUNDING_OPTION_PERMS = [
  P.PAYROLL_PAYMENT_PREPARE,
  P.PAYROLL_PAYMENT_APPROVE,
  P.PAYROLL_PAYMENT_SUBMIT,
  P.PAYROLL_PAYMENT_RECONCILE,
  P.PAYROLL_FUNDING_ACCOUNTS_MANAGE,
];

export function fundingChoice(o: FundingAccountOption): FundingChoice {
  return {
    id: o.id,
    legal_entity_id: o.legal_entity.id,
    legal_entity_name: o.legal_entity.name,
    name: o.name,
    currency: o.currency,
    account_masked: o.account_masked,
    bank_name: o.bank_name,
    status: o.status,
    sandbox: o.sandbox,
    is_signatory: o.is_signatory,
  };
}

/**
 * Funding accounts the viewer's payment permissions cover, from the masked read-only options list
 * (GET /payroll/funding-accounts/options, inactive ones included so history keeps its names). Pickers
 * offer the active ones only. An account outside the viewer's scope stays "Funding account #id".
 */
export function useFundingAccounts(): {
  accounts: FundingChoice[];
  allowed: boolean;
  loading: boolean;
  label: (id: number | null | undefined) => string;
  byId: (id: number | null | undefined) => FundingChoice | undefined;
} {
  const { me } = useCan();
  const permitted = canAny(me, FUNDING_OPTION_PERMS);
  const { data, error, loading } = useApi(() => fundingApi.options({ include_inactive: true }), [], { enabled: permitted });
  // A refused or failed list degrades like no access: callers offer the ids they already know.
  const allowed = permitted && !(error && !data);
  const accounts = useMemo(() => (data?.items ?? []).map(fundingChoice), [data]);
  const map = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  return {
    accounts,
    allowed,
    loading: permitted && loading,
    byId: (id) => (id === null || id === undefined ? undefined : map.get(id)),
    label: (id) => {
      if (id === null || id === undefined) return "—";
      const a = map.get(id);
      return a ? `${a.name} · ${a.account_masked}` : `Funding account #${id}`;
    },
  };
}

/* ------------------------------------------------------------------ query-string tab */

export function useTab<T extends string>(allowed: readonly T[], fallback: T): [T, (t: T) => void] {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = search?.get("tab") as T | null;
  const tab = raw && allowed.includes(raw) ? raw : fallback;
  const setTab = useCallback(
    (t: T) => {
      const next = new URLSearchParams(search?.toString() ?? "");
      next.set("tab", t);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [search, router, pathname],
  );
  return [tab, setTab];
}

/* ------------------------------------------------------------------ payments sub-navigation */

export const PAYMENT_PERMS = [P.PAYROLL_PAYMENT_PREPARE, P.PAYROLL_PAYMENT_APPROVE, P.PAYROLL_PAYMENT_SUBMIT, P.PAYROLL_PAYMENT_RECONCILE];

/** Payout Files · Reconciliation · Funding accounts, each shown only to people who can use it. */
export function PaymentsNav() {
  const { me } = useCan();
  const pathname = usePathname() ?? "";
  const items = [
    { href: "/payroll/payments", label: "Payout files", show: canAny(me, PAYMENT_PERMS), active: pathname === "/payroll/payments" || pathname.startsWith("/payroll/payments/batches") || pathname.startsWith("/payroll/payments/instructions") || pathname === "/payroll/payments/new" },
    { href: "/payroll/payments/reconciliation", label: "Reconciliation", show: can(me, P.PAYROLL_PAYMENT_RECONCILE), active: pathname.startsWith("/payroll/payments/reconciliation") },
    { href: "/payroll/payments/funding-accounts", label: "Funding accounts", show: can(me, P.PAYROLL_FUNDING_ACCOUNTS_MANAGE), active: pathname.startsWith("/payroll/payments/funding-accounts") },
  ].filter((i) => i.show);
  if (items.length < 2) return null;
  return (
    <nav aria-label="Payments sections" className="mb-5 flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "relative inline-flex min-h-[44px] items-center whitespace-nowrap rounded-xl px-4 text-sm font-medium transition-colors",
            item.active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {item.active && <motion.span layoutId="payments-nav-pill" className="absolute inset-0 rounded-xl bg-primary-soft" transition={{ type: "spring", stiffness: 400, damping: 34 }} aria-hidden />}
          <span className="relative">{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------------ small layout pieces */

export function Meta({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

/** Short hash with the full value in a tooltip and for screen readers. */
export function Hash({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs" title={value} aria-label={`SHA-256 ${value}`}>
      {value.slice(0, 12)}…{value.slice(-6)}
    </code>
  );
}

export const STATUS_FILTER_CLASS = "min-h-[44px]";
