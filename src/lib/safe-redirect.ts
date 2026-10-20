/**
 * Where to continue after signing in: a path on this same origin, or the dashboard.
 *
 * The value is resolved with the browser's own URL parser, so tricks it would turn into another
 * host (`/\evil.example`, `/<tab>/evil.example`, encoded slashes) are refused rather than pattern
 * matched. Only the path, query and fragment of a same-origin URL are returned.
 */
export function safeNext(next: string | null | undefined, origin: string): string {
  const fallback = "/dashboard";
  if (!next || !next.startsWith("/")) return fallback;
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return fallback;
  }
  if (url.origin !== new URL(origin).origin) return fallback;
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
