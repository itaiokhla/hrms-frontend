"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { RosterPeriodView } from "@/components/rosters/RosterPeriodView";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** One roster period: the Roster Grid with Save, Validate, Discard drafts and Publish. */
export default function RosterPeriodPage() {
  const params = useParams<{ period_id: string }>();
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/rosters/[period_id]"]}>
      <PayrollPage>
        <RosterPeriodView id={String(params?.period_id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
