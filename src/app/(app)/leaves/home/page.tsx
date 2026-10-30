"use client";

import { LeaveHome } from "@/components/leave/LeaveHome";
import { LeaveWorkspace } from "@/components/leave/LeaveWorkspace";

/** Leave › Overview (leave v2): balances, next leave, approvals waiting, who is away; `?modal=apply-leave`. */
export default function LeaveHomeRoute() {
  return (
    <LeaveWorkspace title="Leave overview" description="Your balances, what is coming up and who is away today.">
      <LeaveHome />
    </LeaveWorkspace>
  );
}
