"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useDebounced } from "@/lib/hooks";
import type { Employee, Page } from "@/lib/types";

export interface PickedEmployee {
  id: number;
  full_name: string;
  position?: string | null;
}

/**
 * Searchable employee selector. Results come from GET /employees, so the
 * list is automatically limited to the caller's authorized scope.
 */
export function EmployeePicker({
  value,
  onChange,
  placeholder = "Search employees…",
  excludeIds = [],
  allowClear = true,
  id,
  source = "/employees",
}: {
  value: PickedEmployee | null;
  onChange: (value: PickedEmployee | null) => void;
  placeholder?: string;
  excludeIds?: number[];
  allowClear?: boolean;
  id?: string;
  /** Endpoint to search; returns a page of employees or a plain list. */
  source?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Pick<Employee, "id" | "full_name" | "position" | "employee_code">[]>([]);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounced(query, 250);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    api
      .get<Page<Employee> | Employee[]>(source, { params: { q: debounced || undefined, limit: 8 } })
      .then((data) => {
        const items = Array.isArray(data) ? data : data.items;
        if (!cancelled) setResults(items.filter((e) => !excludeIds.includes(e.id)));
      })
      .catch(() => !cancelled && setResults([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, open]);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center gap-2 rounded-xl border border-input bg-surface px-3 text-left text-sm shadow-sm transition-colors hover:border-muted-foreground/40 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {value ? (
          <>
            <Avatar name={value.full_name} size={22} />
            <span className="flex-1 truncate">{value.full_name}</span>
          </>
        ) : (
          <span className="flex-1 text-muted-foreground/80">{placeholder}</span>
        )}
        {value && allowClear ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-lift"
          >
            <div className="border-b border-border p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a name, code or email"
                className="w-full rounded-lg bg-muted px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ul role="listbox" className="scrollbar-thin max-h-64 overflow-y-auto p-1">
              {loading && <li className="px-3 py-3 text-sm text-muted-foreground">Searching…</li>}
              {!loading && results.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No matches</li>}
              {!loading &&
                results.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={value?.id === e.id}
                      onClick={() => {
                        onChange({ id: e.id, full_name: e.full_name, position: e.position });
                        setOpen(false);
                        setQuery("");
                      }}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted",
                        value?.id === e.id && "bg-primary-soft",
                      )}
                    >
                      <Avatar name={e.full_name} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{e.full_name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {e.employee_code} · {e.position || "No title"}
                        </span>
                      </span>
                      {value?.id === e.id && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  </li>
                ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
