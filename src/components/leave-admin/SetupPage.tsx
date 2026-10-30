"use client";

import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Circle, CircleDashed, History, Lock, RefreshCw, Rocket, Scale, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { DataTable, ErrorState, PageHeader, Stagger, StaggerItem, StatCard, type Column } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Card, CardHeader, MotionSafe, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/hooks";
import { leaveAdminApi } from "@/lib/leave/adminApi";
import {
  GO_LIVE_TEXT,
  ROLL_BACK_TEXT,
  type ReconcileReport,
  type ReconcileRow,
  type SetupStep,
  type SetupStepStatus,
} from "@/lib/leave/adminTypes";

import { ErrorNotice, TypedConfirm, fmtUnits, typedMatches, useLeaveAccess } from "./shared";

const STATUS: Record<SetupStepStatus, { label: string; tone: "success" | "warning" | "neutral" | "danger" | "primary"; icon: typeof Circle }> = {
  DONE: { label: "Done", tone: "success", icon: CheckCircle2 },
  TODO: { label: "To do", tone: "warning", icon: Circle },
  OPTIONAL: { label: "Optional", tone: "neutral", icon: CircleDashed },
  BLOCKED: { label: "Blocked", tone: "danger", icon: Lock },
  READY: { label: "Ready", tone: "primary", icon: Rocket },
};

/** Server links that point at pages this UI moved (the approval route lives under Rules & settings). */
export function stepLink(step: SetupStep): string {
  if (step.key === "approvals" || step.link === "/leaves/policy") return "/settings/leave/rules?tab=approval";
  return step.link;
}

/* ------------------------------------------------------------------ go live */

/** "Go live" (13 §7.3): typed confirmation `GO LIVE`; the server also asks for a fresh step-up. */
export function GoLiveModal({ open, onOpenChange, report, onDone }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report?: ReconcileReport | null;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (open) {
      setText("");
      setError(null);
    }
  }, [open]);
  const ready = typedMatches(text, GO_LIVE_TEXT);
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await leaveAdminApi.goLive(GO_LIVE_TEXT);
      toast.success(`Leave v2 is live: ${result.grants_posted} opening grant(s) posted.`);
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Go live with leave plans and the ledger"
      description="One transaction: the Default plan is created, this year's quotas are posted as grants and leave v2 switches on."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!ready} loading={busy} data-testid="go-live-submit">
            <Rocket className="h-4 w-4" /> Go live
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="space-y-2 text-sm">
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> Balances come from the leave ledger; every credit and use is a row you can explain.</li>
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> The highest-priority matching leave plan decides entitlement, accrual, request rules and year end.</li>
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> A “Default plan” reproducing today&apos;s quotas covers everyone not matched by another plan.</li>
        </ul>
        {report && (
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-surface-muted/50 p-3 text-center text-sm">
            <div><p className="text-lg font-semibold tabular-nums">{report.employees}</p><p className="text-xs text-muted-foreground">employees</p></div>
            <div><p className="text-lg font-semibold tabular-nums">{report.grants_to_post}</p><p className="text-xs text-muted-foreground">grants to post</p></div>
            <div><p className={cn("text-lg font-semibold tabular-nums", report.unexplained ? "text-danger" : "text-success")}>{report.unexplained}</p><p className="text-xs text-muted-foreground">unexplained differences</p></div>
          </div>
        )}
        {report && report.unexplained > 0 && (
          <Notice tone="warning" title="Unexplained differences block go-live">Review the reconciliation and fix the balances first.</Notice>
        )}
        <Notice tone="info" title="You will be asked to confirm it's you">Going live needs a fresh identity check. It can be rolled back later.</Notice>
        <TypedConfirm expected={GO_LIVE_TEXT} value={text} onChange={setText} testId="go-live-confirm-input" />
        <ErrorNotice error={error} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ rollback */

export function RollbackModal({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (open) {
      setText("");
      setReason("");
      setError(null);
    }
  }, [open]);
  const ready = typedMatches(text, ROLL_BACK_TEXT) && reason.trim().length >= 3;
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await leaveAdminApi.rollback(ROLL_BACK_TEXT, reason.trim());
      toast.success(`Rolled back to legacy leave: ${result.reversed_rows} grant(s) reversed.`);
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Roll back to legacy leave"
      description="Leave v2 switches off and every grant and accrual the cut-over wrote is reversed, so balances read exactly as before."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void submit()} disabled={!ready} loading={busy} data-testid="rollback-submit">
            <Undo2 className="h-4 w-4" /> Roll back
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Notice tone="warning" title="Requests stay; plan-based rules stop applying">
          Leave requests, adjustments and imports remain in the ledger. Plans are kept and can go live again later.
        </Notice>
        <Field label="Reason" required hint="Kept in the audit trail (at least 3 characters).">
          <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="rollback-reason" />
        </Field>
        <TypedConfirm expected={ROLL_BACK_TEXT} value={text} onChange={setText} testId="rollback-confirm-input" />
        <ErrorNotice error={error} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ page */

