import { cookies, headers } from "next/headers";
import { cache } from "react";

import { FALLBACK_BRAND, type Brand } from "./brand";

const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");
const PROXY_KEY = process.env.PROXY_SHARED_SECRET || "";
export const PREVIEW_COOKIE = "hrms_brand_preview";
const HINT_COOKIE = "hrms_bh";

/**
 * A strict, short-lived cache per host (and signed-in tenant hint). Entries are never served
 * after they expire: Next's fetch cache would serve one stale response while revalidating and
 * keeps entries on disk across restarts, which after a domain moves to another tenant could
 * paint the previous tenant's brand once. The API keeps its own invalidated caches behind this.
 */
const TTL_MS = 5_000;
const memo = new Map<string, { at: number; brand: Brand }>();

export function forgetBrand(host: string) {
  for (const key of memo.keys()) if (key.startsWith(`${host}|`)) memo.delete(key);
}

/** The real host of this request (the middleware replaces any client-sent value). */
export async function requestHost(): Promise<string> {
  const h = await headers();
  return (h.get("x-hrms-host") || h.get("host") || "").toLowerCase();
}

/**
 * The published brand for this request's host, fetched server-side before the first byte is
 * sent, so the first paint already uses it. On the platform host the signed brand-hint cookie
 * selects the signed-in tenant's brand. Drafts are only returned for a valid preview token and
 * are never cached.
 */
export const getBrand = cache(async (): Promise<Brand> => {
  const host = await requestHost();
  const jar = await cookies();
  // The platform console is never white-labelled: no tenant hint or preview there.
  const platformConsole = ((await headers()).get("x-hrms-pathname") || "").startsWith("/platform");
  const hint = platformConsole ? "" : jar.get(HINT_COOKIE)?.value ?? "";
  const preview = platformConsole ? "" : jar.get(PREVIEW_COOKIE)?.value ?? "";
  const key = `${host}|${hint}`;
  if (!preview) {
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.brand;
  }
  const requestHeaders: Record<string, string> = { "x-hrms-host": host, "x-hrms-proxy-key": PROXY_KEY };
  if (hint) requestHeaders["x-hrms-brand-hint"] = hint;
  if (preview) requestHeaders["x-hrms-brand-preview"] = preview;
  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/public/brand`, {
      headers: requestHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`brand ${response.status}`);
    const brand = (await response.json()) as Brand;
    if (!preview) {
      if (memo.size > 5000) memo.clear();
      memo.set(key, { at: Date.now(), brand });
    }
    return brand;
  } catch (error) {
    console.error("[brand] could not load the brand for", host, error);
    return FALLBACK_BRAND;
  }
});
