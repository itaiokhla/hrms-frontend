"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { JobProgress } from "@/components/payroll/JobProgress";
import { Stepper } from "@/components/payroll/Stepper";
import { Button } from "@/components/ui/button";
import { TabPanel, Tabs } from "@/components/ui/layout";
import { Card, MotionSafe } from "@/components/ui/primitives";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { statusEntry } from "@/lib/payroll/labels";

import { AuditTab, DocumentsTab, PaymentsTab } from "./AfterFinalizeTabs";
import { runsApi } from "./api";
import { ApprovalsTab } from "./ApprovalsTab";
import { hasAction, useRun } from "./context";
import { EmployeeSheet } from "./EmployeeInRun";
import { EmployeesTab } from "./EmployeesTab";
import { ExceptionsTab } from "./ExceptionsTab";
import { HoldModal, useHoldRoute } from "./HoldModal";
import { RunActionBar } from "./RunActions";
import { RunProvider } from "./RunProvider";
import { Notice, RUN_TYPE_LABELS, WorkspaceHeader, periodLabel } from "./shared";
import { SummaryTab } from "./SummaryTab";
import type { EmployeeFilter } from "./types";
import { VarianceTab } from "./VarianceTab";

export const RUN_TABS = ["summary", "employees", "exceptions", "variance", "approvals", "payments", "documents", "audit"] as const;
type RunTab = (typeof RUN_TABS)[number];

/** `?tab=` kept in the URL (bookmarkable); replace, so Back leaves the page instead of walking tabs. */
function useTab(): [RunTab, (tab: RunTab, extra?: Record<string, string>) => void] {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = search?.get("tab") as RunTab | null;
  const tab = raw && (RUN_TABS as readonly string[]).includes(raw) ? raw : "summary";
  const set = (next: RunTab, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams(search?.toString() ?? "");
    params.set("tab", next);
    Object.entries(extra).forEach(([k, v]) => params.set(k, v));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  return [tab, set];
}

/** Run detail (3.8 §5.3). */
export function RunDetail({ runId }: { runId: string }) {
  return <RunProvider runId={runId}>{() => <RunDetailBody />}</RunProvider>;
}

function RunDetailBody() {
  const { run, me, reload, calculating } = useRun();
  const [tab, setTab] = useTab();
  const search = useSearchParams();
  const hold = useHoldRoute();
  const [justFinalized, setJustFinalized] = useState(false);
  const previous = useRef(run.status);
  useEffect(() => {
    if (previous.current === "APPROVED" && run.status === "FINALIZED") setJustFinalized(true);
    previous.current = run.status;
  }, [run.status]);

  const population = run.population ?? {};
  const employeeFilter = (search?.get("filter") as EmployeeFilter | null) ?? null;
  const side = run.status === "CANCELLED" || run.status === "REOPENED_FOR_CORRECTION";

  return (
    <div>
      <WorkspaceHeader
        eyebrow={
          <Link href="/payroll/runs" className="inline-flex items-center gap-1 hover:underline">
            <ChevronLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden /> Pay Runs
          </Link>
        }
        title={run.label}
        description={
          <>
            <bdi dir="ltr" className="font-mono">
              {run.number}
            </bdi>
            {" · "}
            {RUN_TYPE_LABELS[run.run_type] ?? run.run_type} · {run.pay_group.name} · {periodLabel(run.period)}
            {run.environment && run.environment !== "production" && <span className="ms-2 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">{run.environment}</span>}
          </>
        }
      />

      <Card className="mb-4 space-y-4 p-4 sm:p-5">
        <Stepper state={run.status} />
        <p className="text-sm text-muted-foreground">
          {run.calculated_at ? `Calculated ${fmtDateTime(run.calculated_at)} by ${run.calculated_by_user_id === me?.user.id ? "you" : run.calculated_by_user_id ? `user #${run.calculated_by_user_id}` : "the system"}` : "Not calculated yet"}
          {` · ${population.included ?? 0} employees`}
          {` · ${run.exceptions.open} open exceptions`}
          {run.exceptions.blocking ? ` (${run.exceptions.blocking} blocking)` : ""}
          {population.on_hold ? ` · ${population.on_hold} on hold` : ""}
        </p>
        <RunActionBar onHold={() => hold.openModal()} />
      </Card>

      <div className="mb-4 space-y-3">
        <MotionSafe>
          <AnimatePresence>
            {justFinalized && (
              <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                <div role="status" className="flex items-center gap-3 rounded-xl border border-success/40 bg-success-soft px-4 py-3 text-sm">
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 18, delay: 0.1 }}>
                    <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
                  </motion.span>
                  <span className="flex-1">
                    <span className="font-medium">Run finalized.</span> Payslips are being generated; payment instructions are ready for the payout files.
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setJustFinalized(false)}>
                    Dismiss
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </MotionSafe>
        {side && (
          <Notice tone={run.status === "CANCELLED" ? "danger" : "warning"} title={statusEntry("run", run.status).label}>
            {run.status_reason ?? statusEntry("run", run.status).glossary}
          </Notice>
        )}
        {run.stale && <StaleBanner />}
        {run.status === "CALCULATING" && run.calculation_job_id && (
          <JobProgress
            jobId={run.calculation_job_id}
            title={`Calculating ${population.included ?? ""} employees`.replace("  ", " ")}
            successMessage="Calculation finished — review the results"
            failureMessage="Calculation failed — see the Exceptions tab"
            onFinished={reload}
          />
        )}
        {calculating && run.status !== "CALCULATING" && <p className="text-sm text-muted-foreground" role="status">Starting the calculation…</p>}
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as RunTab)}
        tabs={[
          { value: "summary", label: "Summary" },
          { value: "employees", label: "Employees" },
          { value: "exceptions", label: "Exceptions", badge: run.exceptions.open || undefined },
          { value: "variance", label: "Variance" },
          { value: "approvals", label: "Approvals" },
          { value: "payments", label: "Payments" },
          { value: "documents", label: "Documents" },
          { value: "audit", label: "Audit" },
        ]}
      >
        <TabPanel value="summary">
          <SummaryTab onShowExcluded={() => setTab("employees", { filter: "excluded" })} />
        </TabPanel>
        <TabPanel value="employees">
          <EmployeesTab initialFilter={employeeFilter} />
        </TabPanel>
        <TabPanel value="exceptions">
          <ExceptionsTab />
        </TabPanel>
        <TabPanel value="variance">
          <VarianceTab />
        </TabPanel>
        <TabPanel value="approvals">
          <ApprovalsTab />
        </TabPanel>
        <TabPanel value="payments">
          <PaymentsTab />
        </TabPanel>
        <TabPanel value="documents">
          <DocumentsTab />
        </TabPanel>
        <TabPanel value="audit">
          <AuditTab />
        </TabPanel>
      </Tabs>

      <EmployeeSheet />
      <HoldModal />
    </div>
  );
}

