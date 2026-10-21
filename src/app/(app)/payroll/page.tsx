"use client";

import { motion } from "framer-motion";
import { ArrowUpRight, History, SlidersHorizontal } from "lucide-react";
import Link from "next/link";

import { RequireAccess, useCan } from "@/components/access/Can";
import { SetupChecklist } from "@/components/payroll/settings/SetupChecklist";
import { PageHeader } from "@/components/ui/layout";
import { Card, CardHeader } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { PAYROLL_WORKSPACE_ITEMS, canSeeLegacyPayroll, canSeePayrollWorkspace } from "@/lib/navigation";
import { P } from "@/lib/permissions.generated";

const linkButton =
  "inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium shadow-sm transition-colors hover:bg-surface-muted";

/**
 * Payroll › Overview (3.8 §5.1), first shell: the setup checklist and the workspace pages this
 * user can open. KPI cards, run status and exceptions arrive with pay runs; nothing here shows
 * a number that no pay run has produced.
 */
export default function PayrollOverviewPage() {
  return (
    <RequireAccess check={canSeePayrollWorkspace}>
      <Overview />
    </RequireAccess>
  );
}

function Overview() {
  const { me } = useCan();
  if (!me) return null;
  const configReader = can(me, P.PAYROLL_CONFIGURATION_READ);
  const legacy = canSeeLegacyPayroll(me);
  const pages = PAYROLL_WORKSPACE_ITEMS.filter((item) => item.href !== "/payroll" && item.visible(me));

  return (
    <div>
      <PageHeader
        title="Payroll"
        description="Prepare, approve and pay salaries per legal entity and pay group. Figures appear here once your first pay run is calculated."
        actions={
          <>
            {configReader && (
              <Link href="/settings/payroll/general" className={linkButton}>
                <SlidersHorizontal className="h-4 w-4" aria-hidden /> Payroll settings
              </Link>
            )}
            {legacy && (
              <Link href="/payroll/legacy" className={linkButton}>
                <History className="h-4 w-4" aria-hidden /> Legacy payroll
              </Link>
            )}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {configReader ? (
            <SetupChecklist />
          ) : (
            <Card className="p-5">
              <p className="font-semibold">Payroll setup</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Your administrator configures payroll in Settings. Ask them if something here looks missing.
              </p>
            </Card>
          )}
          {legacy && (
            <Card className="p-5">
              <p className="font-semibold">Payroll from before this workspace</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Runs and salary structures created in the earlier payroll stay on the legacy page, unchanged.
              </p>
              <Link href="/payroll/legacy" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
                Open legacy payroll <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
              </Link>
            </Card>
          )}
        </div>
        {pages.length > 0 && (
          <Card className="h-fit">
            <CardHeader title="Your payroll pages" description="Only the pages your role covers are listed." />
            <ul className="p-2">
              {pages.map((item, index) => (
                <motion.li
                  key={item.href}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(index, 12) * 0.025 }}
                >
                  <Link href={item.href} className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-medium hover:bg-surface-muted">
                    <item.icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                    {item.label}
                  </Link>
                </motion.li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
