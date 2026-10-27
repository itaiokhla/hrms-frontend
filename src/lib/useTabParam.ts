"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * `?tab=` kept in the URL so a tab is bookmarkable; replace (not push) so Back leaves the page. An unknown value
 * falls back (LH BUG-24 `?tab=` validation). Promoted from payroll WageInputsWorkspace (LH-M0 WI-0.7).
 */
export function useTabParam<T extends string>(allowed: readonly T[], fallback: T): [T, (t: T) => void] {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = search?.get("tab") as T | null;
  const tab = raw && allowed.includes(raw) ? raw : fallback;
  const setTab = useCallback(
    (t: T) => {
      const next = new URLSearchParams(search?.toString() ?? "");
      next.set("tab", t);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [search, router, pathname],
  );
  return [tab, setTab];
}
