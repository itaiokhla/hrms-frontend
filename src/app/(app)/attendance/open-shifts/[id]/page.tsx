"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { OpenShiftDetail } from "@/components/rosters/requests/OpenShiftDetail";
import { api } from "@/lib/api";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";
import { useApi } from "@/lib/hooks";

function Detail({ id }: { id: string }) {
  const { data: branches } = useApi(() => api.get<{ id: number; name: string }[]>("/branches").catch(() => []), []);
  return <OpenShiftDetail id={id} branches={branches ?? []} />;
}

/** One open shift (A14 page twin, 03-shifts/03 §12.3): facts, the viewer's claim, and for planners the ranked claims. */
export default function OpenShiftPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/attendance/open-shifts/[id]"]}>
      <PayrollPage>
        <Detail id={String(params?.id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
