"use client";

import { Suspense, type ReactNode } from "react";

import { RequireAccess } from "@/components/access/Can";
import { PageSkeleton } from "@/components/payroll/inputs/shared";
import { can } from "@/lib/access";
import { P } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";

/** Leave configuration pages: `leave:manage_policy` at any scope (the API narrows LE / BR holders). */
export const canConfigureLeave = (me: Me) => can(me, P.LEAVE_MANAGE_POLICY);

/** Setup and plans are also readable with company-wide `leave:read` (`require_plan_read`). */
export const canReadLeaveConfig = (me: Me) => can(me, P.LEAVE_MANAGE_POLICY) || can(me, P.LEAVE_READ, "COMPANY");

/**
 * Route shell of the leave admin pages: permission guard plus the Suspense boundary that `useSearchParams`
 * (`useModalRoute`, `useTabParam`) needs. The step-up prompt comes from the surrounding layout.
 */
export function LeaveAdminRoute({ check, children }: { check: (me: Me) => boolean; children: ReactNode }) {
  return (
    <RequireAccess check={check}>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </RequireAccess>
  );
}
