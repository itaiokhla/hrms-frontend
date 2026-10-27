"use client";

import * as Popover from "@radix-ui/react-popover";
import { ArrowDown, ArrowUp, Columns } from "lucide-react";

/**
 * The "Columns" popover (X 04 §2.9): one checkbox per optional column, Move up / Move down per row (never drag
 * only), Reset to default. The identifier column is not listed (it is always first and cannot be hidden).
 */
export function ColumnChooser({ columns, visible, onChange, defaults }: {
  /** Optional columns: key and visible label. */
  columns: { key: string; label: string }[];
  /** Keys shown, in order. */
  visible: string[];
  onChange: (visible: string[]) => void;
  defaults: string[];
}) {
  const ordered = [...visible, ...columns.map((c) => c.key).filter((k) => !visible.includes(k))];
  const label = (key: string) => columns.find((c) => c.key === key)?.label ?? key;
  const move = (key: string, by: number) => {
    const next = [...visible];
    const from = next.indexOf(key);
    const to = from + by;
    if (from < 0 || to < 0 || to >= next.length) return;
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-muted">
          <Columns className="h-4 w-4" aria-hidden /> Columns
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-72 rounded-2xl border border-border bg-surface p-3 shadow-lift">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Columns</legend>
            <ul className="space-y-1">
              {ordered.map((key) => {
                const shown = visible.includes(key);
                const index = visible.indexOf(key);
                return (
                  <li key={key} className="flex items-center gap-2">
                    <label className="flex flex-1 items-center gap-2 text-sm">
                      <input type="checkbox" checked={shown} className="h-4 w-4 accent-primary"
                        onChange={(e) => onChange(e.target.checked ? [...visible, key] : visible.filter((k) => k !== key))} />
                      {label(key)}
                    </label>
                    <button type="button" aria-label={`Move ${label(key)} up`} disabled={!shown || index === 0}
                      onClick={() => move(key, -1)} className="rounded p-1 hover:bg-surface-muted disabled:opacity-30">
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button type="button" aria-label={`Move ${label(key)} down`} disabled={!shown || index === visible.length - 1}
                      onClick={() => move(key, 1)} className="rounded p-1 hover:bg-surface-muted disabled:opacity-30">
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <button type="button" onClick={() => onChange(defaults)} className="mt-3 text-xs font-medium text-primary hover:underline">
            Reset to default
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
