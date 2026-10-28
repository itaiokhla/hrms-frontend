"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { TeamDetailView } from "@/components/teams/TeamDetail";
import { ErrorState } from "@/components/ui/layout";
import { ATTENDANCE_ROUTE_GUARDS, isIdSegment } from "@/lib/attendance-routes";

/** One team (page twin of X 01 §15.2): Details with Edit / Archive and Members as `?tab=`. */
export default function TeamDetailPage() {
  const params = useParams<{ team_id: string }>();
  const id = String(params?.team_id ?? "");
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/teams/[team_id]"]}>
      <PayrollPage>
        {isIdSegment(id) ? <TeamDetailView id={id} /> : <ErrorState message="This team doesn't exist." />}
      </PayrollPage>
    </RequireAccess>
  );
}
