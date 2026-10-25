/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";

/**
 * Gate-chrome regression (24 Oct): the verification link printed on payroll documents (/verify/{id}) must open
 * without a session; before the fix the middleware sent the reader to the sign-in page.
 */
it("lets a visitor without a session open /verify/{id}, and only that path", () => {
  const verify = middleware(new NextRequest("http://localhost:3400/verify/6hLaljMMvl4BH9H7yNtDGJkf"));
  expect(verify.headers.get("location")).toBeNull();
  const otp = middleware(new NextRequest("http://localhost:3400/verify-otp"));
  expect(otp.headers.get("location")).toBeNull();
  const lookalike = middleware(new NextRequest("http://localhost:3400/verifyx"));
  expect(lookalike.headers.get("location")).toMatch(/\/login\?next=%2Fverifyx$/);
  const app = middleware(new NextRequest("http://localhost:3400/payroll/runs"));
  expect(app.headers.get("location")).toMatch(/\/login\?next=/);
});
