"use client";

import { Suspense } from "react";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage, WorkspaceHeader } from "@/components/payroll/inputs/shared";
import { OpenShiftsBoard } from "@/components/rosters/requests/ShiftRequestLists";
import { shiftsApi } from "@/components/shifts/api";
import { api } from "@/lib/api";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";
import { useApi } from "@/lib/hooks";

function Board() {
  const { data: branches } = useApi(() => api.get<{ id: number; name: string }[]>("/branches").catch(() => []), []);
  const { data: shifts } = useApi(() => shiftsApi.list({ limit: 100, status: "ACTIVE" })
    .then((p) => p.items.map((s) => ({ id: s.id, code: s.code ?? s.name }))).catch(() => []), []);
  return (
    <div>
      <WorkspaceHeader eyebrow="Attendance" title="Open shifts" showHideAmounts={false}
        description="Shifts that need someone: claim the ones you can take, or post and fill them for your team." />
      <OpenShiftsBoard branches={branches ?? []} shifts={shifts ?? []} />
    </div>
  );
}

/**
 * Open shifts (A14, 03-shifts/03 §12.3): one board for employees (`roster:request`, claimable shifts first,
 * SP-AS-045) and planners (`roster:plan`, Post / Claims / Cancel within their branch or team scope, FU-AS-49).
 */
export default function OpenShiftsPage() {
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/attendance/open-shifts"]}>
      <PayrollPage>
        <Suspense fallback={null}><Board /></Suspense>
      </PayrollPage>
    </RequireAccess>
  );
}
