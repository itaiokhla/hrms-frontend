"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { ShiftRulePage } from "@/components/shifts/ShiftsWorkspace";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** One shift assignment rule (page twin of `?modal=shift-rule&id=`). */
export default function ShiftRuleDetailPage() {
  const params = useParams<{ rule_id: string }>();
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/attendance/shift-rules/[rule_id]"]}>
      <PayrollPage>
        <ShiftRulePage id={String(params?.rule_id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
