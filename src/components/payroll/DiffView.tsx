"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export type DiffKind = "added" | "removed" | "changed" | "unchanged";

export interface DiffRow {
  key: string;
  label: ReactNode;
  /** Pass `MaskedValue` / `MoneyText` for sensitive or money values. `null` = not set. */
  before: ReactNode;
  after: ReactNode;
  /** Defaults from the values: changed when both are strings or numbers and differ. */
  kind?: DiffKind;
}

const KIND: Record<Exclude<DiffKind, "unchanged">, { label: string; className: string }> = {
  added: { label: "Added", className: "bg-success-soft text-success" },
  removed: { label: "Removed", className: "bg-danger-soft text-danger" },
  changed: { label: "Changed", className: "bg-warning-soft text-warning" },
};

function kindOf(row: DiffRow): DiffKind {
  if (row.kind) return row.kind;
  const empty = (v: ReactNode) => v === null || v === undefined || v === "";
  if (empty(row.before) && !empty(row.after)) return "added";
  if (!empty(row.before) && empty(row.after)) return "removed";
  const simple = (v: ReactNode) => typeof v === "string" || typeof v === "number";
  if (simple(row.before) && simple(row.after)) return String(row.before) === String(row.after) ? "unchanged" : "changed";
  return "changed";
}

const Empty = () => <span className="text-muted-foreground">Not set</span>;

/**
 * Before/after for revisions, bank changes and settings (3.8 §7). Changes are labelled in words;
 * unchanged rows are hidden behind a toggle. Side by side from md, stacked on phones.
 */
export function DiffView({
  rows,
  beforeLabel = "Before",
  afterLabel = "After",
  className,
  caption = "Changes",
}: {
  rows: DiffRow[];
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
  caption?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const withKind = rows.map((row) => ({ row, kind: kindOf(row) }));
  const unchanged = withKind.filter((r) => r.kind === "unchanged").length;
  const visible = showAll ? withKind : withKind.filter((r) => r.kind !== "unchanged");
  return (
    <div className={cn("space-y-2", className)}>
      <table className="w-full border-separate border-spacing-0 overflow-hidden rounded-2xl border border-border text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="hidden bg-surface-muted md:table-header-group">
          <tr className="text-xs uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-4 py-2 text-start font-medium">
              Field
            </th>
            <th scope="col" className="px-4 py-2 text-start font-medium">
              {beforeLabel}
            </th>
            <th scope="col" className="px-4 py-2 text-start font-medium">
              {afterLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                No changes.
              </td>
            </tr>
          )}
          {visible.map(({ row, kind }) => (
            <tr key={row.key} className="block border-t border-border first:border-t-0 md:table-row" data-kind={kind}>
              <th scope="row" className="block px-4 pb-1 pt-3 text-start font-medium md:table-cell md:py-3">
                <span className="flex flex-wrap items-center gap-2">
                  {row.label}
                  {kind !== "unchanged" && (
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", KIND[kind].className)}>{KIND[kind].label}</span>
                  )}
                </span>
              </th>
              <td className="block px-4 py-1 md:table-cell md:py-3">
                <span className="me-2 text-xs text-muted-foreground md:hidden">{beforeLabel}:</span>
                <span className={cn(kind === "changed" || kind === "removed" ? "text-muted-foreground line-through decoration-muted-foreground/50" : "")}>
                  {row.before === null || row.before === undefined || row.before === "" ? <Empty /> : row.before}
                </span>
              </td>
              <td className="block px-4 pb-3 pt-1 md:table-cell md:py-3">
                <span className="me-2 text-xs text-muted-foreground md:hidden">{afterLabel}:</span>
                <span className={cn(kind !== "unchanged" && "font-medium")}>
                  {row.after === null || row.after === undefined || row.after === "" ? <Empty /> : row.after}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {unchanged > 0 && (
        <button type="button" className="min-h-[44px] text-sm font-medium text-primary hover:underline sm:min-h-0" onClick={() => setShowAll((v) => !v)} aria-pressed={showAll}>
          {showAll ? "Hide unchanged fields" : `Show ${unchanged} unchanged field${unchanged === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}
