"use client";

import { AlertTriangle, CheckCircle2, Circle, CircleDot, ClipboardList, Clock3, Info, UserX, XCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";

import { useCan } from "@/components/access/Can";
import { PageSkeleton } from "@/components/payroll/inputs/shared";
import { HideAmountsToggle } from "@/components/payroll/MoneyText";
import { StepUpProvider } from "@/components/payroll/StepUpAuthModal";
import { AccessDenied, EmptyState, PageHeader } from "@/components/ui/layout";
import { Card } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import type { StatusTone } from "@/lib/payroll/labels";
import { P, type PermissionCode } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";

import type { MyPayslip } from "./types";

export { ConflictBanner, DetailGate, ErrorSummary, fieldErrors, isNotFound, Notice, NotFoundState, PageSkeleton } from "@/components/payroll/inputs/shared";

/* ------------------------------------------------------------------ page shell (F-23, F-24) */

/**
 * Every self-service page: the step-up provider (F-24: bank changes and the payslip password prompt
 * "Confirm it's you" here), a Suspense boundary for `useSearchParams`/`useModalRoute` (F-23; the
 * ConfirmProvider is global in `app/providers.tsx`), and a skeleton while the client boundary resolves.
 */
export function MePage({ children }: { children: ReactNode }) {
  return (
    <StepUpProvider>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </StepUpProvider>
  );
}

/**
 * Self-service guard: own records need a linked employee profile and at least one of `codes` (any
 * scope; SELF is enough). A missing profile is explained plainly instead of "access denied".
 */
export function SelfAccess({ codes, children }: { codes: PermissionCode[]; children: ReactNode }) {
  const { me } = useCan();
  if (!me) return null;
  if (!me.employee) {
    return (
      <Card className="mx-auto mt-10 max-w-lg">
        <EmptyState
          icon={<UserX />}
          title="No employee profile linked"
          description="Your sign-in isn't linked to an employee record, so there is no pay information to show. Ask HR to link your account."
        />
      </Card>
    );
  }
  return <>{codes.some((code) => can(me, code)) ? children : <AccessDenied />}</>;
}

export function canSelf(me: Me | null | undefined, code: PermissionCode): boolean {
  return !!me?.employee && can(me, code);
}

/** Header of the self-service pages: title, one primary action and the "Hide amounts" toggle (F-24). */
export function MeHeader({ title, description, actions, hideAmounts = true }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; hideAmounts?: boolean }) {
  return (
    <PageHeader
      eyebrow="My pay"
      title={title}
      description={description}
      actions={
        <>
          {hideAmounts && <HideAmountsToggle />}
          {actions}
        </>
      }
    />
  );
}

/**
 * Close a deep-linked modal after a successful save without the "Discard changes?" prompt: the
 * form reports clean first, then the modal route closes on the next render.
 */
export function useCloseWhenClean(dirty: boolean, setDirty: (d: boolean) => void, close: () => Promise<boolean>) {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (pending && !dirty) {
      setPending(false);
      void close();
    }
  }, [pending, dirty, close]);
  return useCallback(() => {
    setDirty(false);
    setPending(true);
  }, [setDirty]);
}

/* ------------------------------------------------------------------ local status chips */

interface LocalStatus {
  label: string;
  tone: StatusTone;
  glossary?: string;
}

/**
 * Vocabularies the backend has no generated state machine for (bank change requests, document
 * requests, payslip markers). Same look as `StatusChip`; an unknown code is neutral, never success.
 */
