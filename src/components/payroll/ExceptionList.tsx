"use client";

import { AlertOctagon, AlertTriangle, ChevronDown, Info } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/layout";
import { cn } from "@/lib/cn";

export type ExceptionSeverity = "BLOCKING" | "WARNING" | "INFO";

export interface PayrollExceptionItem {
  id: string | number;
  code: string;
  severity: ExceptionSeverity;
  message: ReactNode;
  employee?: { id: string | number; name: string; code?: string } | null;
  /** Waive needs a reason; only waivable exceptions offer it. */
  waivable?: boolean;
  deferrable?: boolean;
  /** Where to fix it (a page the viewer may open); otherwise `onFix` is called. */
  fixHref?: string;
}

const SEVERITY: Record<ExceptionSeverity, { label: string; className: string; Icon: typeof Info; rank: number }> = {
  BLOCKING: { label: "Blocking", className: "bg-danger-soft text-danger", Icon: AlertOctagon, rank: 0 },
  WARNING: { label: "Warning", className: "bg-warning-soft text-warning", Icon: AlertTriangle, rank: 1 },
  INFO: { label: "Info", className: "bg-info-soft text-info", Icon: Info, rank: 2 },
};

export interface ExceptionListProps {
  items: PayrollExceptionItem[];
  onFix?: (item: PayrollExceptionItem) => void;
  onWaive?: (item: PayrollExceptionItem) => void;
  onDefer?: (item: PayrollExceptionItem) => void;
  /** Human titles per exception code ("Unmarked days"); falls back to the code in words. */
  groupLabels?: Record<string, string>;
  /** The item whose action is in flight (its buttons show a spinner). */
  busyId?: string | number | null;
  empty?: ReactNode;
  className?: string;
}

function humanize(code: string) {
  const text = code.replace(/_/g, " ").toLowerCase();
  return text[0]?.toUpperCase() + text.slice(1);
}

/** Exceptions grouped by code, most severe first, with Fix / Waive / Defer (3.8 §5.3). */
export function ExceptionList({ items, onFix, onWaive, onDefer, groupLabels, busyId, empty, className }: ExceptionListProps) {
  const groups = useMemo(() => {
    const map = new Map<string, PayrollExceptionItem[]>();
    items.forEach((item) => map.set(item.code, [...(map.get(item.code) ?? []), item]));
    return Array.from(map.entries())
      .map(([code, list]) => ({ code, list, rank: Math.min(...list.map((i) => SEVERITY[i.severity]?.rank ?? 2)) }))
      .sort((a, b) => a.rank - b.rank || b.list.length - a.list.length || a.code.localeCompare(b.code));
  }, [items]);
  if (!items.length) return <>{empty ?? <EmptyState title="No exceptions" description="Nothing needs attention in this run." />}</>;
  return (
    <div className={cn("space-y-3", className)}>
      {groups.map((g) => (
        <ExceptionGroup
          key={g.code}
          code={g.code}
          title={groupLabels?.[g.code] ?? humanize(g.code)}
          items={g.list}
          onFix={onFix}
          onWaive={onWaive}
          onDefer={onDefer}
          busyId={busyId}
        />
      ))}
    </div>
  );
}

function ExceptionGroup({
  code,
  title,
  items,
  onFix,
  onWaive,
  onDefer,
  busyId,
}: {
  code: string;
  title: string;
  items: PayrollExceptionItem[];
  onFix?: (item: PayrollExceptionItem) => void;
  onWaive?: (item: PayrollExceptionItem) => void;
  onDefer?: (item: PayrollExceptionItem) => void;
  busyId?: string | number | null;
}) {
  const id = useId();
  const [open, setOpen] = useState(true);
  const worst = items.reduce<ExceptionSeverity>((w, i) => (SEVERITY[i.severity].rank < SEVERITY[w].rank ? i.severity : w), "INFO");
  const sev = SEVERITY[worst];
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface" aria-labelledby={`${id}-h`} data-code={code}>
      <h3 id={`${id}-h`} className="m-0">
        <button
          type="button"
          className="flex min-h-[44px] w-full items-center gap-3 px-4 py-3 text-start hover:bg-surface-muted"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", sev.className)}>
            <sev.Icon className="h-3.5 w-3.5" aria-hidden />
            {sev.label}
          </span>
          <span className="flex-1 text-sm font-semibold">
            {title} <span className="font-normal text-muted-foreground">({items.length})</span>
          </span>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </h3>
      {open && (
        <ul id={`${id}-list`} className="divide-y divide-border/60 border-t border-border">
          {items.map((item) => {
            const busy = busyId !== null && busyId !== undefined && busyId === item.id;
            const who = <span className="sr-only"> {item.employee?.name ?? title}</span>;
            return (
              <li key={item.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-sm">
                  {item.employee && (
                    <p className="font-medium">
                      {item.employee.name}
                      {item.employee.code && <span className="ms-1.5 text-xs text-muted-foreground">{item.employee.code}</span>}
                    </p>
                  )}
                  <div className="text-muted-foreground">{item.message}</div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {item.fixHref ? (
                    <Link
                      href={item.fixHref}
                      className="inline-flex h-11 items-center rounded-xl bg-primary px-3 text-xs font-medium text-primary-foreground sm:h-8"
                    >
                      Fix
                      {who}
                    </Link>
                  ) : (
                    onFix && (
                      <Button size="sm" className="h-11 sm:h-8" loading={busy} onClick={() => onFix(item)}>
                        Fix
                        {who}
                      </Button>
                    )
                  )}
                  {item.waivable && onWaive && (
                    <Button size="sm" variant="secondary" className="h-11 sm:h-8" disabled={busy} onClick={() => onWaive(item)}>
                      Waive
                      {who}
                    </Button>
                  )}
                  {item.deferrable && onDefer && (
                    <Button size="sm" variant="ghost" className="h-11 sm:h-8" disabled={busy} onClick={() => onDefer(item)}>
                      Defer
                      {who}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