function StateExplainer({ state }: { state: "LEGACY_V1" | "V2_ACTIVE" }) {
  const cards = [
    {
      key: "LEGACY_V1",
      title: "Legacy leave (LEGACY_V1)",
      points: [
        "Each leave type has a yearly quota that starts again every calendar year.",
        "Unused leave lapses; no accrual, carry-forward or encashment.",
        "Plans can be built, simulated and activated, but do not apply yet.",
      ],
    },
    {
      key: "V2_ACTIVE",
      title: "Leave v2 (V2_ACTIVE)",
      points: [
        "Leave plans decide eligibility, entitlement, accrual, request rules and year end.",
        "Balances come from the leave ledger: every credit, use and adjustment is a row.",
        "Imports, adjustments, year-end runs, comp-off and encashment become available.",
      ],
    },
  ] as const;
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="leave-state">
      {cards.map((card) => {
        const current = card.key === state;
        return (
          <MotionSafe key={card.key}>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className={cn(
                "relative h-full rounded-2xl border p-5",
                current ? "border-primary/50 bg-primary-soft/40 shadow-glow" : "border-border bg-surface opacity-80",
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-semibold">{card.title}</h3>
                {current && <Badge tone="primary" dot>Current</Badge>}
              </div>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {card.points.map((p) => (
                  <li key={p} className="flex gap-2"><span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-current" />{p}</li>
                ))}
              </ul>
            </motion.div>
          </MotionSafe>
        );
      })}
    </div>
  );
}

const DIFF_COLUMNS: Column<ReconcileRow>[] = [
  { key: "name", header: "Employee", primary: true, cell: (r) => <span className="font-medium">{r.name}</span> },
  { key: "type", header: "Type", cell: (r) => <span className="font-mono text-xs">{r.leave_type}</span> },
  { key: "legacy", header: "Legacy", cell: (r) => <span className="tabular-nums">{fmtUnits(r.legacy)}</span> },
  { key: "v2", header: "Ledger", cell: (r) => <span className="tabular-nums">{fmtUnits(r.v2)}</span> },
  { key: "diff", header: "Difference", cell: (r) => <span className={cn("tabular-nums font-medium", r.difference !== 0 && !r.explained && "text-danger")}>{fmtUnits(r.difference)}</span> },
  {
    key: "status",
    header: "Status",
    cell: (r) =>
      r.explained ? <Badge tone="info">{r.note ?? "Explained"}</Badge> : r.negative && r.difference === 0 ? <Badge tone="warning">Negative balance</Badge> : <Badge tone="danger" dot>Unexplained</Badge>,
  },
];

/** Settings › Leave › Setup (09-ui-ux/02 §21.1; 13 §7.3): checklist, state, reconciliation, go-live and rollback. */
export function SetupPage() {
  const setup = useApi(() => leaveAdminApi.setup(), []);
  const access = useLeaveAccess();
  const [report, setReport] = useState<ReconcileReport | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileError, setReconcileError] = useState<unknown>(null);
  const [goLive, setGoLive] = useState(false);
  const [rollback, setRollback] = useState(false);
  const company = !!access.data?.manage_company;
  const state = setup.data?.state ?? (access.data?.v2_enabled ? "V2_ACTIVE" : "LEGACY_V1");

  const reconcile = async () => {
    setReconciling(true);
    setReconcileError(null);
    try {
      setReport(await leaveAdminApi.reconcile());
    } catch (e) {
      setReconcileError(e);
    } finally {
      setReconciling(false);
    }
  };
  const afterSwitch = () => {
    access.refresh();
    void setup.reload();
    setReport(null);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Leave"
        title="Leave setup"
        description="Prepare leave types, plans and approval routes, check the numbers, then switch the company to leave plans and the leave ledger."
        actions={
          <Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => void setup.reload()}>
            <RefreshCw className={cn("h-4 w-4", setup.loading && "animate-spin")} />
          </Button>
        }
      />
      {setup.error && !setup.data ? (
        <Card><ErrorState message={setup.error.message} onRetry={() => void setup.reload()} /></Card>
      ) : (
        <div className="space-y-6">
          <StateExplainer state={state} />

          <Card>
            <CardHeader title="Setup checklist" description="Work through the steps in order; links open the page for each step." />
            {!setup.data ? (
              <div className="space-y-2 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : (
              <Stagger className="divide-y divide-border/70">
                {setup.data.steps.map((step, index) => {
                  const meta = STATUS[step.status] ?? STATUS.TODO;
                  const Icon = meta.icon;
                  return (
                    <StaggerItem key={step.key}>
                      <div className="flex flex-wrap items-center gap-4 px-5 py-4" data-testid={`setup-step-${step.key}`}>
                        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                          step.status === "DONE" ? "bg-success-soft text-success" : step.status === "BLOCKED" ? "bg-danger-soft text-danger" : step.status === "READY" ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground")}>
                          <Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{index + 1}. {step.title}</p>
                          <p className="text-xs text-muted-foreground">{step.detail}</p>
                        </div>
                        <Badge tone={meta.tone} dot>{meta.label}</Badge>
                        {stepLink(step) !== "/settings/leave/setup" && (
                          <Link href={stepLink(step)} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                            Open <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                          </Link>
                        )}
                      </div>
                    </StaggerItem>
                  );
                })}
              </Stagger>
            )}
            {setup.data?.v2_enabled && setup.data.unassigned.length > 0 && (
              <div className="border-t border-border px-5 py-3">
                <Notice tone="warning" title={`${setup.data.unassigned.length} employee(s) have no leave plan today`}>
                  Their requests are refused (PLAN_NOT_ASSIGNED) until an assignment rule covers them.{" "}
                  <Link className="font-medium text-primary hover:underline" href="/settings/leave/plans">Review plan assignment</Link>
                </Notice>
              </div>
            )}
          </Card>

          {!company && access.data && (
            <Notice tone="info" title="Go-live and rollback need company-wide leave configuration access">
              You can review the checklist; an administrator with company-wide access switches the company over.
            </Notice>
          )}

          {company && (
            <Card>
              <CardHeader
                title="Reconciliation"
                description="Counts only, never writes: today's legacy balance against the balance the cut-over would produce, for every active employee and limited type."
                action={
                  <Button variant="secondary" onClick={() => void reconcile()} loading={reconciling} data-testid="run-reconcile">
                    <Scale className="h-4 w-4" /> {report ? "Run again" : "Run reconciliation"}
                  </Button>
                }
              />
              <div className="space-y-4 p-5">
                <ErrorNotice error={reconcileError} />
                {!report && !reconcileError && (
                  <p className="text-sm text-muted-foreground">Run the reconciliation before going live. Any unexplained difference blocks the cut-over.</p>
                )}
                {report && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <StatCard label="Employees" value={report.employees} tone="info" />
                      <StatCard label="Grants to post" value={report.grants_to_post} tone="primary" delay={0.05} />
                      <StatCard label="Unexplained" value={report.unexplained} tone={report.unexplained ? "danger" : "success"} delay={0.1} />
                      <StatCard label="Negative balances" value={report.negative_balances} tone={report.negative_balances ? "warning" : "success"} delay={0.15} />
                    </div>
                    <DataTable
                      caption="Balance differences"
                      columns={DIFF_COLUMNS}
                      rows={report.differences}
                      rowKey={(r) => `${r.employee_id}-${r.leave_type}`}
                      cardBelowMd
                      empty={<p className="px-5 py-8 text-center text-sm text-muted-foreground">No differences: every balance matches.</p>}
                    />
                  </>
                )}
              </div>
            </Card>
          )}

          {company && state === "LEGACY_V1" && (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-4 bg-gradient-to-r from-primary/10 via-transparent to-transparent p-5">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><Rocket className="h-5 w-5" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold">Go live</h3>
                  <p className="text-sm text-muted-foreground">Switch the company to leave plans and the leave ledger. Needs at least one plan, a clean reconciliation and a fresh identity check.</p>
                </div>
                <Button onClick={() => setGoLive(true)} data-testid="go-live-open"
                  disabled={setup.data?.steps.find((s) => s.key === "go_live")?.status === "BLOCKED"}>
                  Go live…
                </Button>
              </div>
            </Card>
          )}

          {company && state === "V2_ACTIVE" && (
            <Card>
              <div className="flex flex-wrap items-center gap-4 p-5">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-danger-soft text-danger"><History className="h-5 w-5" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold">Roll back</h3>
                  <p className="text-sm text-muted-foreground">Return to legacy leave if the cut-over went wrong. Grants written by the cut-over and the accrual job are reversed.</p>
                </div>
                <Button variant="danger-ghost" onClick={() => setRollback(true)} data-testid="rollback-open">Roll back…</Button>
              </div>
            </Card>
          )}
        </div>
      )}
      <GoLiveModal open={goLive} onOpenChange={setGoLive} report={report} onDone={afterSwitch} />
      <RollbackModal open={rollback} onOpenChange={setRollback} onDone={afterSwitch} />
    </div>
  );
}
