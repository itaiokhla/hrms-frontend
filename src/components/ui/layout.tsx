"use client";

import * as RadixTabs from "@radix-ui/react-tabs";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Inbox, Lock, Search } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import CountUp from "react-countup";

import { cn } from "@/lib/cn";

import { Button } from "./button";
import { Input } from "./field";
import { Card, MotionSafe, Skeleton } from "./primitives";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <MotionSafe>
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
    >
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </motion.div>
    </MotionSafe>
  );
}

export function StatCard({
  label,
  value,
  icon,
  tone = "primary",
  hint,
  format,
  delay = 0,
}: {
  label: string;
  value: number;
  icon?: ReactNode;
  tone?: "primary" | "success" | "warning" | "danger" | "info" | "accent";
  hint?: ReactNode;
  format?: (n: number) => string;
  delay?: number;
}) {
  const tones = {
    primary: "bg-primary-soft text-primary",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
    info: "bg-info-soft text-info",
    accent: "bg-accent/10 text-accent",
  };
  // CountUp animates with requestAnimationFrame, which the CSS reduced-motion override can't stop,
  // so with prefers-reduced-motion it shows the final value at once.
  const reduceMotion = useReducedMotion();
  return (
    <MotionSafe>
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3 }}
    >
      <Card className="group relative overflow-hidden p-5 transition-shadow hover:shadow-lift">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="mt-2 font-display text-3xl font-semibold tabular-nums">
              {/* Duration 0 jumps straight to the value and keeps server and client markup identical. */}
              <CountUp end={value} duration={reduceMotion ? 0 : 1.1} preserveValue formattingFn={format} />

            </p>
            {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
          </div>
          {icon && (
            <span
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:scale-110 [&>svg]:h-5 [&>svg]:w-5",
                tones[tone],
              )}
            >
              {icon}
            </span>
          )}
        </div>
      </Card>
    </motion.div>
    </MotionSafe>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <MotionSafe>
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground [&>svg]:h-6 [&>svg]:w-6">
        {icon ?? <Inbox />}
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
    </MotionSafe>
  );
}

export function AccessDenied({ message }: { message?: string }) {
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <EmptyState
        icon={<Lock />}
        title="You don't have access to this page"
        description={message ?? "Your role doesn't include the permissions this page needs. Ask your administrator if you need access."}
      />
    </Card>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      title="Couldn't load this"
      description={message}
      action={onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    />
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9"
        aria-label={placeholder}
        type="search"
      />
    </div>
  );
}

/* ---------------------------------------------------------------- Tabs */
export interface TabDef {
  value: string;
  label: ReactNode;
  badge?: number;
}

