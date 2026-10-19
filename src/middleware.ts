import { NextResponse, type NextRequest } from "next/server";

/**
 * UX-only routing: send visitors without a session cookie straight to the
 * login page instead of flashing the app shell. Authorization is enforced by
 * the API on every request; this middleware is not a security boundary.
 */
const PUBLIC = ["/login", "/signup", "/forgot-password", "/verify-otp", "/reset-password", "/accept-invite", "/platform"];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
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
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
