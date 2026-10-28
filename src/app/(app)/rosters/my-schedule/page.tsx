"use client";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { MySchedule } from "@/components/rosters/MySchedule";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** My schedule (AS-M5): the signed-in employee's next two weeks of shifts, days off and unplanned days. */
export default function MySchedulePage() {
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/rosters/my-schedule"]}>
      <PayrollPage>
        <MySchedule />
      </PayrollPage>
    </RequireAccess>
  );
}
