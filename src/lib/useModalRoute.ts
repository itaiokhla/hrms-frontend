"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useConfirm } from "@/components/ui/overlay";

export interface UseModalRouteOptions {
  /** Query keys that belong to this modal besides `modal` (default ["id"]), e.g. ["employee"] or ["run"]. */
  keys?: string[];
  /** Unsaved changes: closing (×, Esc, outside click, Cancel or browser Back) asks "Discard changes?". */
  dirty?: boolean;
}

export interface ModalRoute {
  open: boolean;
  /** `?id=` (or the first configured key). */
  id: string | null;
  /** Read any query value, e.g. `param("employee")`. */
  param: (key: string) => string | null;
  /** Push `?modal=name&…` so browser Back closes the modal first. */
  openModal: (params?: Record<string, string | number | null | undefined>) => void;
  /** Close, removing the modal's params (asks first when dirty). Resolves false if the person kept editing. */
  close: (options?: { force?: boolean }) => Promise<boolean>;
  /** For `Modal onOpenChange`. */
  onOpenChange: (open: boolean) => void;
}

const DISCARD = {
  title: "Discard changes?",
  message: "Your changes in this dialog haven't been saved.",
  confirmLabel: "Discard",
  cancelLabel: "Keep editing",
  tone: "danger" as const,
};

/**
 * Deep-linkable modals (D-12, 3.8 §6): `?modal=<name>&id=…` opens the modal; closing removes the
 * params; browser Back closes the modal first; a dirty form asks before it is discarded.
 * Pages using it render inside `<Suspense>` (Next 15 requires it for `useSearchParams`).
 */
export function useModalRoute(name: string, { keys = ["id"], dirty = false }: UseModalRouteOptions = {}): ModalRoute {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const confirm = useConfirm();
  const urlOpen = search?.get("modal") === name;

  // Did this tab push the modal URL? Then closing goes Back (no duplicate history entry).
  const pushedHere = useRef(false);
  const closing = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const lastOpenUrl = useRef<string | null>(null);
  // Keeps a dirty modal on screen while "Discard changes?" is asked after browser Back.
  const [held, setHeld] = useState(false);

  const current = search?.toString() ?? "";
  const lastParams = useRef<URLSearchParams | null>(null);
  if (urlOpen) {
    lastOpenUrl.current = `${pathname}${current ? `?${current}` : ""}`;
    lastParams.current = new URLSearchParams(current);
  }
  // While held open after Back, the modal keeps reading the params it was opened with.
  const source = urlOpen ? search : held ? lastParams.current : null;

  const urlWithout = useCallback(() => {
    const next = new URLSearchParams(search?.toString() ?? "");
    next.delete("modal");
    keys.forEach((k) => next.delete(k));
    const qs = next.toString();
    return `${pathname}${qs ? `?${qs}` : ""}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search, keys.join(",")]);

  const openModal = useCallback(
    (params: Record<string, string | number | null | undefined> = {}) => {
      const next = new URLSearchParams(search?.toString() ?? "");
      next.set("modal", name);
      keys.forEach((k) => next.delete(k));
      Object.entries(params).forEach(([k, v]) => {
        if (v !== null && v !== undefined && v !== "") next.set(k, String(v));
      });
      pushedHere.current = true;
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, pathname, search, name, keys.join(",")],
  );

  const close = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    // `force`: the form was just saved, so nothing is discarded (the dirty flag may not have re-rendered yet).
    if (force) dirtyRef.current = false;
    if (dirtyRef.current && !(await confirm(DISCARD))) return false;
    closing.current = true;
    if (pushedHere.current) {
      pushedHere.current = false;
      router.back();
    } else {
      router.replace(urlWithout(), { scroll: false });
    }
    return true;
  }, [confirm, router, urlWithout]);

  // Browser Back (or any navigation) removed the params while the form was dirty: ask first.
  const wasOpen = useRef(urlOpen);
  useEffect(() => {
    const before = wasOpen.current;
    wasOpen.current = urlOpen;
    if (urlOpen) {
      closing.current = false;
      return;
    }
    if (!before) return;
    pushedHere.current = false;
    if (closing.current) {
      closing.current = false;
      return;
    }
    if (!dirtyRef.current) return;
    setHeld(true);
    const reopen = lastOpenUrl.current;
    void confirm(DISCARD).then((discard) => {
      if (!discard && reopen) {
        pushedHere.current = true;
        router.push(reopen, { scroll: false });
      }
      setHeld(false);
    });
  }, [urlOpen, confirm, router]);

  const param = useCallback((key: string) => source?.get(key) ?? search?.get(key) ?? null, [source, search]);

  return {
    open: urlOpen || held,
    id: source?.get(keys[0] ?? "id") ?? null,
    param,
    openModal,
    close,
    onOpenChange: (o: boolean) => {
      if (!o) void close();
    },
  };
}
