"use client";

import { LeaveRequestsList } from "@/components/leave/LeaveRequestsList";
import { LeaveWorkspace } from "@/components/leave/LeaveWorkspace";
import { canSeeLeaveRequests } from "@/lib/leave/routes";

/** Leave › Requests: Mine / Team (`leave:read` beyond SELF); the drawer is `?modal=leave&id=` (notification links). */
export default function LeaveRequestsRoute() {
  return (
    <LeaveWorkspace title="Leave requests" description="Drafts, requests waiting for approval and decided leave. Open one for its days, route and discussion." check={canSeeLeaveRequests}>
      <LeaveRequestsList />
    </LeaveWorkspace>
  );
}
