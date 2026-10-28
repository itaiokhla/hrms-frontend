"use client";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { TeamsWorkspace } from "@/components/teams/TeamsList";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** Teams (X-M1; X 01 §15.2): `team:read` beyond SELF ∨ `team:manage`. */
export default function TeamsPage() {
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/teams"]}>
      <PayrollPage>
        <TeamsWorkspace />
      </PayrollPage>
    </RequireAccess>
  );
}
