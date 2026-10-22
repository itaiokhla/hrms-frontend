"use client";

import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { ExceptionList, type ExceptionSeverity, type PayrollExceptionItem } from "@/components/payroll/ExceptionList";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/hooks";
import { isConflict } from "@/lib/payroll/api";

import { runsApi } from "./api";
import { canResolveExceptions, useRun } from "./context";
import { ConflictBanner, Notice, fixHref, humanize } from "./shared";
import type { RunException } from "./types";

/** FLAG (variance) needs an acknowledgement, so it reads as a warning; the UI never shows it as fine. */
const SEVERITY: Record<string, ExceptionSeverity> = { BLOCKING: "BLOCKING", WARNING: "WARNING", FLAG: "WARNING" };

export const EXCEPTION_GROUP_LABELS: Record<string, string> = {
  NO_SALARY: "Without salary",
  MISSING_BANK: "No bank account",
  UNVERIFIED_BANK: "Unverified bank account",
  NET_VARIANCE: "Net pay change above the threshold",
  COMPONENT_VARIANCE: "Component change above the threshold",
  STATUTORY_NOT_VERIFIED: "Compliance not verified",
  UNMARKED_DAYS: "Unmarked days",
};

export function toExceptionItem(row: RunException, names?: Map<number, { name: string; code?: string }>): PayrollExceptionItem {
  const employee = row.employee_id ? names?.get(row.employee_id) : undefined;
  return {
    id: row.id,
    code: row.code,
    severity: SEVERITY[row.severity] ?? "INFO",
    message: row.message,
    employee: row.employee_id ? { id: row.employee_id, name: employee?.name ?? `Employee #${row.employee_id}`, code: employee?.code } : null,
    waivable: row.waivable && row.resolutions.includes("WAIVE"),
    deferrable: row.resolutions.includes("DEFER"),
    fixHref: fixHref(row.fix_link),
  };
}

/** Run › Exceptions (3.8 §5.3): grouped by code with Fix / Waive / Defer. */
export function ExceptionsTab() {
  const { run, me, version, reload } = useRun();
  const [status, setStatus] = useState<"OPEN" | "">("OPEN");
  const list = useApi(() => runsApi.exceptions(run.id, { status: status || undefined }), [run.id, status, version]);
  const names = useApi(() => runsApi.employees(run.id, { limit: 200 }).catch(() => null), [run.id, version]);
  const resolve = useModalRoute("exception", { keys: ["id", "action"] });
  const editable = canResolveExceptions(me, run);
  const nameMap = useMemo(() => {
    const map = new Map<number, { name: string; code?: string }>();
    (names.data?.items ?? []).forEach((r) => r.employee_name && map.set(r.employee_id, { name: r.employee_name, code: r.employee_code ?? undefined }));
    return map;
  }, [names.data]);
  const rows = list.data?.items ?? [];
  const items = rows.map((r) => toExceptionItem(r, nameMap));
  const open = (action: "fix" | "waive" | "defer") => (item: PayrollExceptionItem) => resolve.openModal({ id: item.id, action });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {editable ? "Fix the cause where it lives; waive or defer only what the rules allow." : "You can see exceptions; resolving them needs pay-run create access."}
        </p>
        <Field label="Show">
          <Select value={status} onChange={(e) => setStatus(e.target.value as "OPEN" | "")}>
            <option value="OPEN">Open</option>
            <option value="">All, including resolved</option>
          </Select>
        </Field>
      </div>
      {list.error ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : !list.data ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : status === "OPEN" ? (
        <ExceptionList
          items={items}
          groupLabels={EXCEPTION_GROUP_LABELS}
          onFix={editable ? open("fix") : undefined}
          onWaive={editable ? open("waive") : undefined}
          onDefer={editable ? open("defer") : undefined}
          empty={<EmptyState icon={<CheckCircle2 />} title="No open exceptions" description="Nothing blocks this run. Pre-checks and calculation add findings here." />}
        />
      ) : (
        <ResolvedList rows={rows} />
      )}
      <ResolveExceptionModal
        open={resolve.open}
        exception={rows.find((r) => String(r.id) === resolve.id) ?? null}
        loading={!list.data}
        action={(resolve.param("action") as "fix" | "waive" | "defer" | null) ?? "fix"}
        editable={editable}
        onOpenChange={resolve.onOpenChange}
        onDone={() => {
          void resolve.close();
          reload();
        }}
      />
    </div>
  );
}