/** "Inputs changed for N employees since lock — [Recalculate them] [Handle as retro]" (EC-UX-06). */
function StaleBanner() {
  const { run, version, startCalculation, calculating } = useRun();
  const stale = useApi(() => runsApi.stale(run.id), [run.id, version]);
  const data = stale.data;
  const recalc = data?.actions.find((a) => a.action === "RECALCULATE_SELECTED");
  const retro = data?.actions.find((a) => a.action === "HANDLE_AS_RETRO");
  const count = data ? (data.all_employees ? null : data.employees.length) : null;
  const ids = recalc?.employee_ids ?? [];
  const canRecalc = !!recalc?.available && hasAction(run, "RECALCULATE");
  return (
    <Notice
      tone="warning"
      title={count === null ? "Inputs changed since lock" : `Inputs changed for ${count} ${count === 1 ? "employee" : "employees"} since lock`}
      action={
        <>
          {canRecalc && (
            <Button size="sm" className="min-h-[44px]" disabled={calculating} onClick={() => void startCalculation(data?.all_employees ? undefined : ids)}>
              Recalculate them
            </Button>
          )}
          {retro?.available ? (
            <Link href="/payroll/inputs?tab=arrears" className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-muted">
              Handle as retro
            </Link>
          ) : (
            <Button size="sm" variant="secondary" className="min-h-[44px]" disabled aria-describedby="retro-reason">
              Handle as retro
            </Button>
          )}
        </>
      }
    >
      {data?.employees.length ? <span className="block">{data.employees.slice(0, 5).map((e) => e.employee_name ?? `#${e.employee_id}`).join(", ")}{data.employees.length > 5 ? ` and ${data.employees.length - 5} more` : ""}.</span> : null}
      {retro && !retro.available && retro.reason && (
        <span id="retro-reason" className="mt-1 block text-xs">
          {retro.reason}{" "}
          <Link href="/payroll/inputs?tab=arrears" className="font-medium text-primary hover:underline">
            See arrears proposals
          </Link>
        </span>
      )}
      {!canRecalc && <span className="mt-1 block text-xs">Recalculation is not available to you at this stage.</span>}
    </Notice>
  );
}
