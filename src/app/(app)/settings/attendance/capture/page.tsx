"use client";

import { RequireAccess } from "@/components/access/Can";
import { CapturePolicyEditor } from "@/components/attendance/capture/CapturePolicyEditor";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** Settings › Attendance › Capture methods & devices (AS 09-ui-ux/01 rail item 2; ATTENDANCE_CAPTURE_POLICY). */
export default function CaptureSettingsPage() {
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/settings/attendance/capture"]}>
      <PayrollPage>
        <CapturePolicyEditor />
      </PayrollPage>
    </RequireAccess>
  );
}
