"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ChevronDown, Lock, Rocket } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";

import { Notice } from "@/components/payroll/inputs/shared";
import { Input } from "@/components/ui/field";
import { MotionSafe } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/hooks";
import { LeaveAdminError, leaveAdminApi } from "@/lib/leave/adminApi";
import type { LeaveAccess, LeaveTypeV2, PlanIssue } from "@/lib/leave/adminTypes";
import { leaveColor } from "@/lib/leave/colors";

/* ------------------------------------------------------------------ access */

let accessCache: Promise<LeaveAccess> | null = null;

/** `GET /leaves/access` once per page load (reset with `refresh` after go-live / rollback). */
export function useLeaveAccess() {
  const [tick, setTick] = useState(0);
  const state = useApi(() => {
    if (!accessCache) accessCache = leaveAdminApi.access().catch((e) => {
      accessCache = null;
      throw e;
    });
    return accessCache;
  }, [tick]);
  return {
    ...state,
    refresh: () => {
      accessCache = null;
      setTick((t) => t + 1);
    },
  };
}

/** Test hook: forget the cached access facts. */
export function resetLeaveAccessCache() {
  accessCache = null;
}

/** Whether the access facts grant `code` (optionally at `scope`; COMPANY covers every scope). */
export function hasLeavePerm(access: LeaveAccess | undefined | null, code: string, scope?: string): boolean {
  const scopes = access?.permissions?.[code];
  if (!scopes?.length) return false;
  if (!scope) return true;
  return scopes.includes("COMPANY") || scopes.includes(scope);
}

/* ------------------------------------------------------------------ leave types */

export function useLeaveTypes(includeInactive = true) {
  return useApi(() => leaveAdminApi.types(includeInactive), [includeInactive]);
}

export function LeaveSwatch({ token, className }: { token: string | null | undefined; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)} style={{ backgroundColor: leaveColor(token ?? "leave-neutral") }} />;
}

