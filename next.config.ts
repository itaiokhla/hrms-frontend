import type { NextConfig } from "next";

// The browser always talks to this Next.js origin; requests under /api/v1 are
// proxied to FastAPI. Auth cookies therefore stay first-party (HttpOnly,
// SameSite=Lax) and no API origin needs to be exposed to the client.
const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  typescript: { ignoreBuildErrors: false },
  images: { unoptimized: true },
  async rewrites() {
    return {
      beforeFiles: [{ source: "/api/v1/:path*", destination: `${BACKEND_URL}/api/v1/:path*` }],
    };
  },
  async redirects() {
    // Keep links from the previous single-tenant app working.
    return [
      { source: "/auth/login", destination: "/login", permanent: true },
      { source: "/auth/signup", destination: "/signup", permanent: true },
      { source: "/auth/register", destination: "/signup", permanent: true },
      { source: "/auth/forgot-password", destination: "/forgot-password", permanent: true },
      { source: "/auth/verify-otp", destination: "/verify-otp", permanent: true },
      { source: "/auth/reset-password", destination: "/reset-password", permanent: true },
      { source: "/employee/dashboard", destination: "/dashboard", permanent: true },
      { source: "/employee/attendance", destination: "/attendance", permanent: true },
      { source: "/employee/leaves", destination: "/leaves", permanent: true },
      { source: "/employee/profile", destination: "/account", permanent: true },
      { source: "/employee/salary", destination: "/payslips", permanent: true },
      { source: "/employee/assets", destination: "/assets", permanent: true },
      { source: "/attendance-dashboard", destination: "/attendance", permanent: true },
      { source: "/face-recognition", destination: "/kiosk", permanent: true },
      { source: "/salary-structure", destination: "/payroll?tab=structures", permanent: true },
      { source: "/dashboard/audit-logs", destination: "/audit-logs", permanent: true },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
