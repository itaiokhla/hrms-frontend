"use client";

import { LeaveApprovalsInbox } from "@/components/leave/LeaveApprovalsInbox";
import { LeaveWorkspace } from "@/components/leave/LeaveWorkspace";
import { canUseLeave } from "@/lib/leave/routes";

/**
 * Leave › Approvals: requests, changes, comp-off claims and encashments waiting for the viewer (`?tab=`). Open to
 * every leave user: delegates act without holding `leave:approve` themselves, and an empty inbox says so.
 */
export default function LeaveApprovalsRoute() {
  return (
    <LeaveWorkspace title="Leave approvals" description="Everything waiting for your decision. Rejecting or returning asks for a reason the employee sees." check={canUseLeave}>
      <LeaveApprovalsInbox />
    </LeaveWorkspace>
  );
}
