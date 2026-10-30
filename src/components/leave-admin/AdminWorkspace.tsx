"use client";

import Link from "next/link";
import { Settings2 } from "lucide-react";

import { useCan } from "@/components/access/Can";
import { AccessDenied, ErrorState, PageHeader, TabPanel, Tabs } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { P } from "@/lib/permissions.generated";
import type { LeaveAccess } from "@/lib/leave/adminTypes";
import { useTabParam } from "@/lib/useTabParam";

import { BalancesTab } from "./ops/BalancesTab";
import { DocumentsTab } from "./ops/DocumentsTab";
import { ImportsTab } from "./ops/ImportsTab";
import { LifecycleTab } from "./ops/LifecycleTab";
import { RecordLeaveTab } from "./ops/RecordLeaveTab";
import { ReportsTab } from "./ops/ReportsTab";
import { YearEndTab } from "./ops/YearEndTab";
import { V2Only, hasLeavePerm, useLeaveAccess } from "./shared";

export const ADMIN_TABS = ["balances", "record", "imports", "year-end", "documents", "reports", "lifecycle"] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

/** Which HR tabs the access facts allow (the API enforces every rule again). */
export function adminTabsFor(access: LeaveAccess | undefined, extra: { reports: boolean; lifecycle: boolean }): AdminTab[] {
  if (!access) return [];
  const leaveRead = (access.permissions["leave:read"] ?? []).some((s) => s !== "SELF");
  const tabs: AdminTab[] = [];
  if (leaveRead || hasLeavePerm(access, "leave:balance_adjust") || hasLeavePerm(access, "leave:import")) tabs.push("balances");
  if (hasLeavePerm(access, "leave:record")) tabs.push("record");
  if (hasLeavePerm(access, "leave:import")) tabs.push("imports");
  if (hasLeavePerm(access, "leave:year_end")) tabs.push("year-end");
  if (hasLeavePerm(access, "leave:verify_documents")) tabs.push("documents");
  if (extra.reports || hasLeavePerm(access, "leave:liability_read")) tabs.push("reports");
  if (extra.lifecycle) tabs.push("lifecycle");
  return tabs;
}

const LABEL: Record<AdminTab, string> = {
  balances: "Balances",
  record: "Record leave",
  imports: "Imports",
  "year-end": "Year end",
  documents: "Documents",
  reports: "Reports",
  lifecycle: "Lifecycle dates",
};

/** Leave › Administration (`/leaves/admin?tab=`): HR operations on balances, records, imports, year end, documents and reports. */
export function AdminWorkspace() {
  const access = useLeaveAccess();
  const { can } = useCan();
  const usage = can(P.REPORT_READ) || hasLeavePerm(access.data, "leave:read", "COMPANY");
  const tabs = adminTabsFor(access.data, { reports: usage, lifecycle: can(P.EMPLOYEE_UPDATE) });
  const [raw, setTab] = useTabParam<AdminTab>(ADMIN_TABS, tabs[0] ?? "balances");
  const tab = tabs.includes(raw) ? raw : tabs[0];

  if (access.error && !access.data) return <Card><ErrorState message={access.error.message} onRetry={() => access.refresh()} /></Card>;
  if (!access.data) return <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-96 rounded-2xl" /></div>;
  if (!tabs.length) return <AccessDenied message="Leave administration needs leave HR permissions (balances, records, imports, year end or documents)." />;

  return (
    <div>
      <PageHeader
        eyebrow="Leave"
        title="Leave administration"
        description={access.data.v2_enabled ? "Balances, records, imports, year end, documents and reports for the people you look after." : "The company is on legacy leave: ledger-based tools open after go-live."}
        actions={access.data.manage_company && (
          <Link href="/settings/leave/setup" className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium hover:bg-surface-muted">
            <Settings2 className="h-4 w-4" aria-hidden /> Setup checklist
          </Link>
        )}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as AdminTab)} tabs={tabs.map((t) => ({ value: t, label: LABEL[t] }))}>
        {tabs.includes("balances") && <TabPanel value="balances"><BalancesTab access={access.data} /></TabPanel>}
        {tabs.includes("record") && <TabPanel value="record"><RecordLeaveTab /></TabPanel>}
        {tabs.includes("imports") && <TabPanel value="imports"><V2Only access={access.data} what="Importing balances"><ImportsTab /></V2Only></TabPanel>}
        {tabs.includes("year-end") && <TabPanel value="year-end"><V2Only access={access.data} what="Year end"><YearEndTab /></V2Only></TabPanel>}
        {tabs.includes("documents") && <TabPanel value="documents"><DocumentsTab /></TabPanel>}
        {tabs.includes("reports") && <TabPanel value="reports"><ReportsTab access={access.data} canUsage={usage} /></TabPanel>}
        {tabs.includes("lifecycle") && <TabPanel value="lifecycle"><LifecycleTab /></TabPanel>}
      </Tabs>
    </div>
  );
}
