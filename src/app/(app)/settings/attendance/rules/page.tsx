"use client";

import { RequireAccess } from "@/components/access/Can";
import { RulesPolicyEditor } from "@/components/attendance/days/RulesPolicyEditor";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** Settings › Attendance › Rules: draft, impact preview and activation of ATTENDANCE_RULES_POLICY (02 §4.3, §5.4). */
export default function AttendanceRulesSettingsPage() {
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/settings/attendance/rules"]}>
      <PayrollPage>
        <RulesPolicyEditor />
      </PayrollPage>
    </RequireAccess>
  );
}
