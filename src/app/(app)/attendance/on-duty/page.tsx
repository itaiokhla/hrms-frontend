"use client";

import { RequireAccess } from "@/components/access/Can";
import { OnDutyWorkspace } from "@/components/attendance/requests/OnDutyWorkspace";
import { canAny } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

export default function OnDutyPage() {
  return (
    <RequireAccess check={(me) => canAny(me, [P.ATTENDANCE_REQUEST, P.ATTENDANCE_REQUEST_ON_BEHALF])}>
      <OnDutyWorkspace kind="ON_DUTY" />
    </RequireAccess>
  );
}
