"use client";

import { RequireAccess } from "@/components/access/Can";
import { CutoverCard } from "@/components/attendance/days/CutoverCard";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** Settings › Attendance › Overview: status card and the attendance v2 cut-over (spine §15.1). */
export default function AttendanceOverviewSettingsPage() {
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/settings/attendance/overview"]}>
      <PayrollPage>
        <CutoverCard />
      </PayrollPage>
    </RequireAccess>
  );
}
