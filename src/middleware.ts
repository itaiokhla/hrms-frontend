import { NextResponse, type NextRequest } from "next/server";

/**
 * 1. Host trust boundary. Every request (pages and the /api/v1 proxy to FastAPI) gets
 *    X-HRMS-Host set from the real Host header plus the shared proxy key; any
 *    client-sent copies are dropped first. FastAPI trusts the host only with the key.
 * 2. Brand preview: ?brand_preview=<token> becomes a short-lived HttpOnly cookie so the
 *    server-rendered layout can paint the draft; ?brand_preview=off ends the preview.
 * 3. The platform console exists only on platform hosts; workspaces are created there too.
 * 4. UX-only routing to the login page for visitors without a session cookie. The API
 *    enforces authorization on every request; this is not a security boundary.
 */
const PUBLIC = [
  "/login", "/signup", "/forgot-password", "/verify-otp", "/reset-password", "/accept-invite", "/platform", "/auth/handoff",
  "/manifest.webmanifest",
];
const PLATFORM_HOSTS = (process.env.PLATFORM_HOSTS || "localhost,127.0.0.1")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
const PROXY_KEY = process.env.PROXY_SHARED_SECRET || "";
const INTERNAL_HEADERS = ["x-hrms-host", "x-hrms-proxy-key", "x-hrms-pathname", "x-hrms-brand-hint", "x-hrms-brand-preview"];
const PREVIEW_COOKIE = "hrms_brand_preview";

function hostname(host: string): string {
  return host.replace(/:\d+$/, "").replace(/\.$/, "");
}

export function middleware(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;
  const rawHost = (request.headers.get("host") || "").toLowerCase();
  const host = hostname(rawHost);
  const isPlatformHost = PLATFORM_HOSTS.includes(host);

  const forwarded = new Headers(request.headers);
  INTERNAL_HEADERS.forEach((name) => forwarded.delete(name));
  forwarded.set("x-hrms-host", rawHost);
  if (PROXY_KEY) forwarded.set("x-hrms-proxy-key", PROXY_KEY);
  forwarded.set("x-hrms-pathname", pathname + search);
  const pass = () => {
    const response = NextResponse.next({ request: { headers: forwarded } });
    response.headers.set("Vary", "Host, Cookie");
    return response;
  };

  if (pathname.startsWith("/api/")) return pass();

  if ((pathname === "/platform" || pathname.startsWith("/platform/")) && !isPlatformHost) {
    return new NextResponse("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }
  if (pathname === "/signup" && !isPlatformHost) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const preview = searchParams.get("brand_preview");
  if (preview) {
    const url = request.nextUrl.clone();
    url.searchParams.delete("brand_preview");
    const response = NextResponse.redirect(url);
    if (preview === "off" || !/^[A-Za-z0-9._-]{20,2048}$/.test(preview)) {
      response.cookies.delete(PREVIEW_COOKIE);
    } else {
      response.cookies.set(PREVIEW_COOKIE, preview, {
        httpOnly: true, sameSite: "lax", path: "/", maxAge: 15 * 60, secure: request.nextUrl.protocol === "https:",
      });
    }
    return response;
  }

  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return pass();
  const hasSession = request.cookies.has("hrms_access") || request.cookies.has("hrms_csrf");
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }
  return pass();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
