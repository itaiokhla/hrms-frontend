import { request } from "@playwright/test";

import { secrets } from "./support";

/** Fail fast with instructions when the isolated stack or the synthetic companies are missing. */
export default async function globalSetup() {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
  let s;
  try {
    s = secrets();
  } catch {
    throw new Error("No fixture credentials. In hrms-backend run: python scripts/seed_gps_e2e.py --api http://localhost:8100/api/v1");
  }
  const ctx = await request.newContext({ baseURL });
  const login = await ctx.post("/api/v1/auth/login", { data: { email: s.companies.alpha.emails.admin, password: s.password } }).catch(() => null);
  if (!login) throw new Error(`Frontend not reachable at ${baseURL}. Start it: NEXT_DIST_DIR=.next-e2e npx next start -p 3100`);
  if (login.status() !== 200) throw new Error(`Alpha admin cannot sign in (${login.status()}). Re-seed the GPS fixtures on a fresh stack.`);
  const today = await ctx.get("/api/v1/attendance/me/today");
  if ((await today.json()).attendance_state === undefined) throw new Error("The API on this stack predates the attendance/GPS release.");
  await ctx.dispose();
}
