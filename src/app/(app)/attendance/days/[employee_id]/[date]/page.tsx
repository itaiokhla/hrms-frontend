"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { AttendanceDayView } from "@/components/attendance/days/AttendanceDayView";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** One evaluated day (V2): result, halves, time, marks and history (twin of the `att-day` Sheet). */
export default function AttendanceDayPage() {
  const params = useParams<{ employee_id: string; date: string }>();
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/attendance/days/[employee_id]/[date]"]}>
      <PayrollPage>
        <AttendanceDayView employeeId={String(params?.employee_id ?? "")} date={String(params?.date ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
