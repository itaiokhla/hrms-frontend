"use client";

import { motion } from "framer-motion";
import { ArrowLeft, ArrowUpRight, Inbox } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { MoneyText } from "@/components/payroll/MoneyText";
import { Timeline, type TimelineItem } from "@/components/payroll/Timeline";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, TabPanel, Tabs } from "@/components/ui/layout";
import { Card, CardHeader, MotionSafe, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate, fromNow } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P, type PermissionCode } from "@/lib/permissions.generated";

import { approvalsApi } from "./api";
import { DecisionModal, DetailGate, LocalStatusChip, WorkspaceHeader } from "./shared";
import { APPROVAL_MODULES, type ApprovalRequest } from "./types";
import { useTabParam } from "./WageInputsWorkspace";

/** Every approve permission that can put a request in this inbox (wider than the nav gate, see open issues). */
export const APPROVER_CODES: PermissionCode[] = [
  P.PAYROLL_RUN_APPROVE,
  P.PAYROLL_INPUTS_APPROVE,
  P.PAYROLL_COMPENSATION_APPROVE,
  P.PAYROLL_SALARY_STRUCTURE_APPROVE,
  P.PAYROLL_PAYMENT_APPROVE,
  P.PAYROLL_BANK_DETAILS_APPROVE,
  P.PAYROLL_LOANS_APPROVE,
  P.PAYROLL_REIMBURSEMENTS_APPROVE,
  P.OVERTIME_APPROVE,
  P.TASK_APPROVE,
];

export const MODULE_TITLES: Record<string, string> = {
  payroll_run: "Pay runs",
  off_cycle: "Off-cycle runs",
  final_settlement: "Final settlements",
  compensation: "Compensation",
  wage_input: "Wage inputs",
  overtime: "Overtime",
  task: "Tasks",
  lop: "Loss of pay",
  attendance: "Attendance corrections",
  reimbursement: "Reimbursements",
  loan: "Loans & advances",
  bank_change: "Bank details",
  payment_batch: "Payment batches",
  settings: "Settings changes",
};

/** The page of the object an approval decides, when that page exists. */
export function subjectHref(r: Pick<ApprovalRequest, "module" | "subject_type" | "subject_id" | "subject_employee_id" | "context">): string | null {
  const id = r.subject_id;
  const loanId = typeof r.context?.loan_id === "number" ? (r.context.loan_id as number) : null;
  switch (r.module) {
    case "wage_input":
      return `/payroll/inputs/${id}`;
    case "loan":
      return r.subject_type === "loan" ? `/payroll/loans/${id}` : loanId ? `/payroll/loans/${loanId}` : null;
    case "reimbursement":
      return `/payroll/reimbursements/${id}`;
    case "overtime":
      return `/overtime/${id}`;
    case "task":
      return `/tasks/${id}`;
    case "payroll_run":
    case "off_cycle":
    case "final_settlement":
      return `/payroll/runs/${id}`;
    case "payment_batch":
      return `/payroll/payments/batches/${id}`;
    case "compensation":
      return r.subject_employee_id ? `/payroll/compensation/${r.subject_employee_id}` : null;
    case "settings":
      return "/settings/payroll/change-requests";
    default:
      return null;
  }
}

function Summary({ r }: { r: ApprovalRequest }) {
  const step = r.steps.find((s) => s.step_order === r.current_step);
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium">{r.subject_employee_name ?? `${r.module_label} #${r.subject_id}`}</span>
        {r.amount && <MoneyText money={r.amount} emphasis />}
      </div>
      <p className="text-muted-foreground">
        {r.module_label[0]?.toUpperCase()}
        {r.module_label.slice(1)} · requested by {r.requested_by ?? "the system"} · {fromNow(r.created_at)}
      </p>
      {step && (
        <p className="text-muted-foreground">
          Step {step.step_order} of {r.steps.length}: {step.approver ?? step.approver_label}
          {r.acting_as && r.acting_as !== "approver" ? ` (you act as ${r.acting_as})` : ""}
        </p>
      )}
      {r.pending_reason && <p className="text-warning">{r.pending_reason}</p>}
    </div>
  );
}

