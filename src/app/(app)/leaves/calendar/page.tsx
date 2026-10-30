"use client";

import { LeaveWorkspace } from "@/components/leave/LeaveWorkspace";
import { TeamCalendar } from "@/components/leave/TeamCalendar";
import { canSeeTeamCalendar } from "@/lib/leave/routes";

/** Leave › Team calendar: who is away this month; colleagues outside your scope show as "Away". */
export default function LeaveCalendarRoute() {
  return (
    <LeaveWorkspace title="Team calendar" description="Who is away, day by day. Your company decides how much of a colleague's leave you see." check={canSeeTeamCalendar}>
      <TeamCalendar />
    </LeaveWorkspace>
  );
}
