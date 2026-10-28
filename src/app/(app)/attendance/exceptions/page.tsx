"use client";

import { RequireAccess } from "@/components/access/Can";
import { ExceptionsView } from "@/components/attendance/days/ExceptionsView";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** Attendance exceptions (V2): decided days with exceptions in the viewer's scope (04-attendance/03 §12). */
export default function AttendanceExceptionsPage() {
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/attendance/exceptions"]}>
      <PayrollPage>
        <ExceptionsView />
      </PayrollPage>
    </RequireAccess>
  );
}