function RequestCard({ r, onDecide, index }: { r: ApprovalRequest; onDecide: (r: ApprovalRequest, kind: "approve" | "reject") => void; index: number }) {
  const href = subjectHref(r);
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index, 12) * 0.025 }}
      className="flex flex-col gap-3 border-b border-border/60 px-4 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-2">
          <LocalStatusChip vocabulary="approval" code={r.status} />
          <Link href={`/payroll/approvals/${r.id}`} className="text-xs text-muted-foreground hover:underline">
            Request #{r.id}
          </Link>
        </div>
        <Summary r={r} />
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {href && (
          <Link href={href} className="inline-flex min-h-[44px] items-center gap-1 rounded-xl px-3 text-sm font-medium text-primary hover:bg-primary-soft">
            Open <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        )}
        {r.can_act && r.status === "PENDING" && (
          <>
            <Button variant="ghost" className="min-h-[44px] text-danger" onClick={() => onDecide(r, "reject")}>
              Reject
            </Button>
            <Button className="min-h-[44px]" onClick={() => onDecide(r, "approve")}>
              Approve
            </Button>
          </>
        )}
      </div>
    </motion.li>
  );
}

const VIEWS = ["mine", "all"] as const;

/**
 * Payroll › Approvals (3.8 §4, §3.4): requests grouped by module with approve / reject (reason
 * required). Counts come from the same server response as the list, so they always respect the
 * caller's scope (EC-UX-03, EC-SEC-05). Deep links: `?modal=approve&id=` / `?modal=reject&id=`.
 */
export function ApprovalsInbox() {
  const [view, setView] = useTabParam(VIEWS, "mine");
  const [module, setModule] = useState<string>("");
  const approve = useModalRoute("approve", { keys: ["id"] });
  const reject = useModalRoute("reject", { keys: ["id"] });
  const { data, error, loading, reload } = useApi(
    () => approvalsApi.list({ mine: view === "mine", status: view === "mine" ? undefined : "PENDING", limit: 200 }),
    [view],
  );

  const groups = useMemo(() => {
    const items = data?.items ?? [];
    const by = new Map<string, ApprovalRequest[]>();
    items.forEach((r) => by.set(r.module, [...(by.get(r.module) ?? []), r]));
    return APPROVAL_MODULES.filter((m) => by.has(m)).map((m) => ({ module: m, items: by.get(m)! }));
  }, [data]);
  const visible = module ? groups.filter((g) => g.module === module) : groups;

  const openId = approve.open ? approve.id : reject.open ? reject.id : null;
  const kind: "approve" | "reject" = approve.open ? "approve" : "reject";
  const fromList = data?.items.find((r) => String(r.id) === openId);
  // A deep link to a request that is not on this page loads it on its own.
  const single = useApi(() => approvalsApi.get(openId!), [openId], { enabled: !!openId && !fromList && !loading });
  const target = fromList ?? single.data;

  const decide = async (r: ApprovalRequest, k: "approve" | "reject", remarks: string) => {
    if (k === "approve") await approvalsApi.approve(r.id, remarks, r.current_step);
    else await approvalsApi.reject(r.id, remarks, r.current_step);
    toast.success(k === "approve" ? `Approved. ${r.steps.length > (r.current_step ?? 0) ? "It moves to the next approver." : "The requester is notified."}` : "Rejected. The requester sees your reason.");
    void reload();
  };

  const body = (
    <>
      {error ? (
        <Card>
          <ErrorState message={error.message} onRetry={reload} />
        </Card>
      ) : loading && !data ? (
        <Card className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox />}
            title={view === "mine" ? "Nothing is waiting for you" : "No pending requests you can see"}
            description="Pay runs, inputs, overtime, tasks, claims, loans and bank changes that need your decision appear here. Leave requests stay on the Leave page."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by module">
            <ModuleChip active={!module} onClick={() => setModule("")} label="All" count={data?.items.length ?? 0} />
            {groups.map((g) => (
              <ModuleChip key={g.module} active={module === g.module} onClick={() => setModule(g.module)} label={MODULE_TITLES[g.module] ?? g.module} count={g.items.length} />
            ))}
          </div>
          {data && data.total > data.items.length && (
            <p className="text-xs text-muted-foreground">
              Showing the newest {data.items.length} of {data.total}. Decide these first; older ones load next.
            </p>
          )}
          {visible.map((g) => (
            <Card key={g.module}>
              <CardHeader title={MODULE_TITLES[g.module] ?? g.module} description={`${g.items.length} request${g.items.length === 1 ? "" : "s"}`} />
              <MotionSafe>
                <ul>
                  {g.items.map((r, i) => (
                    <RequestCard key={r.id} r={r} index={i} onDecide={(req, k) => (k === "approve" ? approve.openModal({ id: req.id }) : reject.openModal({ id: req.id }))} />
                  ))}
                </ul>
              </MotionSafe>
            </Card>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div>
      <WorkspaceHeader title="Approvals" description="Decisions waiting for you across payroll. Rejections need a reason, which the requester sees." />
      <Tabs
        value={view}
        onValueChange={(v) => setView(v as (typeof VIEWS)[number])}
        tabs={[
          { value: "mine", label: "Waiting for me", badge: view === "mine" ? data?.total : undefined },
          { value: "all", label: "All pending I can see" },
        ]}
      >
        <TabPanel value="mine">{view === "mine" && body}</TabPanel>
        <TabPanel value="all">{view === "all" && body}</TabPanel>
      </Tabs>
      {openId && target && (
        <DecisionModal
          open
          onOpenChange={(o) => {
            if (!o) void (approve.open ? approve.close() : reject.close());
          }}
          decision={kind}
          subject={`${target.module_label[0]?.toUpperCase()}${target.module_label.slice(1)} · request #${target.id}`}
          summary={
            <div className="rounded-xl bg-muted/60 p-3">
              <Summary r={target} />
            </div>
          }
          acknowledge={Array.isArray(target.context?.flags) ? (target.context.flags as unknown[]).map((f) => (typeof f === "string" ? f : String((f as { message?: string; code?: string }).message ?? (f as { code?: string }).code ?? ""))) : []}
          onReload={reload}
          onSubmit={(remarks) => decide(target, kind, remarks)}
        />
      )}
    </div>
  );
}

function ModuleChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
        active ? "border-primary bg-primary-soft text-foreground" : "border-border text-muted-foreground hover:bg-surface-muted",
      )}
    >
      {label}
      <span className="tabular-nums rounded-full bg-surface px-1.5 text-xs">{count}</span>
    </button>
  );
}