export function Tabs({
  tabs,
  value,
  onValueChange,
  children,
}: {
  tabs: TabDef[];
  value: string;
  onValueChange: (v: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <MotionSafe>
    <RadixTabs.Root value={value} onValueChange={onValueChange}>
      <RadixTabs.List className="scrollbar-thin mb-5 flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1 shadow-sm sm:inline-flex">
        {tabs.map((tab) => (
          <RadixTabs.Trigger
            key={tab.value}
            value={tab.value}
            className="relative flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground transition-colors data-[state=active]:text-foreground"
          >
            {value === tab.value && (
              <motion.span
                layoutId={`tab-${id}`}
                className="absolute inset-0 rounded-xl bg-primary-soft"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative">{tab.label}</span>
            {!!tab.badge && (
              <span className="relative rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                {tab.badge}
              </span>
            )}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {children}
    </RadixTabs.Root>
    </MotionSafe>
  );
}

export const TabPanel = ({ value, children }: { value: string; children: ReactNode }) => (
  <MotionSafe>
    <RadixTabs.Content value={value} asChild>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        {children}
      </motion.div>
    </RadixTabs.Content>
  </MotionSafe>
);

/* ---------------------------------------------------------------- Table */
export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  hideOnMobile?: boolean;
  /** Card mode: this column is the card's title (the first column when none is marked). */
  primary?: boolean;
  /** Card mode: leave this column out of the card. */
  hideInCard?: boolean;
  /** Server sort key of this column (X 04 §2.6); the header becomes a sort button. */
  sortKey?: string;
  /** Column chooser (X 04 §2.9): false = the identifier column, never hidden. */
  hideable?: boolean;
}

/** Row selection for bulk actions (X 04 §2.10): page-level header checkbox, labelled row checkboxes. */
export interface TableSelection<T> {
  isSelected: (row: T) => boolean;
  onToggle: (row: T, checked: boolean) => void;
  onTogglePage: (rows: T[], checked: boolean) => void;
  /** Accessible name of a row's checkbox, e.g. "Select Ravi Kumar, Mon 2 Nov 2026". */
  label: (row: T) => string;
}

function nextSort(current: string | undefined, key: string): string | undefined {
  if (current === key) return `-${key}`;
  if (current === `-${key}`) return undefined; // third click: back to the list default
  return key;
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  rowKey,
  onRowClick,
  empty,
  cardBelowMd,
  stickyHeader,
  caption,
  sort,
  onSortChange,
  selection,
  rowHref,
  busy,
  visibleColumns,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  /** Opt-in: below the md breakpoint each row renders as a card of label/value pairs (3.8 §10). */
  cardBelowMd?: boolean;
  /** Keep the header row visible while the page (or a height-limited parent) scrolls. */
  stickyHeader?: boolean;
  /** Accessible table name (visually hidden). */
  caption?: string;
  /** Server sort: "field" or "-field"; undefined = the list default. */
  sort?: string;
  onSortChange?: (sort: string | undefined) => void;
  selection?: TableSelection<T>;
  /** The row's overlay URL: the first cell becomes a real link (Ctrl/⌘-click opens it in a new tab). */
  rowHref?: (row: T) => string;
  /** Refetching: rows dim instead of turning into skeletons (X 04 §2.4 layout stability). */
  busy?: boolean;
  /** Keys of the columns to show, in order (column chooser); undefined = all. */
  visibleColumns?: string[];
}) {
  if (visibleColumns) {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    const pinned = columns.filter((c) => c.hideable === false && !visibleColumns.includes(c.key));
    columns = [...pinned, ...visibleColumns.map((k) => byKey.get(k)).filter((c): c is Column<T> => !!c)];
  }
  if (selection && rows) {
    const pageRows = rows;
    const all = pageRows.length > 0 && pageRows.every((r) => selection.isSelected(r));
    const some = !all && pageRows.some((r) => selection.isSelected(r));
    columns = [
      {
        key: "__select",
        className: "w-10",
        hideInCard: true,
        header: (
          <input
            type="checkbox"
            aria-label="Select all rows on this page"
            checked={all}
            ref={(el) => {
              if (el) el.indeterminate = some;
            }}
            onChange={(e) => selection.onTogglePage(pageRows, e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
        ),
        cell: (row: T) => (
          <input
            type="checkbox"
            aria-label={selection.label(row)}
            checked={selection.isSelected(row)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => selection.onToggle(row, e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
        ),
      },
      ...columns,
    ];
  }
  if (rowHref) {
    const [first, ...rest] = columns.filter((c) => c.key !== "__select");
    const linked: Column<T> = {
      ...first,
      cell: (row: T) => (
        <a
          href={rowHref(row)}
          className="font-medium text-foreground hover:underline focus-visible:underline"
          onClick={(e) => {
            // The row's own click handler must not also run: a modified click opens a new tab only.
            e.stopPropagation();
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1 || !onRowClick) return; // new tab / window
            e.preventDefault();
            onRowClick(row);
          }}
        >
          {first.cell(row)}
        </a>
      ),
    };
    columns = [...columns.filter((c) => c.key === "__select"), linked, ...rest];
  }
  if (loading && !rows?.length) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (!rows?.length) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  // Enter activates a clickable row; in card mode Space does too. Keys pressed on a button or
  // link inside the row stay with that control.
  const activate = (row: T) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || !onRowClick) return;
    if (e.key === "Enter" || (cardBelowMd && e.key === " ")) {
      e.preventDefault();
      onRowClick(row);
    }
  };
  const table = (
    <div
      className={cn(
        "scrollbar-thin",
        // A horizontally scrolling wrapper would trap a sticky header, so it only scrolls below md.
        stickyHeader ? "overflow-x-auto md:overflow-x-visible" : "overflow-x-auto",
        cardBelowMd && "hidden md:block",
      )}
    >
      <table className={cn("w-full text-sm transition-opacity", busy && "opacity-60")} aria-busy={busy || undefined}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className={cn(stickyHeader && "sticky top-0 z-10 bg-surface/95 backdrop-blur")}>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            {columns.map((c) => {
              const sortable = !!(c.sortKey && onSortChange);
              const direction = sortable && sort === c.sortKey ? "ascending" : sortable && sort === `-${c.sortKey}` ? "descending" : undefined;
              return (
                <th key={c.key} scope="col" aria-sort={direction}
                  className={cn("whitespace-nowrap px-4 py-3 font-medium", c.hideOnMobile && "hidden md:table-cell", c.className)}>
                  {sortable ? (
                    <button type="button" onClick={() => onSortChange!(nextSort(sort, c.sortKey!))}
                      className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground focus-visible:text-foreground">
                      {c.header}
                      {direction && <span aria-hidden>{direction === "ascending" ? "▲" : "▼"}</span>}
                    </button>
                  ) : c.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <motion.tr
              key={rowKey(row)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(index, 12) * 0.025 }}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? activate(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cn(
                "border-b border-border/60 last:border-0",
                onRowClick && "cursor-pointer transition-colors hover:bg-surface-muted focus:bg-surface-muted focus:outline-none",
              )}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn("px-4 py-3 align-middle", c.hideOnMobile && "hidden md:table-cell", c.className)}>
                  {c.cell(row)}
                </td>
              ))}
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  if (!cardBelowMd) return <MotionSafe>{table}</MotionSafe>;
  const titleColumn = columns.find((c) => c.primary) ?? columns[0];
  const detailColumns = columns.filter((c) => c !== titleColumn && !c.hideInCard);
  return (
    <MotionSafe>
      {table}
      <ul className="divide-y divide-border/60 md:hidden" aria-label={caption}>
        {rows.map((row, index) => (
          <motion.li
            key={rowKey(row)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: Math.min(index, 12) * 0.025 }}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            onKeyDown={onRowClick ? activate(row) : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            data-testid="datatable-card"
            className={cn(
              "min-h-[44px] px-4 py-3 text-sm",
              onRowClick && "cursor-pointer transition-colors hover:bg-surface-muted focus:bg-surface-muted focus:outline-none",
            )}
          >
            <div className="font-medium">{titleColumn.cell(row)}</div>
            {detailColumns.length > 0 && (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                {detailColumns.map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="text-xs text-muted-foreground">{c.header}</dt>
                    <dd className="min-w-0 text-end">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </motion.li>
        ))}
      </ul>
    </MotionSafe>
  );
}

export function Pagination({
  total,
  skip,
  limit,
  onChange,
  pageSizes,
  onLimitChange,
}: {
  total: number;
  skip: number;
  limit: number;
  onChange: (skip: number) => void;
  /** Offer these page sizes (e.g. [25, 50]); the bar then always shows, with the total. */
  pageSizes?: number[];
  onLimitChange?: (limit: number) => void;
}) {
  const sizes = pageSizes && onLimitChange ? pageSizes : null;
  if (total <= limit && !sizes) return null;
  const page = Math.floor(skip / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-4 py-3 text-sm text-muted-foreground">
      <span data-testid="pagination-range">
        {total === 0 ? "0 of 0" : `${skip + 1}–${Math.min(skip + limit, total)} of ${total}`}
      </span>
      <div className="flex items-center gap-1">
        {sizes && (
          <label className="mr-2 flex items-center gap-1.5">
            <span>Rows</span>
            <select
              aria-label="Rows per page"
              className="rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground"
              value={limit}
              onChange={(e) => onLimitChange?.(Number(e.target.value))}
            >
              {sizes.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
        <Button variant="ghost" size="icon" aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(skip - limit)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="px-2 tabular-nums">
          {page} / {pages}
        </span>
        <Button variant="ghost" size="icon" aria-label="Next page" disabled={page >= pages} onClick={() => onChange(skip + limit)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/** Animates children in sequence on mount. */
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <MotionSafe>
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
    >
      {children}
    </motion.div>
    </MotionSafe>
  );
}

export const StaggerItem = ({ children, className }: { children: ReactNode; className?: string }) => (
  <motion.div
    className={className}
    variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } } }}
  >
    {children}
  </motion.div>
);

/** Small live clock that only renders on the client (avoids hydration mismatch). */
export function LiveClock({ className }: { className?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();
  useEffect(() => {
    setNow(new Date());
    timer.current = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer.current);
  }, []);
  if (!now) return <span className={className}>&nbsp;</span>;
  return (
    <span className={cn("tabular-nums", className)} dir="ltr">
      {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}