export function TypeName({ type, code }: { type?: Pick<LeaveTypeV2, "name" | "color_token" | "code"> | null; code?: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <LeaveSwatch token={type?.color_token} />
      <span className="truncate">{type?.name ?? code}</span>
      {(type?.code ?? code) && <span className="font-mono text-[11px] text-muted-foreground">{type?.code ?? code}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ org options (best effort) */

export interface Option {
  id: number;
  label: string;
  code?: string;
}

function rows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const items = (data as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

const load = (url: string, label: (r: Record<string, unknown>) => string) =>
  api
    .get<unknown>(url)
    .then((data) => rows(data).map((r) => ({ id: Number(r.id), label: label(r), code: r.code ? String(r.code) : undefined })))
    .catch(() => [] as Option[]);

/** Legal entities, branches, departments, grades, designations and employment types the caller can read. */
export function useOrgOptions(enabled = true) {
  const { data } = useApi(
    async () => {
      const [entities, branches, departments, grades, designations, employmentTypes] = await Promise.all([
        load("/legal-entities", (r) => String(r.trade_name || r.legal_name || r.code || r.id)),
        load("/branches", (r) => String(r.name ?? r.code ?? r.id)),
        load("/departments", (r) => String(r.name ?? r.id)),
        load("/payroll/org/grades", (r) => String(r.name ?? r.code ?? r.id)),
        load("/payroll/org/designations", (r) => String(r.name ?? r.code ?? r.id)),
        load("/payroll/org/employment-types", (r) => String(r.name ?? r.code ?? r.id)),
      ]);
      return { entities, branches, departments, grades, designations, employmentTypes };
    },
    [],
    { enabled },
  );
  return useMemo(
    () => data ?? { entities: [], branches: [], departments: [], grades: [], designations: [], employmentTypes: [] },
    [data],
  );
}

export function optionName(options: Option[], id: number | null | undefined): string {
  if (id == null) return "—";
  return options.find((o) => o.id === id)?.label ?? `#${id}`;
}

/* ------------------------------------------------------------------ chips */

/** A multi-select of toggle chips (`aria-pressed`). */
export function ChipToggleGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T[];
  onChange: (next: T[]) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <p id={id} className="text-[13px] font-medium text-foreground/90">{label}</p>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={String(o.value)}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60",
                on ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          );
        })}
        {options.length === 0 && <span className="text-xs text-muted-foreground">Nothing to choose from.</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ issues and errors */

export function IssueList({ issues, title, tone = "danger", onSelect }: {
  issues: PlanIssue[];
  title?: string;
  tone?: "danger" | "warning";
  onSelect?: (issue: PlanIssue) => void;
}) {
  if (!issues.length) return null;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("rounded-xl border px-4 py-3 text-sm", tone === "danger" ? "border-danger/40 bg-danger-soft" : "border-warning/40 bg-warning-soft")}
      data-testid={tone === "danger" ? "issue-list" : "warning-list"}
    >
      <p className={cn("flex items-center gap-2 font-medium", tone === "danger" ? "text-danger" : "text-warning")}>
        <AlertTriangle className="h-4 w-4" aria-hidden />
        {title ?? (tone === "danger" ? `${issues.length} problem(s) to fix` : `${issues.length} warning(s)`)}
      </p>
      <ul className="mt-1.5 space-y-1 ps-6 text-foreground/80">
        {issues.slice(0, 20).map((issue, i) => (
          <li key={`${issue.field}-${i}`} className="list-disc">
            {onSelect && issue.field ? (
              <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => onSelect(issue)}>
                {issue.message}
              </button>
            ) : (
              issue.message
            )}
            {issue.field && <span className="ms-1.5 font-mono text-[11px] text-muted-foreground">{issue.field}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const CODE_HELP: Record<string, string> = {
  STEP_UP_REQUIRED: "Confirm it's you, then try again.",
  SELF_DECISION_FORBIDDEN: "A different administrator must do this step (maker ≠ checker).",
  ROW_VERSION_CONFLICT: "Someone else saved a change. Reload to see it, then redo yours.",
  PREVIEW_CHANGED: "The draft changed after the activation was requested. Ask for a new request.",
  RECONCILIATION_FAILED: "Some balances differ between the legacy and new calculation. Review the reconciliation first.",
};

/** A request error with the server's explanation and, for structured errors, the list of problems. */
export function ErrorNotice({ error, title }: { error: unknown; title?: string }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const code = error instanceof LeaveAdminError || (error as { code?: string })?.code ? (error as { code?: string }).code : undefined;
  const issues = error instanceof LeaveAdminError ? error.issues.filter((i) => i.message !== message) : [];
  return (
    <Notice tone="danger" title={title ?? message}>
      {title && <p>{message}</p>}
      {code && CODE_HELP[code] && <p>{CODE_HELP[code]}</p>}
      {issues.length > 0 && (
        <ul className="mt-1 list-disc ps-5">
          {issues.slice(0, 10).map((i, n) => (
            <li key={n}>
              {i.message}
              {i.field && <span className="ms-1 font-mono text-[11px]">({i.field})</span>}
            </li>
          ))}
        </ul>
      )}
    </Notice>
  );
}

/* ------------------------------------------------------------------ typed confirmation */

/** "Type GO LIVE to confirm": the action unlocks only when the text matches (case-insensitive, trimmed). */
export function typedMatches(value: string, expected: string): boolean {
  return value.trim().toUpperCase() === expected.trim().toUpperCase();
}

export function TypedConfirm({ expected, value, onChange, testId, caseSensitive = false }: {
  expected: string;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
  caseSensitive?: boolean;
}) {
  const id = useId();
  const ok = caseSensitive ? value.trim() === expected : typedMatches(value, expected);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-[13px] font-medium">
        Type <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{expected}</span> to confirm
      </label>
      <Input
        id={id}
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={value.length > 0 && !ok ? true : undefined}
        className="font-mono"
        data-testid={testId}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ v2 gate */

/** Features that exist only after the cut-over (the API answers 404 while the tenant is LEGACY_V1). */
export function V2Only({ access, children, what }: { access: LeaveAccess | undefined; children: ReactNode; what: string }) {
  if (access && !access.v2_enabled) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface-muted/40 p-8 text-center" data-testid="v2-only">
        <Rocket className="mx-auto mb-3 h-7 w-7 text-primary" aria-hidden />
        <p className="font-medium">{what} is available after leave v2 goes live</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          The company still uses legacy leave (yearly quotas). Build plans, reconcile and go live in Leave setup first.
        </p>
        <Link href="/settings/leave/setup" className="mt-4 inline-flex min-h-[40px] items-center rounded-xl border border-border px-4 text-sm font-medium hover:bg-surface-muted">
          Open the setup checklist
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}

export function NoPermission({ what }: { what: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface-muted/40 p-5 text-sm text-muted-foreground" data-testid="no-permission">
      <Lock className="h-4 w-4" aria-hidden /> You don&apos;t have permission to {what}.
    </div>
  );
}

/* ------------------------------------------------------------------ accordion section */

export function Section({ title, summary, issueCount = 0, defaultOpen = false, children, testId }: {
  title: string;
  summary?: ReactNode;
  issueCount?: number;
  defaultOpen?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  useEffect(() => {
    if (issueCount > 0) setOpen(true);
  }, [issueCount]);
  return (
    <section className="rounded-2xl border border-border bg-surface" data-testid={testId}>
      <h4>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-surface-muted/60"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{title}</span>
            {summary && !open && <span className="block truncate text-xs text-muted-foreground">{summary}</span>}
          </span>
          {issueCount > 0 && (
            <span className="rounded-full bg-danger px-2 text-[11px] font-semibold text-white" aria-label={`${issueCount} problem(s)`}>
              {issueCount}
            </span>
          )}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </h4>
      <MotionSafe>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={id}
              key="body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="space-y-4 border-t border-border/70 px-4 py-4">{children}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </MotionSafe>
    </section>
  );
}

/* ------------------------------------------------------------------ numbers */

export const fmtUnits = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(value);
};

export const humanize = (code: string | null | undefined) =>
  (code ?? "").toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
