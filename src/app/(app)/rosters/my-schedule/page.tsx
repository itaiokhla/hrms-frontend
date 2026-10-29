"use client";

import { Suspense } from "react";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { MySchedule } from "@/components/rosters/MySchedule";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** My schedule (AS-M5): the signed-in employee's next two weeks of shifts, days off and unplanned days; AS-M6 adds
 * shift requests, open shifts and availability as `?tab=` tabs. */
export default function MySchedulePage() {
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/rosters/my-schedule"]}>
      <PayrollPage>
        <Suspense fallback={null}><MySchedule /></Suspense>
      </PayrollPage>
    </RequireAccess>
  );
}
