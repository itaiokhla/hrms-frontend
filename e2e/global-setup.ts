import { request } from "@playwright/test";

/** Fail fast with a clear message when the demo stack or seed data is missing. */
export default async function globalSetup() {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const ctx = await request.newContext({ baseURL });
  const health = await ctx.get("/api/v1/auth/me").catch(() => null);
  if (!health) {
    throw new Error(`Frontend not reachable at ${baseURL}. Run "npm run build && npm start" in hrms-frontend.`);
  }
  const login = await ctx.post("/api/v1/auth/login", {
    data: { email: "ananya.rao@nimbustech.io", password: "Demo@12345" },
  });
  if (login.status() !== 200) {
    throw new Error(
      "Seed data not found. In hrms-backend run: python scripts/demo_stack.py --fresh, then python scripts/seed_demo.py",
    );
  }
  const orbit = await ctx.post("/api/v1/auth/login", {
    data: { email: "daniel.dsouza@orbitlogistics.io", password: "Demo@12345" },
  });
  if (orbit.status() === 200) {
    throw new Error("Orbit Logistics already exists. Reset with: python scripts/demo_stack.py --fresh && python scripts/seed_demo.py");
  }
  await ctx.dispose();
}
