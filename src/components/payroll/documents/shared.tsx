"use client";

import { AlertTriangle, CheckCircle2, Circle, CircleDot, FlaskConical, Info, RefreshCw, SearchX, ShieldAlert, XCircle } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { useCan } from "@/components/access/Can";
import { Hint } from "@/components/payroll/Hint";
import { HideAmountsToggle } from "@/components/payroll/MoneyText";
import { StepUpProvider } from "@/components/payroll/StepUpAuthModal";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { canAny } from "@/lib/access";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/hooks";
import { isConflict } from "@/lib/payroll/api";
import type { StatusTone } from "@/lib/payroll/labels";
import { P, type PermissionCode } from "@/lib/permissions.generated";

import { lookupsApi } from "./api";
import type { Option } from "./types";

/* ------------------------------------------------------------------ page shell (F-23, F-24) */

/**
 * Every page of this area: the step-up provider (F-24), and a Suspense boundary for
 * `useSearchParams` / `useModalRoute` (F-23; ConfirmProvider is global in `app/providers.tsx`).
 */
export function DocsPage({ children }: { children: ReactNode }) {
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

/* ------------------------------------------------------------------ local status vocabularies */

interface LocalStatus {
  label: string;
  tone: StatusTone;
  glossary?: string;
}

/**
 * Statuses that have no generated vocabulary in `catalogues.generated.ts` (export jobs, statutory
 * liabilities, attestations, due-date items, capability kinds). Unknown codes are neutral, never success.
 */
export const LOCAL_VOCABULARIES: Record<string, Record<string, LocalStatus>> = {
  export: {
    QUEUED: { label: "Queued", tone: "neutral", glossary: "Waiting to start." },
    GENERATING: { label: "Generating", tone: "info", glossary: "Being built in the background. You can leave this page." },
    READY: { label: "Ready", tone: "success", glossary: "Ready to download until it expires." },
    FAILED: { label: "Failed", tone: "danger", glossary: "The file could not be built. Export it again." },
    EXPIRED: { label: "Expired", tone: "neutral", glossary: "The file was deleted after 24 hours. Export it again." },
  },
  liability: {
    OPEN: { label: "Open", tone: "warning", glossary: "Owed to the authority; no remittance recorded yet." },
    REMITTED: { label: "Remitted", tone: "info", glossary: "A payment reference was recorded. Not reconciled yet." },
    RECONCILED: { label: "Reconciled", tone: "success", glossary: "Matched to the bank statement or authority receipt." },
  },
  attestation: {
    ACTIVE: { label: "Attestation active", tone: "success", glossary: "An approved attestation covers today." },
    PENDING_APPROVAL: { label: "Attestation pending approval", tone: "warning", glossary: "Waiting for a second person to approve (maker-checker)." },
    MISSING: { label: "Attestation missing", tone: "danger", glossary: "Runs for this entity cannot be finalized until an attestation is approved." },
    NOT_REQUIRED: { label: "Not required", tone: "neutral", glossary: "A usable country pack covers this entity." },
  },
  due: {
    OPEN: { label: "Open", tone: "warning" },
    REMITTED: { label: "Remitted", tone: "info" },
    RECONCILED: { label: "Reconciled", tone: "success" },
    NO_LIABILITY: { label: "No liability", tone: "neutral", glossary: "No finalized run created a liability for this period." },
    NOT_STARTED: { label: "Not started", tone: "neutral", glossary: "No statutory report has been created for this period." },
  },
  capability: {
    PRODUCTION: { label: "Production", tone: "success" },
    FIXTURE: { label: "Fixture", tone: "warning" },
    NOT_VERIFIED: { label: "Not verified", tone: "warning" },
    UNSUPPORTED: { label: "Unsupported", tone: "danger" },
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

export function LocalStatusChip({ vocabulary, code, label, tone, className }: { vocabulary: string; code: string | null | undefined; label?: string; tone?: StatusTone; className?: string }) {
  const entry = localStatus(vocabulary, code);
  const t = tone ?? entry.tone;
  const Icon = TONE_ICON[t] ?? Circle;
  const chip = (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", TONE_CLASS[t] ?? TONE_CLASS.neutral, className)}
      data-tone={t}
      data-status={entry.code}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label ?? entry.label}
    </span>
  );
  return entry.glossary ? <Hint content={entry.glossary}>{chip}</Hint> : chip;
}

/** API-provided tones ("success", "warning"…) mapped onto the design tokens; anything else is neutral. */
export function toneOf(value: string | null | undefined): StatusTone {
  return value && value in TONE_CLASS ? (value as StatusTone) : "neutral";
}

/* ------------------------------------------------------------------ honest labels */

/**
 * The fixture / compliance labels exactly as the API gives them ("FIXTURE — not law",
 * "Statutory deductions not calculated — compliance not verified"). Never reworded, never hidden.
 */
export function HonestLabels({ labels, className }: { labels: (string | null | undefined)[]; className?: string }) {
  const list = Array.from(new Set(labels.filter((l): l is string => !!l && !!l.trim())));
  if (!list.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-2", className)} aria-label="Document labels">
      {list.map((label) => {
        const fixture = /fixture/i.test(label);
        const Icon = fixture ? FlaskConical : ShieldAlert;
        return (
          <li
            key={label}
            className="inline-flex items-center gap-1.5 rounded-full border border-warning/50 bg-warning-soft px-2.5 py-0.5 text-xs font-semibold text-warning"
            data-label={label}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {label}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ banners and states */

/** 409 / 412: "Someone else changed this" with a one-click reload (EC-UX-04). Never overwrite silently. */
export function ConflictBanner({ error, onReload, className }: { error: unknown; onReload?: () => void; className?: string }) {
  if (!isConflict(error)) return null;
  return (
    <div role="alert" className={cn("flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm", className)}>
      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Someone else changed this</p>
        <p className="text-muted-foreground">{(error as ApiError).message}</p>
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
  if (error && !hasData) return <ErrorState message={errorText(error)} onRetry={onRetry} />;
  if (loading && !hasData) return <PageSkeleton />;
  return <>{children}</>;
}

/* ------------------------------------------------------------------ errors */

/** Map 422 field errors (`{field, msg}`) to a record keyed by the last meaningful part of the name. */
export function fieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const fields = error instanceof ApiError ? error.fields ?? [] : [];
  fields.forEach((f) => {
    const parts = String(f.field || "").split(".").filter((p) => p && p !== "body");
    const key = parts[parts.length - 1] ?? "form";
    if (!out[key]) out[key] = f.msg;
  });
  return out;
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Something went wrong. Please try again.";
}

/** Inline errors plus a summary at the top of the form (3.8 §8). Conflicts have their own banner. */
export function ErrorSummary({ error, fields }: { error: unknown; fields?: Record<string, string> }) {
  if (isConflict(error)) return null;
  const list = Object.entries(fields ?? {}).filter(([, m]) => !!m);
  if (!error && !list.length) return null;
  return (
    <div role="alert" className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm">
      <p className="font-medium text-danger">{list.length ? "Some fields need attention." : errorText(error)}</p>
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

/* ------------------------------------------------------------------ formatting */

const DATE_FMT = new Map<string, Intl.DateTimeFormat>();

/** "30 Nov 2026" (date-only strings are read as calendar dates, never shifted by the time zone). */
export function formatDate(value: string | null | undefined, locale = "en-GB"): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const key = locale;
  let fmt = DATE_FMT.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    } catch {
      fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    }
    DATE_FMT.set(key, fmt);
  }
  return fmt.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
}

/** "26 Oct – 25 Nov 2026" style ranges. */
export function formatRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "—";
  if (!start || !end) return formatDate(start ?? end);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/** A timestamp in the viewer's time zone ("30 Nov 2026, 14:05"). */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const human = humanize;

/* ------------------------------------------------------------------ lookups (degrade to id fields) */

export interface Lookup {
  /** null when the viewer cannot read the list: the filter becomes a numeric id field. */
  options: Option[] | null;
  name: (id: number | null | undefined) => string;
}

function useLookup(kind: string, fetcher: () => Promise<Option[]>, codes: PermissionCode[], fallbackNoun: string): Lookup {
  const { me } = useCan();
  const allowed = !!me && canAny(me, codes);
  const { data } = useApi(fetcher, [kind], { enabled: allowed });
  const options = allowed ? data ?? null : null;
  return {
    options,
    name: (id) => {
      if (id === null || id === undefined) return "—";
      const found = options?.find((o) => o.id === id);
      return found ? found.name : `${fallbackNoun} #${id}`;
    },
  };
}

export function useEntities(): Lookup {
  return useLookup("entities", lookupsApi.legalEntities, [P.ORG_READ, P.ORG_MANAGE_ENTITIES], "Entity");
}

export function usePayGroups(): Lookup {
  return useLookup("pay-groups", lookupsApi.payGroups, [P.ORG_READ, P.ORG_MANAGE_DIMENSIONS, P.PAYROLL_CONFIGURATION_READ], "Pay group");
}

export function useCostCenters(): Lookup {
  return useLookup("cost-centers", lookupsApi.costCenters, [P.ORG_READ, P.ORG_MANAGE_DIMENSIONS], "Cost center");
}

export function useDepartments(): Lookup {
  const { me } = useCan();
  const { data } = useApi(lookupsApi.departments, ["departments"], { enabled: !!me });
  const options = data ?? null;
  return {
    options,
    name: (id) => {
      if (id === null || id === undefined) return "—";
      return options?.find((o) => o.id === id)?.name ?? `Department #${id}`;
    },
  };
}

/** A filter select over a lookup, or a numeric id field when the list is not available to this viewer. */
export function LookupField({
  label,
  lookup,
  value,
  onChange,
  allLabel = "All",
  hint,
  id,
}: {
  label: string;
  lookup: Lookup;
  value: number | null;
  onChange: (v: number | null) => void;
  allLabel?: string;
  hint?: ReactNode;
  id?: string;
}) {
  if (lookup.options) {
    return (
      <Field label={label} hint={hint}>
        <Select id={id} className="min-h-[44px]" value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{allLabel}</option>
          {lookup.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  return (
    <Field label={`${label} id`} hint={hint ?? "The list needs organisation access; enter an id."}>
      <Input
        id={id}
        className="min-h-[44px]"
        inputMode="numeric"
        value={value ?? ""}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          onChange(digits ? Number(digits) : null);
        }}
      />
    </Field>
  );
}

/** RTL scripts for the payslip language (EC-UX-09). */
const RTL = new Set(["ar", "he", "fa", "ur", "ps", "dv", "yi", "ckb", "sd", "ug"]);
export function isRtlLanguage(language: string | null | undefined): boolean {
  if (!language) return false;
  return RTL.has(language.toLowerCase().split(/[-_]/)[0]);
}
