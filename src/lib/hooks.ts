"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { toApiError, type ApiError } from "./api";

/** Minimal data-fetching hook: loading/error state, reload, and stale-response protection. */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = [], options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const requestId = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      if (id === requestId.current) setData(result);
      return result;
    } catch (err) {
      if (id === requestId.current) setError(toApiError(err));
      return undefined;
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return { data, error, loading, reload: run, setData };
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