function ResolvedList({ rows }: { rows: RunException[] }) {
  if (!rows.length) return <EmptyState title="No exceptions" />;
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
          <span>
            <span className="font-medium">{EXCEPTION_GROUP_LABELS[r.code] ?? humanize(r.code)}</span>
            <span className="block text-muted-foreground">{r.message}</span>
            {r.resolution_note && <span className="block text-xs text-muted-foreground">Note: {r.resolution_note}</span>}
          </span>
          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", r.status === "OPEN" ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground")}>
            {humanize(r.status)}
            {r.deferred_to ? ` · ${humanize(r.deferred_to)}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Resolve exception (3.8 §6, `?modal=exception&id=`): the Fix link, "Mark fixed" with a note,
 * Waive (reason; waivable only) and Defer (next period or retro; reason).
 */
export function ResolveExceptionModal({
  open,
  exception,
  loading,
  action,
  editable,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  exception: RunException | null;
  loading: boolean;
  action: "fix" | "waive" | "defer";
  editable: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState(action);
  const [text, setText] = useState("");
  const [to, setTo] = useState<"NEXT_PERIOD" | "RETRO">("NEXT_PERIOD");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (open) setMode(action);
    else {
      setText("");
      setTouched(false);
      setError(null);
      setTo("NEXT_PERIOD");
    }
  }, [open, action]);

  const canWaive = !!exception && exception.waivable && exception.resolutions.includes("WAIVE");
  const canDefer = !!exception && exception.resolutions.includes("DEFER");
  const effective = mode === "waive" && !canWaive ? "fix" : mode === "defer" && !canDefer ? "fix" : mode;
  const needsText = effective !== "fix";
  const missing = needsText && !text.trim();
  const href = fixHref(exception?.fix_link);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!exception || missing || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (effective === "waive") await runsApi.waive(exception.id, text.trim(), exception.row_version);
      else if (effective === "defer") await runsApi.defer(exception.id, to, text.trim(), exception.row_version);
      else await runsApi.fix(exception.id, text.trim() || null);
      toast.success(effective === "waive" ? "Exception waived" : effective === "defer" ? "Exception deferred" : "Marked as fixed — the next pre-check confirms it");
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title="Resolve exception"
      description={exception ? EXCEPTION_GROUP_LABELS[exception.code] ?? humanize(exception.code) : undefined}
      size="md"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {editable && exception && exception.status === "OPEN" && (
            <Button type="submit" form="exception-form" loading={busy} variant={effective === "waive" ? "danger" : "primary"}>
              {effective === "waive" ? "Waive" : effective === "defer" ? "Defer" : "Mark fixed"}
            </Button>
          )}
        </>
      }
    >
      {!exception ? (
        loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <p className="text-sm text-muted-foreground">This exception is not in the list any more; it may have been resolved.</p>
        )
      ) : (
        <form id="exception-form" onSubmit={submit} className="space-y-4" noValidate>
          <p className="text-sm">{exception.message}</p>
          {exception.blocks_finalization && <p className="text-sm font-medium text-danger">Blocks finalization until resolved.</p>}
          {href && (
            <Link href={href} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-primary hover:underline">
              Go to where this is fixed <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
            </Link>
          )}
          {editable && exception.status === "OPEN" && (
            <>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Resolution">
                {(["fix", "waive", "defer"] as const)
                  .filter((m) => m === "fix" || (m === "waive" ? canWaive : canDefer))
                  .map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={effective === m}
                      onClick={() => setMode(m)}
                      className={cn("min-h-[44px] rounded-xl border px-4 text-sm font-medium", effective === m ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-muted")}
                    >
                      {m === "fix" ? "Mark fixed" : m === "waive" ? "Waive" : "Defer"}
                    </button>
                  ))}
              </div>
              {effective === "defer" && (
                <Field label="Defer to">
                  <Select value={to} onChange={(e) => setTo(e.target.value as "NEXT_PERIOD" | "RETRO")}>
                    <option value="NEXT_PERIOD">The next pay period</option>
                    <option value="RETRO">A retro correction</option>
                  </Select>
                </Field>
              )}
              <Field label={needsText ? "Reason" : "Note (optional)"} required={needsText} error={touched && missing ? "Give a reason." : undefined}>
                <Textarea rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
            </>
          )}
          <ConflictBanner error={error} onReload={onDone} />
          {!!error && !isConflict(error) && (
            <Notice tone="danger" title="That didn't work">
              {errorMessage(error)}
            </Notice>
          )}
        </form>
      )}
    </Modal>
  );
}
