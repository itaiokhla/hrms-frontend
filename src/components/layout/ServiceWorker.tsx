"use client";

import { useEffect } from "react";

/** Registers /sw.js (offline punch page, browser push). Skipped where the browser has no service workers or the page
 * is not a secure context (localhost counts as secure). */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) return;
    if (process.env.NEXT_PUBLIC_DISABLE_SW === "1") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* a missing worker only disables offline punch and push */
    });
  }, []);
  return null;
}
