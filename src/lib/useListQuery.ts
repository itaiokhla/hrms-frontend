"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * List state in the URL (X 04 §2.3): q, filters, sort, skip, limit and view. Changes use `router.replace` (no
 * history entry); defaults are never written (clean links); any filter, q, sort or view change resets skip; a limit
 * change keeps the first visible row on screen; invalid values are dropped. Overlay keys (`modal`, `id`, …) and the
 * host page's `tab` are left alone, so opening and closing a Sheet restores the list exactly.
 */
export const PAGE_SIZES = [25, 50] as const;

export interface ListQueryOptions {
  /** Filter keys this list understands (anything else in the URL is ignored). */
  filters: readonly string[];
  /** Allowed sort keys (ascending names; "-" prefix = descending). */
  sortKeys: readonly string[];
  /** Keys that hold several values (repeated parameters). */
  multi?: readonly string[];
  /** Debounce of the q parameter (ms). */
  debounce?: number;
}

export interface ListQuery {
  q: string;
  /** The search box's live text (q follows it after the debounce). */
  qInput: string;
  setQ: (text: string) => void;
  filters: Record<string, string | string[]>;
  setFilter: (key: string, value: string | string[] | null) => void;
  clearFilters: () => void;
  sort: string | undefined;
  setSort: (sort: string | undefined) => void;
  skip: number;
  setSkip: (skip: number) => void;
  limit: number;
  setLimit: (limit: number) => void;
  view: string | undefined;
  /** Select a view (or All with null): applies its stored query; explicit URL values are replaced. */
  selectView: (view: string | null, stored?: Record<string, unknown>) => void;
  /** API parameters: filters, q, sort, skip, limit, view_id (only non-default values). */
  params: Record<string, unknown>;
  /** Count of filter categories that differ from the default (X 04 §2.4 "Filters (n)"). */
  appliedCount: number;
}

const RESERVED = new Set(["q", "sort", "skip", "limit", "view"]);

export function useListQuery({ filters: filterKeys, sortKeys, multi = [], debounce = 300 }: ListQueryOptions): ListQuery {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const current = search?.toString() ?? "";

  const parsed = useMemo(() => {
    const p = new URLSearchParams(current);
    const filters: Record<string, string | string[]> = {};
    for (const key of filterKeys) {
      const values = p.getAll(key).filter((v) => v !== "");
      if (!values.length) continue;
      filters[key] = multi.includes(key) ? values : values[0];
    }
    const rawSort = p.get("sort") ?? undefined;
    const sort = rawSort && sortKeys.includes(rawSort.replace(/^-/, "")) ? rawSort : undefined;
    const rawLimit = Number(p.get("limit"));
    const limit = (PAGE_SIZES as readonly number[]).includes(rawLimit) ? rawLimit : PAGE_SIZES[0];
    const rawSkip = Number(p.get("skip"));
    const skip = Number.isInteger(rawSkip) && rawSkip > 0 && rawSkip % limit === 0 ? rawSkip : 0;
    const q = (p.get("q") ?? "").slice(0, 100);
    const view = p.get("view") ?? undefined;
    return { filters, sort, limit, skip, q, view, invalid: !!rawSort && !sort };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, filterKeys.join(","), sortKeys.join(","), multi.join(",")]);

  const write = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(search?.toString() ?? "");
      mutate(next);
      if (next.get("skip") === "0") next.delete("skip");
      if (next.get("limit") === String(PAGE_SIZES[0])) next.delete("limit");
      const qs = next.toString();
      if (qs === (search?.toString() ?? "")) return;
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, pathname, search],
  );

  // An unknown sort value is dropped from the URL (X 04 §2.2 rule 3).
  useEffect(() => {
    if (parsed.invalid) write((p) => p.delete("sort"));
  }, [parsed.invalid, write]);

  const [qInput, setQInput] = useState(parsed.q);
  const lastWritten = useRef(parsed.q);
  useEffect(() => {
    if (parsed.q !== lastWritten.current) {
      lastWritten.current = parsed.q;
      setQInput(parsed.q);
    }
  }, [parsed.q]);
  useEffect(() => {
    if (qInput === parsed.q) return;
    const timer = setTimeout(() => {
      lastWritten.current = qInput.trim();
      write((p) => {
        if (qInput.trim()) p.set("q", qInput.trim().slice(0, 100));
        else p.delete("q");
        p.delete("skip");
      });
    }, debounce);
    return () => clearTimeout(timer);
  }, [qInput, parsed.q, debounce, write]);

  const setFilter = useCallback(
    (key: string, value: string | string[] | null) =>
      write((p) => {
        p.delete(key);
        const values = value === null ? [] : Array.isArray(value) ? value : [value];
        values.filter((v) => v !== "").forEach((v) => p.append(key, v));
        p.delete("skip");
      }),
    [write],
  );

  const clearFilters = useCallback(
    () =>
      write((p) => {
        filterKeys.forEach((k) => p.delete(k));
        p.delete("q");
        p.delete("skip");
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [write, filterKeys.join(",")],
  );

  const setSort = useCallback(
    (sort: string | undefined) =>
      write((p) => {
        if (sort) p.set("sort", sort);
        else p.delete("sort");
        p.delete("skip");
      }),
    [write],
  );

  const setSkip = useCallback((skip: number) => write((p) => p.set("skip", String(Math.max(0, skip)))), [write]);

  const setLimit = useCallback(
    (limit: number) =>
      write((p) => {
        p.set("limit", String(limit));
        p.set("skip", String(Math.floor(parsed.skip / limit) * limit));
      }),
    [write, parsed.skip],
  );

  const selectView = useCallback(
    (view: string | null, stored: Record<string, unknown> = {}) =>
      write((p) => {
        filterKeys.forEach((k) => p.delete(k));
        ["q", "sort", "skip", "limit", "view"].forEach((k) => p.delete(k));
        if (view === null) return;
        p.set("view", view);
        for (const [key, value] of Object.entries(stored)) {
          if (key === "columns" || value === null || value === undefined || value === false) continue;
          if (!RESERVED.has(key) && !filterKeys.includes(key)) continue;
          (Array.isArray(value) ? value : [value]).forEach((v) => p.append(key, String(v)));
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [write, filterKeys.join(",")],
  );

  const params = useMemo(() => {
    const out: Record<string, unknown> = { ...parsed.filters, skip: parsed.skip, limit: parsed.limit };
    if (parsed.q) out.q = parsed.q;
    if (parsed.sort) out.sort = parsed.sort;
    if (parsed.view) out.view_id = parsed.view;
    return out;
  }, [parsed]);

  return {
    q: parsed.q,
    qInput,
    setQ: setQInput,
    filters: parsed.filters,
    setFilter,
    clearFilters,
    sort: parsed.sort,
    setSort,
    skip: parsed.skip,
    setSkip,
    limit: parsed.limit,
    setLimit,
    view: parsed.view,
    selectView,
    params,
    appliedCount: Object.keys(parsed.filters).length,
  };
}
