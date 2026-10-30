"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { RotationEditorPage } from "@/components/rotations/RotationEditor";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** One rotation pattern (A16 editor page): Pattern (versions, draft editor, activate) and Assignments as `?tab=`. */
export default function RotationPatternPage() {
  const params = useParams<{ pattern_id: string }>();
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/attendance/rotations/[pattern_id]"]}>
      <PayrollPage>
        <RotationEditorPage id={String(params?.pattern_id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
