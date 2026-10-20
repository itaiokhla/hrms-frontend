
import { cookies, headers } from "next/headers";
import { cache } from "react";

import { FALLBACK_BRAND, type Brand } from "./brand";

const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");
const PROXY_KEY = process.env.PROXY_SHARED_SECRET || "";
export const PREVIEW_COOKIE = "hrms_brand_preview";
const HINT_COOKIE = "hrms_bh";

/** The real host of this request (the middleware replaces any client-sent value). */
export async function requestHost(): Promise<string> {
  const h = await headers();
  return (h.get("x-hrms-host") || h.get("host") || "").toLowerCase();
}

/**
 * The published brand for this request's host, fetched server-side before the first
 * byte is sent, so the first paint already uses it. Cached per host (and, on the
 * platform host, per signed-in tenant via the signed brand-hint cookie). Drafts are
 * only returned for a valid preview token and are never cached.
 */
export const getBrand = cache(async (): Promise<Brand> => {
  const host = await requestHost();
  const jar = await cookies();
  // The platform console is never white-labelled: no tenant hint or preview there.
  const platformConsole = ((await headers()).get("x-hrms-pathname") || "").startsWith("/platform");
  const hint = platformConsole ? "" : jar.get(HINT_COOKIE)?.value ?? "";
  const preview = platformConsole ? "" : jar.get(PREVIEW_COOKIE)?.value ?? "";
  const requestHeaders: Record<string, string> = { "x-hrms-host": host, "x-hrms-proxy-key": PROXY_KEY };
  if (hint) requestHeaders["x-hrms-brand-hint"] = hint;
  if (preview) requestHeaders["x-hrms-brand-preview"] = preview;
  // Host and hint are part of the URL so the data cache can never serve one host's brand to another.
  const url = `${BACKEND_URL}/api/v1/public/brand?h=${encodeURIComponent(host)}&b=${encodeURIComponent(hint)}`;
  try {
    const response = await fetch(url, {
      headers: requestHeaders,
      ...(preview ? { cache: "no-store" as const } : { next: { revalidate: 30, tags: [`brand:${host}`] } }),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`brand ${response.status}`);
    return (await response.json()) as Brand;
  } catch (error) {
    console.error("[brand] could not load the brand for", host, error);
    return FALLBACK_BRAND;
  }
});
