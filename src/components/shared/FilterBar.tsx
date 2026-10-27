"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/** One applied filter category shown as a chip ("Branch: Pune Plant ×"). */
export interface FilterChip {
  key: string;
  label: string;
  values: string[];
  /** Fixed chips (a single-value scope) cannot be removed. */
  fixed?: boolean;
}

export interface FilterBarProps {
  /** Saved-view tabs (`SavedViews`), always the first row (X 04 §2.8). */
  views?: ReactNode;
  /** Search over the list's q fields (server-side; X 04 §2.5). */
  search?: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string };
  /** Inline controls (one quick filter, date range) and the batch "Filters" panel trigger. */
  children?: ReactNode;
  /** Right-aligned tools (ColumnChooser, density). */
  tools?: ReactNode;
  chips?: FilterChip[];
  onRemoveChip?: (key: string) => void;
  onClearAll?: () => void;
  /** Server total of the current query; announced politely. */
  resultCount?: number;
  /** Extra content at the end of the chips row (Reset · Save · Save as new view… of a modified view). */
  chipsEnd?: ReactNode;
  className?: string;
}

/** The list FilterBar of X 04 §2.4: view tabs, labelled search, controls, chips with Clear all and a live count. */
export function FilterBar({ views, search, children, tools, chips = [], onRemoveChip, onClearAll, resultCount, chipsEnd,
  className }: FilterBarProps) {
  const searchId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const removable = chips.filter((c) => !c.fixed);
  return (
    <div className={cn("space-y-3 border-b border-border p-4", className)} role="search" aria-label="List filters">
      {views}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {search && (
          <div className="relative sm:w-72">
            <label htmlFor={searchId} className="sr-only">{search.label ?? "Search name or code"}</label>
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              id={searchId}
              ref={inputRef}
              type="search"
              value={search.value}
              autoComplete="off"
              placeholder={search.placeholder ?? "Search name or code…"}
              onChange={(e) => search.onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && search.value) {
                  e.preventDefault();
                  search.onChange("");
                }
              }}
              className="h-10 w-full rounded-xl border border-border bg-surface ps-9 pe-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </div>
        )}
        {children}
        {tools && <div className="flex items-center gap-2 sm:ms-auto">{tools}</div>}
      </div>
      {(chips.length > 0 || resultCount !== undefined || chipsEnd) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {chips.length > 0 && <span className="text-muted-foreground">Applied:</span>}
          {chips.map((chip) => (
            <span key={chip.key} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-2.5 py-1 text-xs">
              <span>
                {chip.label}: {chip.values.slice(0, 2).join(", ")}
                {chip.values.length > 2 ? ` +${chip.values.length - 2}` : ""}
              </span>
              {!chip.fixed && onRemoveChip && (
                <button type="button" aria-label={`Remove filter ${chip.label}`} onClick={() => onRemoveChip(chip.key)}
                  className="rounded-full p-0.5 hover:bg-border">
                  <X className="h-3 w-3" aria-hidden />
                </button>
              )}
            </span>
          ))}
          {removable.length > 0 && onClearAll && (
            <button type="button" onClick={onClearAll} className="text-xs font-medium text-primary hover:underline">
              Clear all
            </button>
          )}
          {chipsEnd}
          {resultCount !== undefined && (
            <span className="ms-auto text-xs text-muted-foreground" aria-live="polite" data-testid="result-count">
              {resultCount} {resultCount === 1 ? "result" : "results"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** The "Filters (n)" trigger of the batch panel (X 04 §2.4); `n` = applied categories. */
export function FiltersButton({ count, onClick, expanded }: { count: number; onClick: () => void; expanded?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={expanded}
      className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-muted">
      <SlidersHorizontal className="h-4 w-4" aria-hidden />
      Filters{count > 0 ? ` (${count})` : ""}
    </button>
  );
}
