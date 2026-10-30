"use client";

import { LeaveBalancesPage } from "@/components/leave/LeaveBalancesPage";
import { LeaveWorkspace } from "@/components/leave/LeaveWorkspace";
import { canSeeLeaveBalances } from "@/lib/leave/routes";

/** Leave › Balances: balances, the ledger behind them, comp-off claims and encashment (`?tab=overview|comp-off|encash`). */
export default function LeaveBalancesRoute() {
  return (
    <LeaveWorkspace title="Leave balances" description="What you have, how it was earned and used, comp-off and encashment." check={canSeeLeaveBalances}>
      <LeaveBalancesPage />
    </LeaveWorkspace>
  );
}
