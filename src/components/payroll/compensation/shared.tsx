"use client";

import { AlertTriangle, ArrowLeft, FileQuestion, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Suspense, useEffect, useState, type ReactNode } from "react";

import { RequireAccess } from "@/components/access/Can";
import { Hint } from "@/components/payroll/Hint";
import { HideAmountsToggle } from "@/components/payroll/MoneyText";
import { StepUpProvider } from "@/components/payroll/StepUpAuthModal";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Me } from "@/lib/types";

import { compensationApi } from "./api";
import type { OrgOption } from "./types";

/**
 * Wraps every compensation page: the page guard, the step-up prompt for payroll requests (F-24),
 * Suspense for useSearchParams / useModalRoute (F-23; ConfirmProvider is mounted app-wide in
 * providers.tsx) and the workspace bar with "Hide amounts" (F-24). The shared payroll layout is
 * owned elsewhere, so this local wrapper renders the toggle until a workspace layout exists.
 */
export function CompensationWorkspace({ check, children }: { check: (me: Me) => boolean; children: ReactNode }) {
  return (
    <RequireAccess check={check}>
      <StepUpProvider>
        <div className="mb-2 flex justify-end">
          <HideAmountsToggle />
        </div>
        <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
      </StepUpProvider>
    </RequireAccess>
  );
}

export function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Card className="space-y-2 p-4">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </Card>
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> {children}
    </Link>
  );
}

/** 404 and out-of-scope objects look the same (EC-UX-02): the object is "not found". */
export function NotFoundState({ what, backHref, backLabel }: { what: string; backHref: string; backLabel: string }) {
  return (
    <Card>
      <EmptyState
        icon={<FileQuestion />}
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

/** Error, 404/403-as-not-found, or nothing. */
export function LoadError({ error, onRetry, what, backHref, backLabel }: { error: unknown; onRetry: () => void; what: string; backHref: string; backLabel: string }) {
  if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return <NotFoundState what={what} backHref={backHref} backLabel={backLabel} />;
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <Card>
      <ErrorState message={message} onRetry={onRetry} />
    </Card>
  );
}

/** "Someone else changed this" (409, EC-UX-04): never silently overwrite. */
export function ConflictBanner({ message, onReload, className }: { message?: string | null; onReload: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning", className)}>
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-foreground">
        <span className="font-semibold">Someone else changed this.</span> {message || "Reload to see the latest version; your edits were not saved."}
      </p>
      <Button size="sm" variant="secondary" onClick={onReload} className="min-h-[44px]">
        <RefreshCw className="h-4 w-4" aria-hidden /> Reload
      </Button>
    </div>
  );
}

/** Summary of validation problems above a form (3.8 §8), next to the inline field errors. */
export function ErrorSummary({ title = "Fix these before you continue", errors, className }: { title?: string; errors: ReactNode[]; className?: string }) {
  if (!errors.length) return null;
  return (
    <div role="alert" className={cn("rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm", className)}>
      <p className="font-semibold text-danger">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 ps-5 text-foreground">
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </div>
  );
}

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

/** A status badge for vocabularies the generated catalogue does not have yet (cycles, items, versions). */
export function ToneChip({ label, tone, glossary }: { label: string; tone: Tone; glossary?: string }) {
  const chip = (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
  return glossary ? <Hint content={glossary}>{chip}</Hint> : chip;
}

/** "Compliance not verified" / "FIXTURE — not law" badges from the API's statutory flags. */
export function ComplianceBadges({ verified, fixture, label = "Compliance not verified" }: { verified: boolean; fixture?: boolean; label?: string }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {!verified && <ToneChip tone="warning" label={label} glossary="Statutory estimates come from the country pack in preview mode and are not verified." />}
      {fixture && <ToneChip tone="danger" label="FIXTURE — not law" glossary="This value comes from a test fixture pack. It is not a statement of the law." />}
    </span>
  );
}

/* ------------------------------------------------------------------ org options */

export interface OrgOptions {
  legalEntities: OrgOption[] | null;
  payGroups: OrgOption[] | null;
  grades: OrgOption[] | null;
  employmentTypes: OrgOption[] | null;
  departments: OrgOption[] | null;
}

/**
 * Names for eligibility and population ids. Each list needs org:read (or payroll configuration
 * read for pay groups); a list the viewer cannot read stays `null` and the UI falls back to ids.
 */
export function useOrgOptions(enabled = true): OrgOptions {
  const [state, setState] = useState<OrgOptions>({ legalEntities: null, payGroups: null, grades: null, employmentTypes: null, departments: null });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const settle = <K extends keyof OrgOptions>(key: K, p: Promise<OrgOption[]>) =>
      p.then((v) => !cancelled && setState((s) => ({ ...s, [key]: v }))).catch(() => undefined);
    settle(
      "legalEntities",
      compensationApi.legalEntities().then((rows) => rows.map((r) => ({ id: r.id, code: r.code, name: r.legal_name, currency: r.base_currency }))),
    );
    settle("payGroups", compensationApi.orgDimension("pay-groups"));
    settle("grades", compensationApi.orgDimension("grades"));
    settle("employmentTypes", compensationApi.orgDimension("employment-types"));
    settle("departments", compensationApi.departments().then((rows) => rows.map((r) => ({ id: r.id, code: String(r.id), name: r.name }))));
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return state;
}

export function optionName(options: OrgOption[] | null, id: number): string {
  const found = options?.find((o) => o.id === id);
  return found ? found.name : `#${id}`;
}

/** Multi-select of org options as toggle chips (44 px targets); ids when the list is unavailable. */
export function IdChips({
  label,
  options,
  value,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  options: OrgOption[] | null;
  value: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const [manual, setManual] = useState("");
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id].sort((a, b) => a - b));
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="text-[13px] font-medium text-foreground/90">{label}</legend>
      {options ? (
        options.length ? (
          <div className="flex flex-wrap gap-1.5">
            {options.map((o) => {
              const on = value.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(o.id)}
                  className={cn(
                    "min-h-[44px] rounded-xl border px-3 text-sm transition-colors sm:min-h-[36px]",
                    on ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-muted-foreground hover:text-foreground",
                  )}
                >
                  {o.name}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">None set up yet.</p>
        )
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Names need organisation read access; enter ids separated by commas.</p>
          <input
            className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm"
            aria-label={`${label} ids`}
            value={manual || value.join(", ")}
            onChange={(e) => {
              setManual(e.target.value);
              onChange(
                e.target.value
                  .split(/[,\s]+/)
                  .map((v) => Number.parseInt(v, 10))
                  .filter((n) => Number.isInteger(n) && n > 0),
              );
            }}
          />
        </div>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </fieldset>
  );
}
