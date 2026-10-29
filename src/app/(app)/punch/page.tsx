"use client";

import { RequireAccess } from "@/components/access/Can";
import { PunchScreen } from "@/components/attendance/PunchButton";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** `/punch` (AS 09-ui-ux/01 M1): the mobile punch page — one explicit-direction button, the live state, the location
 * notice, the site checks and the offline queue (AS-M12). Linked employee ∧ `attendance:mark`. */
export default function PunchPage() {
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/punch"]}>
      <PunchScreen />
    </RequireAccess>
  );
}