/** Full page of one approval request: `/payroll/approvals/[id]` (parity with the Approve / reject modal). */
export function ApprovalDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi(() => approvalsApi.get(id), [id]);
  const [kind, setKind] = useState<"approve" | "reject" | null>(null);
  const events: TimelineItem[] = (data?.steps ?? []).map((s) => ({
    id: s.step_order,
    at: s.acted_at ?? data?.created_at ?? "",
    title: `Step ${s.step_order}: ${s.approver ?? s.approver_label} — ${s.status}`,
    actor: s.acted_by ? `${s.acted_by}${s.acted_as && s.acted_as !== "approver" ? ` (${s.acted_as})` : ""}` : undefined,
    body: s.remarks,
    tone: s.status === "approved" ? "success" : s.status === "rejected" ? "danger" : s.status === "pending" ? "warning" : "neutral",
  }));
  const href = data ? subjectHref(data) : null;
  return (
    <DetailGate loading={loading} error={error} hasData={!!data} onRetry={reload} what="Approval request" backHref="/payroll/approvals" backLabel="Back to Approvals">
      {data && (
        <div className="space-y-6">
          <Link href="/payroll/approvals" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> Approvals
          </Link>
          <WorkspaceHeader
            title={`${MODULE_TITLES[data.module] ?? data.module_label} · request #${data.id}`}
            description={`Created ${fmtDate(data.created_at, "d MMM yyyy, h:mm a")}`}
            actions={
              data.can_act && data.status === "PENDING" ? (
                <>
                  <Button variant="ghost" className="min-h-[44px] text-danger" onClick={() => setKind("reject")}>
                    Reject
                  </Button>
                  <Button className="min-h-[44px]" onClick={() => setKind("approve")}>
                    Approve
                  </Button>
                </>
              ) : undefined
            }
          />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Card className="p-5">
              <div className="mb-3">
                <LocalStatusChip vocabulary="approval" code={data.status} />
              </div>
              <Summary r={data} />
              {href && (
                <Link href={href} className="mt-4 inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-primary hover:underline">
                  Open what is being approved <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
                </Link>
              )}
            </Card>
            <Card>
              <CardHeader title="Approval chain" />
              <div className="px-5 pb-5">
                <Timeline items={events} label="Approval steps" />
              </div>
            </Card>
          </div>
          {kind && (
            <DecisionModal
              open
              onOpenChange={(o) => !o && setKind(null)}
              decision={kind}
              subject={`Request #${data.id}`}
              summary={
                <div className="rounded-xl bg-muted/60 p-3">
                  <Summary r={data} />
                </div>
              }
              onReload={reload}
              onSubmit={async (remarks) => {
                if (kind === "approve") await approvalsApi.approve(data.id, remarks, data.current_step);
                else await approvalsApi.reject(data.id, remarks, data.current_step);
                toast.success(kind === "approve" ? "Approved." : "Rejected. The requester sees your reason.");
                void reload();
              }}
            />
          )}
        </div>
      )}
    </DetailGate>
  );
}
