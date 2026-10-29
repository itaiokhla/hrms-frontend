"use client";

import { RequireAccess } from "@/components/access/Can";
import { ConsentPanel } from "@/components/attendance/ConsentPanel";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** Privacy & consents (AS 09-ui-ux/01: `/me/attendance/privacy`). */
export default function MyPrivacyPage() {
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/me/attendance/privacy"]}>
      <PayrollPage>
        <ConsentPanel />
      </PayrollPage>
    </RequireAccess>
  );
}
