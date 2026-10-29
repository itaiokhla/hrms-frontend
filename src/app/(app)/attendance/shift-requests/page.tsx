"use client";

import { Suspense } from "react";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage, WorkspaceHeader } from "@/components/payroll/inputs/shared";
import { AvailabilityPanel, OpenShiftsBoard, ShiftRequestApprovals } from "@/components/rosters/requests/ShiftRequestLists";
import { shiftsApi } from "@/components/shifts/api";
import { Tabs } from "@/components/ui/layout";
import { api } from "@/lib/api";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";
import { useApi } from "@/lib/hooks";
import { useTabParam } from "@/lib/useTabParam";

const TABS = ["approvals", "open", "availability"] as const;

function Workspace() {
  const [tab, setTab] = useTabParam(TABS, "approvals");
  const { data: branches } = useApi(() => api.get<{ id: number; name: string }[]>("/branches").catch(() => []), []);
  const { data: shifts } = useApi(() => shiftsApi.list({ limit: 100, status: "ACTIVE" })
    .then((p) => p.items.map((s) => ({ id: s.id, code: s.code ?? s.name }))).catch(() => []), []);
  return (
    <div>
      <WorkspaceHeader eyebrow="Attendance" title="Shift requests & open shifts" showHideAmounts={false}
        description="Approve swaps, changes and pickups; post open shifts; review availability." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof TABS)[number])} tabs={[
        { value: "approvals", label: "To approve" }, { value: "open", label: "Open shifts" },
        { value: "availability", label: "Availability" },
      ]}>
        <span />
      </Tabs>
      {tab === "approvals" && <ShiftRequestApprovals />}
      {tab === "open" && <OpenShiftsBoard branches={branches ?? []} shifts={shifts ?? []} />}
      {tab === "availability" && <AvailabilityPanel planner />}
    </div>
  );
}

/** Planners and approvers (AS-M6, 03-shifts/03 §12.3–§12.4): `roster:approve` ∨ `roster:plan`. */
export default function ShiftRequestsPage() {
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/attendance/shift-requests"]}>
      <PayrollPage>
        <Suspense fallback={null}><Workspace /></Suspense>
      </PayrollPage>
    </RequireAccess>
  );
}
