"use client";

import { useCallback, useSyncExternalStore } from "react";

import { useSession } from "@/store/session";

/**
 * "Hide amounts" (3.8 §3.2): a per-user preference kept in this browser's localStorage, keyed by
 * user id so people sharing a device don't share it. Storage can be unavailable (private mode,
 * blocked site data) or throw; every access is wrapped and an in-memory value keeps the toggle
 * working for the rest of the session. All `MoneyText`s update together, also across tabs.
 */

const PREFIX = "hrms:payroll:hide-amounts:";
const memory = new Map<string, boolean>();
const listeners = new Set<() => void>();

export function hideAmountsKey(userId: number | string | null | undefined): string {
  return `${PREFIX}${userId ?? "anonymous"}`;
}

function read(key: string): boolean {
  if (memory.has(key)) return memory.get(key)!;
  let value = false;
  try {
    value = typeof window !== "undefined" && window.localStorage.getItem(key) === "1";
  } catch {
    value = false;
  }
  memory.set(key, value);
  return value;
}

function write(key: string, value: boolean) {
  memory.set(key, value);
  try {
    if (value) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable: the in-memory value still applies to this tab.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key && e.key.startsWith(PREFIX)) {
      memory.delete(e.key);
      listener();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** Test hook: forget cached values. */
export function __resetHideAmounts() {
  memory.clear();
}

export function useHideAmounts(): { hidden: boolean; setHidden: (value: boolean) => void; toggle: () => void } {
  const userId = useSession((s) => s.me?.user.id ?? null);
  const key = hideAmountsKey(userId);
  // The server render never hides (it can't read storage); the client re-renders with the preference.
  const hidden = useSyncExternalStore(subscribe, () => read(key), () => false);
  const setHidden = useCallback((value: boolean) => write(key, value), [key]);
  const toggle = useCallback(() => write(key, !read(key)), [key]);
  return { hidden, setHidden, toggle };
}
