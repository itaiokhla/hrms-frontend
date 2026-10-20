# HRMS Frontend (multi-tenant SaaS)

Next.js 15 (App Router) + TypeScript + Tailwind + framer-motion.

## How it talks to the API

The browser only ever calls this Next.js origin. Requests to `/api/v1/*` are
proxied to FastAPI (`next.config.ts`), so session cookies are first-party,
HttpOnly and never readable by JavaScript. State-changing requests carry the
double-submit CSRF header automatically (`src/lib/api.ts`).

```
BACKEND_URL=http://localhost:8000   # server-side only, see .env.local.example
```

## Access control in the UI

* `GET /api/v1/auth/me` returns the user's company, roles and **effective
  permissions with scopes**; nothing about identity is stored in the browser.
* Navigation (`src/lib/navigation.ts`), page guards (`RequireAccess`) and
  buttons (`<Can permission={P.X}>`) are derived from those permissions — never
  from role names, so custom roles just work.
* Permission codes come from `src/lib/permissions.generated.ts`, generated from
  the backend registry (`python scripts/export_permissions.py` in the backend).
* UI checks are for experience only. Every rule is enforced by the API.

## Scripts

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
npm test           # unit tests for permission semantics and navigation
npm run type-check
```

## Browser tests (Playwright, real Chrome)

`e2e/` drives the real app in Google Chrome across three companies and every
role: sign-up and invitations, login security (MFA, password reset, remote
sign-out), permission-trimmed navigation, hierarchy and org chart, leave
approval chains, face-verified attendance and the kiosk, payroll separation of
duties, assets, holidays, reports, audit, roles, tenant isolation probes and the
platform console. Each person gets their own window and video; a caption at the
bottom of the window narrates the current step.

1. Start a fresh, seeded backend (see the backend README, "Demo stack"):
   `python scripts/demo_stack.py --fresh`, then `python scripts/seed_demo.py`.
2. Serve the frontend: `npm run build && npm start` (the API proxy defaults to `http://localhost:8000`).
3. Run:
   ```bash
   npm run e2e:headed      # watch it in Chrome (E2E_SLOWMO=150 slows each action, in ms)
   npm run e2e             # headless
   npm run e2e:report      # HTML report with screenshots, traces and per-person videos
   ```

The suite changes data, so reset and reseed the backend before each full run;
`e2e/global-setup.ts` refuses to start on a used database. Options:
`E2E_BASE_URL` (default `http://localhost:3000`) and `E2E_BACKEND_LOG` (where
development emails with codes and invitation links are read from; default
`../hrms-backend/logs/demo-backend.log`). The webcam is a fake device streaming
`e2e/fixtures/face-stream.mjpeg` (public-domain photo, see `e2e/fixtures/README.md`).

### Attendance, lunch and location suite (`e2e-gps/`)

Three synthetic companies (Alpha, Beta, Gamma) on an isolated stack, in installed Google Chrome:
face-verified punches with location, lunch, the 2-minute *test-only* tracking schedule through route
changes, a second website, a frozen tab (Chrome's Page Lifecycle freeze) and same-tab navigation away,
two HRMS tabs, exceptions and manager review, offline retry, role revocation mid-shift, and
cross-company / cross-team probes with database assertions.

```bash
# hrms-backend: isolated stack + fixtures (see the backend README)
NEXT_DIST_DIR=.next-e2e BACKEND_URL=http://localhost:8100 npx next build
NEXT_DIST_DIR=.next-e2e npx next start -p 3100
npx playwright test -c playwright.gps.config.ts       # E2E_HEADLESS=1 for headless
```
Positions come from Chrome's geolocation emulation, so these runs verify the software, not real GPS
accuracy. Under automation Chrome keeps background tabs visible and un-throttled; real hidden-tab
throttling must be checked on a real device.

## Routes

| Area | Routes |
|---|---|
| Public | `/login`, `/signup` (create a company workspace), `/forgot-password` → `/verify-otp` → `/reset-password`, `/accept-invite` |
| Workspace | `/dashboard`, `/attendance`, `/leaves`, `/holidays`, `/payslips`, `/assets`, `/account` |
| People | `/employees`, `/organization` (org chart, secondary lines, delegations) |
| Operations | `/payroll`, `/kiosk`, `/reports` |
| Administration | `/users`, `/roles`, `/audit-logs`, `/settings` |
| Platform operators | `/platform/login`, `/platform` (tenants & subscriptions only) |

Links from the previous single-tenant app (e.g. `/auth/login`, `/employee/*`) redirect to the new routes.
