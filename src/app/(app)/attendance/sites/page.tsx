"use client";

import { RequireAccess } from "@/components/access/Can";
import { SitesWorkspace } from "@/components/attendance/Sites";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** Sites (AS 09-ui-ux/01 A20): geofences, office networks and QR posters. */
export default function SitesPage() {
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/attendance/sites"]}>
      <PayrollPage>
        <SitesWorkspace />
      </PayrollPage>
    </RequireAccess>
  );
}