export const ME_VOCABULARIES: Record<string, Record<string, LocalStatus>> = {
  bank_change: {
    SECURITY_REVIEW: { label: "Security review", tone: "warning", glossary: "Several changes in a short time: the security team checks this one before it can be approved." },
    PENDING_APPROVAL: { label: "Awaiting approval", tone: "info", glossary: "HR checks the new account before it is used for salary." },
    APPLIED: { label: "Applied", tone: "success", glossary: "The change was approved." },
    REJECTED: { label: "Rejected", tone: "danger" },
    CANCELLED: { label: "Cancelled", tone: "neutral" },
  },
  document_request: {
    PENDING: { label: "Requested", tone: "info" },
    APPROVED: { label: "Approved", tone: "info", glossary: "Approved; the document is being prepared." },
    ISSUED: { label: "Issued", tone: "success" },
    REJECTED: { label: "Rejected", tone: "danger" },
  },
  payslip_marker: {
    NEW: { label: "New", tone: "primary", glossary: "You haven't opened this payslip yet." },
    VIEWED: { label: "Viewed", tone: "neutral" },
    REVISED: { label: "Revised", tone: "warning", glossary: "This payslip replaces an earlier one for the same period." },
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

export function MeChip({ vocabulary, code, className }: { vocabulary: string; code: string | null | undefined; className?: string }) {
  const value = code ?? "";
  const entry = ME_VOCABULARIES[vocabulary]?.[value] ?? { label: humanize(value), tone: "neutral" as StatusTone };
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

/** A plain badge for honesty labels from the API ("FIXTURE — not law", "SANDBOX", "Compliance not verified"). */
export function HonestyBadge({ children, tone = "warning" }: { children: ReactNode; tone?: "warning" | "info" | "danger" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold",
        tone === "warning" && "border-warning/40 bg-warning-soft text-warning",
        tone === "info" && "border-info/30 bg-info-soft text-info",
        tone === "danger" && "border-danger/40 bg-danger-soft text-danger",
      )}
    >
      <AlertTriangle className="h-3 w-3" aria-hidden />
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ payslip markers */

const UNOPENED = new Set(["PUBLISHED", "EMAIL_SENT", "EMAIL_FAILED"]);

/** New / Viewed / Revised markers of a payslip in the employee's list (3.8 §5.18). */
export function payslipMarkers(p: Pick<MyPayslip, "status" | "first_viewed_at" | "supersedes_document_id" | "version">): string[] {
  const markers: string[] = [];
  if (UNOPENED.has(p.status) && !p.first_viewed_at) markers.push("NEW");
  else if (p.status === "VIEWED" || p.first_viewed_at) markers.push("VIEWED");
  if (p.supersedes_document_id || p.version > 1) markers.push("REVISED");
  return markers;
}

/** Superseded and reversed payslips are history, not the current answer for a period. */
export function isCurrentPayslip(p: Pick<MyPayslip, "status">): boolean {
  return p.status !== "SUPERSEDED" && p.status !== "REVERSED";
}

/* ------------------------------------------------------------------ formatting */

export function periodRange(start?: string | null, end?: string | null): string {
  if (!start || !end) return "—";
  return `${fmtDate(start, "d MMM")} – ${fmtDate(end, "d MMM yyyy")}`;
}

/** Whole remaining time until `iso` ("2 d 4 h", "35 min"); null once it has passed. */
export function timeLeft(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.ceil(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${mins} min`;
  return `${mins} min`;
}

/**
 * Share of `part` in `whole` as a percentage 0–100 with one decimal, by exact BigInt arithmetic on
 * the decimal strings (never floating point on money). Display only: a bar width.
 */
export function shareOf(part: string | null | undefined, whole: string | null | undefined): number {
  const scaled = (v: string) => {
    const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(v.trim());
    if (!m) return null;
    const frac = (m[3] ?? "").padEnd(6, "0").slice(0, 6);
    const n = BigInt((m[2] || "0") + frac);
    return m[1] ? -n : n;
  };
  if (!part || !whole) return 0;
  const p = scaled(part);
  const w = scaled(whole);
  if (p === null || w === null || w <= BigInt(0) || p <= BigInt(0)) return 0;
  const permille = (p * BigInt(1000)) / w;
  const clamped = permille > BigInt(1000) ? BigInt(1000) : permille;
  return Number(clamped) / 10;
}

/* ------------------------------------------------------------------ section links */

/** Loans ⇄ Claims switcher (one page area, two routes, 3.8 §3.3). */
export function LoansClaimsNav() {
  const pathname = usePathname() ?? "";
  const { me } = useCan();
  const items = [
    { href: "/me/loans", label: "Loans & advances", show: canSelf(me, P.PAYROLL_LOANS_READ) || canSelf(me, P.PAYROLL_LOANS_MANAGE) },
    { href: "/me/claims", label: "Claims", show: canSelf(me, P.PAYROLL_REIMBURSEMENTS_READ) || canSelf(me, P.PAYROLL_REIMBURSEMENTS_MANAGE) },
  ].filter((i) => i.show);
  if (items.length < 2) return null;
  return (
    <nav aria-label="Loans and claims" className="mb-5 inline-flex rounded-2xl border border-border bg-surface p-1 shadow-sm">
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-medium transition-colors",
              active ? "bg-primary-soft text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** "My Tasks" and "My Overtime" when the person may use them (3.8 §3.3: links when enabled). */
export function SelfServiceLinks() {
  const { me } = useCan();
  const links = [
    { href: "/tasks", label: "My Tasks", hint: "Assigned tasks and completed units", icon: ClipboardList, show: canSelf(me, P.TASK_READ) },
    { href: "/overtime", label: "My Overtime", hint: "Request overtime and track approvals", icon: Clock3, show: canSelf(me, P.OVERTIME_REQUEST) },
  ].filter((l) => l.show);
  if (!links.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {links.map(({ href, label, hint, icon: Icon }) => (
        <Link key={href} href={href} className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-border bg-surface p-4 transition-colors hover:bg-surface-muted">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{label}</span>
            <span className="block text-xs text-muted-foreground">{hint}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

/** A link styled as a secondary button with a 44 px target (Button has no asChild). */
export function LinkButton({ href, children, className, primary }: { href: string; children: ReactNode; className?: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors",
        primary ? "bg-primary text-primary-foreground hover:opacity-90" : "border border-border bg-surface hover:bg-surface-muted",
        className,
      )}
    >
      {children}
    </Link>
  );
}
