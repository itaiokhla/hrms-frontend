"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { ShiftPage } from "@/components/shifts/ShiftsWorkspace";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** One shift (page twin of `?modal=shift&id=`): Details, Versions and Rules as `?tab=`. */
export default function ShiftDetailPage() {
  const params = useParams<{ shift_id: string }>();
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/attendance/shifts/[shift_id]"]}>
      <PayrollPage>
        <ShiftPage id={String(params?.shift_id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
