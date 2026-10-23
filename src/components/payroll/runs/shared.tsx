"use client";

import { AlertTriangle, Info, SearchX } from "lucide-react";
import Link from "next/link";
import { Suspense, useMemo, type ReactNode } from "react";

import { CurrencyBadge } from "@/components/payroll/CurrencyBadge";
import { HideAmountsToggle, MoneyText } from "@/components/payroll/MoneyText";
import { StepUpProvider } from "@/components/payroll/StepUpAuthModal";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { needsIsoCodes } from "@/lib/money";
import { P } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";

import { runsApi } from "./api";
import type { BranchOption, CurrencyFigures, EntityOption, PayGroupOption } from "./types";

/* ------------------------------------------------------------------ page shell (F-23, F-24) */

/**
 * Every page of this area: StepUpProvider (F-24: payroll requests that need MFA prompt here) and a
 * Suspense boundary for `useSearchParams` / `useModalRoute` (F-23; ConfirmProvider is mounted
 * app-wide in `app/providers.tsx`).
 */
export function RunsPage({ children }: { children: ReactNode }) {
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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/** Workspace header: title, actions (one primary) and the "Hide amounts" toggle (3.8 §3.2, F-24). */
export function WorkspaceHeader({ eyebrow = "Payroll", title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <PageHeader
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={
        <>
          <HideAmountsToggle />
          {actions}
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ permissions (UI only; the API decides) */

export const canReadRuns = (me: Me | null | undefined) => can(me, P.PAYROLL_RUN_READ);
export const canCreateRuns = (me: Me | null | undefined) => can(me, P.PAYROLL_RUN_CREATE);
/** The overview KPIs need payroll:run:read or the legacy payroll:read (services/reports.OVERVIEW_PERMISSIONS). */
export const canReadOverview = (me: Me | null | undefined) => can(me, P.PAYROLL_RUN_READ) || can(me, P.PAYROLL_READ);

/* ------------------------------------------------------------------ banners */

/**
 * 409 / 412 with Reload (EC-UX-04): one banner for every payroll area, so known refusal codes (expired FX
 * quote, finalized run, cancelled batch, reversal hold…) read the same everywhere.
 */
export { ConflictBanner } from "@/components/payroll/inputs/shared";

export function Notice({ tone = "info", title, children, action, className }: { tone?: "info" | "warning" | "danger"; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      className={cn(
        "flex flex-wrap gap-3 rounded-xl border px-4 py-3 text-sm",
        tone === "info" && "border-info/30 bg-info-soft",
        tone === "warning" && "border-warning/40 bg-warning-soft",
        tone === "danger" && "border-danger/40 bg-danger-soft",
        className,
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "info" ? "text-info" : tone === "warning" ? "text-warning" : "text-danger")} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-0.5 text-muted-foreground">{children}</div>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
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

export const linkButton =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium shadow-sm transition-colors hover:bg-surface-muted";
export const primaryLink =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90";

/* ------------------------------------------------------------------ vocabularies without a generated catalogue */

export const RUN_TYPE_LABELS: Record<string, string> = {
  REGULAR: "Regular",
  OFF_CYCLE: "Off-cycle",
  RETRO_ADJUSTMENT: "Retro adjustment",
  FINAL_SETTLEMENT: "Final settlement",
  REVERSAL: "Reversal",
};

export const EXCLUSION_LABELS: Record<string, string> = {
  NO_SALARY: "No salary",
  INVALID_ASSIGNMENT: "Invalid placement",
  JOINED_AFTER_PERIOD: "Joined after the period",
  LEFT_BEFORE_PERIOD: "Left before the period",
  SUSPENDED_ALL_PERIOD: "Suspended all period",
  INELIGIBLE: "Not eligible",
  REMOVED: "Removed",
  NOT_SELECTED: "Not selected",
};

export const HOLD_REASON_LABELS: Record<string, string> = {
  ABSCONDING: "Absconding",
  DISPUTE: "Dispute",
  BANK_ISSUE: "Bank issue",
  INVESTIGATION: "Investigation",
  OTHER: "Other",
};

export const EMPLOYEE_STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-muted text-muted-foreground" },
  CALCULATED: { label: "Calculated", className: "bg-success-soft text-success" },
  ERROR: { label: "Error", className: "bg-danger-soft text-danger" },
  ON_HOLD: { label: "On hold", className: "bg-warning-soft text-warning" },
  EXCLUDED: { label: "Excluded", className: "bg-muted text-muted-foreground" },
};

export function humanize(code: string | null | undefined): string {
  const text = (code ?? "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : "—";
}

/** Employee-in-run status chip (not a run vocabulary; label + tone + text, never colour alone). */
export function EmployeeStatusChip({ status, holdType }: { status: string; holdType?: string | null }) {
  const entry = EMPLOYEE_STATUS[status] ?? { label: humanize(status), className: "bg-muted text-muted-foreground" };
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", entry.className)} data-status={status}>
        {entry.label}
      </span>
      {holdType && status !== "ON_HOLD" && (
        <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">{holdType === "PAYMENT" ? "Payment held" : "Held"}</span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ dates */

/** "26 Oct – 25 Nov 2026" (3.8 §9). */
export function dateRange(start?: string | null, end?: string | null): string {
  if (!start || !end) return "—";
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${fmtDate(start, sameYear ? "d MMM" : "d MMM yyyy")} – ${fmtDate(end, "d MMM yyyy")}`;
}

export function periodLabel(period: { start: string; end: string } | null | undefined): string {
  if (!period) return "—";
  return dateRange(period.start, period.end);
}

/* ------------------------------------------------------------------ money */

/** Per-currency amounts of one figure ("net") from `{CUR: {net: "…"}}`; never summed across currencies. */
export function figureByCurrency(totals: Record<string, CurrencyFigures> | null | undefined, key: keyof CurrencyFigures): { amount: string; currency: string }[] {
  return Object.entries(totals ?? {})
    .filter(([, f]) => typeof f?.[key] === "string")
    .map(([currency, f]) => ({ amount: f[key] as string, currency }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** A stack of per-currency amounts; ISO codes appear when more than one currency is visible. */
export function MoneyStack({ amounts, emphasis, className, empty = "—" }: { amounts: { amount: string; currency: string }[]; emphasis?: boolean; className?: string; empty?: ReactNode }) {
  if (!amounts.length) return <span className="text-muted-foreground">{empty}</span>;
  const useCode = needsIsoCodes(amounts.map((a) => a.currency));
  return (
    <span className={cn("inline-flex flex-col items-end gap-0.5", className)}>
      {amounts.map((m) => (
        <span key={m.currency} className="inline-flex items-center gap-1.5">
          {useCode && <CurrencyBadge code={m.currency} />}
          <MoneyText money={m} useCode={useCode} emphasis={emphasis} />
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ lookups (degrade without org:read) */

/**
 * Names for legal entities, pay groups and branches. Each list needs its own permission
 * (org:read / payroll:configuration:read); a 403 leaves the list empty and the UI falls back to
 * the codes and ids it already has, never inventing names.
 */
export function useLookups({ branches = false }: { branches?: boolean } = {}) {
  const entities = useApi(() => runsApi.legalEntities().catch(() => [] as EntityOption[]), []);
  const groups = useApi(() => runsApi.payGroups().catch(() => [] as PayGroupOption[]), []);
  const branchList = useApi(() => runsApi.branches().catch(() => [] as BranchOption[]), [], { enabled: branches });
  return useMemo(() => {
    const entityList = Array.isArray(entities.data) ? entities.data : [];
    const groupList = Array.isArray(groups.data) ? groups.data : [];
    const branchRows = Array.isArray(branchList.data) ? branchList.data : [];
    const entityById = new Map(entityList.map((e) => [e.id, e]));
    return {
      entities: entityList,
      payGroups: groupList,
      branches: branchRows,
      loading: entities.loading || groups.loading,
      entityName: (id: number | null | undefined) => {
        if (id === null || id === undefined) return "—";
        const e = entityById.get(id);
        return e ? e.legal_name || e.code : `Legal entity #${id}`;
      },
      entity: (id: number | null | undefined) => (id === null || id === undefined ? undefined : entityById.get(id)),
    };
  }, [entities.data, entities.loading, groups.data, groups.loading, branchList.data]);
}

/* ------------------------------------------------------------------ fix links */

/**
 * The backend's `fix_link` for an exception, mapped onto the frontend routes that exist. Links the
 * frontend has no page for are dropped (the person sees the message and can still waive or defer).
 */
export function fixHref(link: string | null | undefined): string | undefined {
  if (!link || !link.startsWith("/")) return undefined;
  if (link.startsWith("/payroll/bank-accounts")) return link.replace("/payroll/bank-accounts", "/payroll/bank-details");
  if (link.startsWith("/payroll/compliance/attestations")) return link.replace("/payroll/compliance/attestations", "/payroll/compliance");
  return link;
}

/** A tiny "per currency" section label. */
export function CurrencyNote({ currencies }: { currencies: string[] }) {
  if (currencies.length < 2) return null;
  return <p className="text-xs text-muted-foreground">Shown per currency; amounts in different currencies are never added together.</p>;
}
