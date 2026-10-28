"use client";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { RosterPeriodsWorkspace } from "@/components/rosters/RosterPeriods";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** Rosters (AS-M5; 03-shifts/02 §13): roster periods, `roster:plan` ∨ `roster:publish` ∨ `roster:read` beyond SELF. */
export default function RostersPage() {
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/rosters"]}>
      <PayrollPage>
        <RosterPeriodsWorkspace />
      </PayrollPage>
    </RequireAccess>
  );
}
