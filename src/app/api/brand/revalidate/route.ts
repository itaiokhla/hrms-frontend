import { forgetBrand, requestHost } from "@/lib/brand-server";

/**
 * Drop this server's cached brand for the caller's own host so the next page render fetches
 * the newly published one. Only that host is affected and nothing is returned, so it needs no
 * authentication (other hosts and server instances refresh within five seconds).
 */
export async function POST() {
  forgetBrand(await requestHost());
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
