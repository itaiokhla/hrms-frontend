"use client";

import { useParams } from "next/navigation";

import { NotFoundState } from "@/components/payroll/inputs/shared";
import { LeaveAdminRoute, canReadLeaveConfig } from "@/components/leave-admin/LeaveAdminRoute";
import { PlanBuilder } from "@/components/leave-admin/PlanBuilder";

/** Settings › Leave › Plans › {id} (03-leave/01 §11.5): the plan builder. */
export default function LeavePlanRoute() {
  const params = useParams<{ id: string }>();
  const id = params?.id && /^\d+$/.test(params.id) ? Number(params.id) : null;
  return (
    <LeaveAdminRoute check={canReadLeaveConfig}>
      {id ? <PlanBuilder planId={id} /> : <NotFoundState what="Leave plan" backHref="/settings/leave/plans" backLabel="Back to plans" />}
    </LeaveAdminRoute>
  );
}
