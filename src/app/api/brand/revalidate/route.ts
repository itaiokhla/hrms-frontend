import { revalidateTag } from "next/cache";

import { requestHost } from "@/lib/brand-server";

/**
 * Drop this host's cached brand so the next page render fetches the newly published one.
 * Only the caller's own host is affected and no data is returned, so it needs no
 * authentication (other hosts of the same tenant refresh within 30 seconds).
 */
export async function POST() {
  revalidateTag(`brand:${await requestHost()}`);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
