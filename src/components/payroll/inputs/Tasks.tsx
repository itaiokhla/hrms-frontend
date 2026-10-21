"use client";

import { motion } from "framer-motion";
import { ArrowLeft, FileText, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { FileDropzone } from "@/components/payroll/FileDropzone";
import { MoneyText } from "@/components/payroll/MoneyText";
import { StatusChip } from "@/components/payroll/StatusChip";
import { Timeline, type TimelineItem } from "@/components/payroll/Timeline";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card, CardHeader, MotionSafe, Skeleton } from "@/components/ui/primitives";
import { can, canAny, canBeyondSelf } from "@/lib/access";
import { ApiError } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { compareDecimalStrings, isDecimalString, parseMoneyInput, sumDecimalStrings } from "@/lib/money";
import { P } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";

import { fetchBlob, lookupsApi, saveBlob, tasksApi, type TaskBody } from "./api";
import { ConflictBanner, DecisionModal, Decimal, DetailGate, EmployeeField, ErrorSummary, Notice, PageSkeleton, ReasonModal, WorkspaceHeader, errorText, fieldErrors } from "./shared";
import type { Task } from "./types";
import { useTabParam } from "./WageInputsWorkspace";

/** tasks.EVIDENCE_TYPES: PDF, PNG, JPEG. */
export const EVIDENCE_ACCEPT = [".pdf", ".png", ".jpg", ".jpeg", "application/pdf", "image/png", "image/jpeg"];
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_ASSIGNEES = 20;

/** Pay amounts are for payroll staff only (contract §25): managers see quantities, not rates. */
export function seesTaskRates(me: Me | null | undefined): boolean {
  return canAny(me, [P.PAYROLL_INPUTS_READ, P.PAYROLL_CONFIGURATION_READ]);
}

export type TasksSwitch = "on" | "off" | "unknown";

/**
 * `tasks.enabled` through the settings API when the viewer may read settings
 * (GET /payroll/settings/resolve); otherwise the tasks API itself answers 403 TASKS_DISABLED.
 */
export function useTasksEnabled(): TasksSwitch {
  const { me } = useCan();
  const readable = can(me, P.PAYROLL_CONFIGURATION_READ);
  const { data, error } = useApi(() => lookupsApi.resolveSetting("tasks.enabled"), [], { enabled: readable });
  if (!readable || error) return "unknown";
  if (!data) return "unknown";
  return data.value === true ? "on" : "off";
}

function TasksOff() {
  return (
    <Card className="p-2">
      <EmptyState
        title="The tasks module is turned off"
        description="Task boards and task pay appear when an administrator turns on Tasks in Settings › Payroll › Task pay."
        action={
          <Link href="/settings/payroll/tasks" className="inline-flex min-h-[44px] items-center text-sm font-medium text-primary hover:underline">
            Open task pay settings
          </Link>
        }
      />
    </Card>
  );
}

const BOARD: { status: string[]; title: string }[] = [
  { status: ["DRAFT"], title: "Draft" },
  { status: ["SUBMITTED", "DISPUTED"], title: "Waiting for approval" },
  { status: ["APPROVED"], title: "Approved" },
  { status: ["PAID"], title: "Paid" },
  { status: ["REJECTED", "REVERSED"], title: "Rejected or reversed" },
];

function TaskCard({ task, index, showRate }: { task: Task; index: number; showRate: boolean }) {
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: Math.min(index, 12) * 0.025 }}>
      <Link href={`/tasks/${task.id}`} className="block min-h-[44px] rounded-xl border border-border bg-surface p-3 text-sm shadow-sm transition-colors hover:bg-surface-muted">
        <p className="font-medium">{task.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{task.assignees.map((a) => `${a.employee_name ?? `#${a.employee_id}`}${task.assignees.length > 1 ? ` ${a.split_percent}%` : ""}`).join(", ")}</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <StatusChip vocabulary="task" code={task.status} />
          <span className="text-xs">
            <Decimal value={task.accepted_quantity ?? task.quantity} suffix={task.unit} />
            {showRate && task.rate && (
              <>
                {" × "}
                <MoneyText money={task.rate} />
              </>
            )}
          </span>
        </div>
        {task.due_date && <p className="mt-1 text-xs text-muted-foreground">Due {fmtDate(task.due_date)}</p>}
      </Link>
    </motion.li>
  );
}

function Board({ params, refresh, showRate, emptyAction }: { params: Record<string, unknown>; refresh: number; showRate: boolean; emptyAction?: React.ReactNode }) {
  const { data, error, loading, reload } = useApi(() => tasksApi.list({ ...params, limit: 200 }), [JSON.stringify(params), refresh]);
  if (error?.code === "TASKS_DISABLED") return <TasksOff />;
  if (error) return <Card><ErrorState message={error.message} onRetry={reload} /></Card>;
  if (loading && !data) {
    return (
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        {BOARD.map((c) => (
          <Skeleton key={c.title} className="h-48 w-full" />
        ))}
      </div>
    );
  }
  const items = data?.items ?? [];
  if (!items.length) {
    return (
      <Card>
        <EmptyState title="No tasks yet" description="Create a task, assign it to one or more people (with a split when shared), and approve it when the work is done." action={emptyAction} />
      </Card>
    );
  }
  return (
    <MotionSafe>
      {data && data.total > items.length && <p className="mb-2 text-xs text-muted-foreground">Showing the newest {items.length} of {data.total}.</p>}
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        {BOARD.map((col) => {
          const cards = items.filter((t) => col.status.includes(t.status));
          return (
            <section key={col.title} aria-label={col.title} className="rounded-2xl bg-muted/40 p-3">
              <h3 className="mb-2 flex items-center justify-between text-sm font-semibold">
                {col.title} <span className="tabular-nums text-xs text-muted-foreground">{cards.length}</span>
              </h3>
              <ul className="space-y-2">
                {cards.map((t, i) => (
                  <TaskCard key={t.id} task={t} index={i} showRate={showRate} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </MotionSafe>
  );
}

/* ------------------------------------------------------------------ create */

interface AssigneeRow {
  key: number;
  employeeId: number | null;
  split: string;
}

export function NewTaskModal({ open, onOpenChange, onCreated, onDirtyChange }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (id: number) => void; onDirtyChange?: (d: boolean) => void }) {
  const { me } = useCan();
  const showRate = seesTaskRates(me);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [due, setDue] = useState("");
  const [description, setDescription] = useState("");
  const [rate, setRate] = useState("");
  const [assignees, setAssignees] = useState<AssigneeRow[]>([{ key: 1, employeeId: null, split: "100" }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const currency = me?.company.currency ?? "INR";

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setType("");
    setQuantity("");
    setUnit("");
    setDue("");
    setDescription("");
    setRate("");
    setAssignees([{ key: 1, employeeId: null, split: "100" }]);
    setErrors({});
    setError(null);
  }, [open]);
  const dirty = open && (!!title || !!type || !!quantity || assignees.some((a) => a.employeeId));
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const total = useMemo(() => {
    const parts = assignees.map((a) => a.split.trim()).filter(isDecimalString);
    return parts.length === assignees.length ? sumDecimalStrings(parts) : null;
  }, [assignees]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!title.trim()) next.title = "Give the task a title.";
    if (!/^[A-Za-z0-9][A-Za-z0-9_.\- ]*$/.test(type.trim())) next.task_type = "Use letters, numbers, dots, dashes or underscores, for example INSTALL.";
    if (!isDecimalString(quantity.trim()) || compareDecimalStrings(quantity.trim(), "0") <= 0) next.quantity = "Enter a quantity above zero.";
    if (!unit.trim()) next.unit = "Enter the unit, for example pieces or hours.";
    if (assignees.some((a) => !a.employeeId)) next.assignees = "Choose every assignee.";
    else if (new Set(assignees.map((a) => a.employeeId)).size !== assignees.length) next.assignees = "Each person can be assigned once.";
    else if (assignees.length > 1 && (total === null || compareDecimalStrings(total, "100") !== 0)) next.assignees = `Splits must add up to exactly 100%${total ? ` (now ${total}%)` : ""}.`;
    let rateMoney: { amount: string; currency: string } | undefined;
    if (showRate && rate.trim()) {
      const parsed = parseMoneyInput(rate, currency);
      if (parsed.ok) rateMoney = { amount: parsed.amount, currency };
      else next.rate = parsed.message;
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    const body: TaskBody = {
      title: title.trim(),
      task_type: type.trim(),
      quantity: quantity.trim(),
      unit: unit.trim(),
      assignees: assignees.map((a) => ({ employee_id: a.employeeId!, ...(assignees.length > 1 ? { split_percent: a.split.trim() } : {}) })),
    };
    if (description.trim()) body.description = description.trim();
    if (due) body.due_date = due;
    if (rateMoney) body.rate = rateMoney;
    setBusy(true);
    setError(null);
    try {
      const result = await tasksApi.create(body);
      toast.success("Task created as a draft. Add evidence and submit it when the work is done.");
      onOpenChange(false);
      onCreated?.(result.id);
    } catch (err) {
      setError(err);
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="New task"
      description="Assign work to one person, or share it with a split that adds up to 100%."
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-task-form" className="min-h-[44px]" loading={busy}>
            Create task
          </Button>
        </>
      }
    >
      <form id="new-task-form" onSubmit={submit} className="space-y-4" noValidate>
        <ConflictBanner error={error} />
        <ErrorSummary error={error} fields={errors} />
        <Field label="Title" required error={errors.title}>
          <Input maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Task type" required error={errors.task_type} hint="Matches the rate card">
            <Input maxLength={50} value={type} onChange={(e) => setType(e.target.value)} />
          </Field>
          <Field label="Quantity" required error={errors.quantity}>
            <Input inputMode="decimal" dir="ltr" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label="Unit" required error={errors.unit}>
            <Input maxLength={30} value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
        </div>
        <fieldset className="space-y-3 rounded-xl border border-border p-3">
          <legend className="px-1 text-[13px] font-medium">Assignees</legend>
          {errors.assignees && (
            <p role="alert" className="text-xs font-medium text-danger">
              {errors.assignees}
            </p>
          )}
          {assignees.map((a, i) => (
            <div key={a.key} className="grid items-end gap-2 sm:grid-cols-[1fr_110px_auto]">
              <EmployeeField label={`Assignee ${i + 1}`} value={a.employeeId} onChange={(v) => setAssignees((rows) => rows.map((r) => (r.key === a.key ? { ...r, employeeId: v } : r)))} />
              {assignees.length > 1 && (
                <Field label="Split %">
                  <Input inputMode="decimal" dir="ltr" value={a.split} onChange={(e) => setAssignees((rows) => rows.map((r) => (r.key === a.key ? { ...r, split: e.target.value } : r)))} />
                </Field>
              )}
              {assignees.length > 1 && (
                <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Remove assignee ${i + 1}`} onClick={() => setAssignees((rows) => rows.filter((r) => r.key !== a.key))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="min-h-[44px]"
              disabled={assignees.length >= MAX_ASSIGNEES}
              onClick={() => setAssignees((rows) => [...rows, { key: Math.max(...rows.map((r) => r.key)) + 1, employeeId: null, split: "" }])}
            >
              <Plus className="h-4 w-4" aria-hidden /> Add assignee
            </Button>
            {assignees.length > 1 && (
              <span className={`text-xs tabular-nums ${total && compareDecimalStrings(total, "100") === 0 ? "text-success" : "text-warning"}`}>
                Total <bdi dir="ltr">{total ?? "—"}%</bdi> of 100%
              </span>
            )}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Due date">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          {showRate ? (
            <Field label={`Rate per unit (${currency}, optional)`} error={errors.rate} hint="Empty uses the rate card">
              <Input inputMode="decimal" dir="ltr" value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
          ) : (
            <p className="self-center text-xs text-muted-foreground">Pay per unit comes from the rate card.</p>
          )}
        </div>
        <Field label="Description">
          <Textarea rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ workspace */

const TABS = ["board", "approvals", "mine"] as const;

/**
 * Tasks (3.8 §3.4): the managers' task board (create, assign with split %, approve / reject /
 * partial acceptance) and the employee's "My tasks" (submit with evidence). Gated by `tasks.enabled`
 * and task:* permissions.
 */
export function TasksWorkspace() {
  const { me } = useCan();
  const enabled = useTasksEnabled();
  const canManage = can(me, P.TASK_MANAGE);
  const canApprove = can(me, P.TASK_APPROVE);
  const team = canBeyondSelf(me, P.TASK_MANAGE) || canBeyondSelf(me, P.TASK_APPROVE) || canBeyondSelf(me, P.TASK_READ);
  const mine = !!me?.employee;
  const allowed = TABS.filter((t) => (t === "board" ? team : t === "approvals" ? canApprove : mine));
  const [tab, setTab] = useTabParam<(typeof TABS)[number]>(allowed.length ? allowed : TABS, allowed[0] ?? "mine");
  const [dirty, setDirty] = useState(false);
  const modal = useModalRoute("new-task", { keys: [], dirty });
  const [refresh, setRefresh] = useState(0);
  const showRate = seesTaskRates(me);

  if (enabled === "off") {
    return (
      <div>
        <WorkspaceHeader eyebrow="Work" title="Tasks" showHideAmounts={false} />
        <TasksOff />
      </div>
    );
  }
  const create = canManage && (
    <Button className="min-h-[44px]" onClick={() => modal.openModal()}>
      <Plus className="h-4 w-4" aria-hidden /> New task
    </Button>
  );
  return (
    <div>
      <WorkspaceHeader eyebrow="Work" title="Tasks" description="Piece-rate and project work: assign, submit with evidence, approve. Approved tasks are paid by the next pay run." showHideAmounts={showRate} actions={create} />
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as (typeof TABS)[number])}
        tabs={allowed.map((t) => ({ value: t, label: t === "board" ? "Team board" : t === "approvals" ? "Waiting for my approval" : "My tasks" }))}
      >
        {team && (
          <TabPanel value="board">
            <Board params={{}} refresh={refresh} showRate={showRate} emptyAction={create} />
          </TabPanel>
        )}
        {canApprove && (
          <TabPanel value="approvals">
            <Board params={{ awaiting: true }} refresh={refresh} showRate={showRate} />
          </TabPanel>
        )}
        {mine && (
          <TabPanel value="mine">
            <Board params={{ employee_id: me!.employee!.id }} refresh={refresh} showRate={showRate} />
          </TabPanel>
        )}
      </Tabs>
      <NewTaskModal open={modal.open} onOpenChange={modal.onOpenChange} onDirtyChange={setDirty} onCreated={() => setRefresh((n) => n + 1)} />
    </div>
  );
}

/* ------------------------------------------------------------------ detail */

export function TaskDetail({ id }: { id: string }) {
  const { me } = useCan();
  const { data: task, error, loading, reload } = useApi(() => tasksApi.get(id), [id]);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [disputing, setDisputing] = useState(false);
  const [accepted, setAccepted] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = can(me, P.TASK_MANAGE);
  const canApprove = can(me, P.TASK_APPROVE);
  const showRate = seesTaskRates(me);
  const isAssignee = !!task && task.assignees.some((a) => a.employee_id === me?.employee?.id);

  if (error && (error as ApiError).code === "TASKS_DISABLED") return <TasksOff />;

  const submit = async () => {
    if (!task) return;
    setBusy(true);
    try {
      await tasksApi.submit(task.id);
      toast.success("Task submitted for approval.");
      void reload();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const events: TimelineItem[] = task
    ? ([
        task.created_at && { id: "c", at: task.created_at, title: "Created", tone: "neutral" },
        task.submitted_at && { id: "s", at: task.submitted_at, title: "Submitted", tone: "info" },
        task.decided_at && { id: "d", at: task.decided_at, title: task.status === "REJECTED" ? "Rejected" : task.status === "DISPUTED" ? "Disputed" : "Approved", body: task.status_reason, tone: task.status === "REJECTED" ? "danger" : task.status === "DISPUTED" ? "warning" : "success" },
        task.reversed_at && { id: "r", at: task.reversed_at, title: "Reversed", body: task.status_reason, tone: "danger" },
      ].filter(Boolean) as TimelineItem[])
    : [];

  return (
    <DetailGate loading={loading} error={error} hasData={!!task} onRetry={reload} what="Task" backHref="/tasks" backLabel="Back to Tasks">
      {!task ? (
        <PageSkeleton />
      ) : (
        <div className="space-y-6">
          <Link href="/tasks" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> Tasks
          </Link>
          <WorkspaceHeader
            eyebrow="Work"
            title={task.title}
            description={`${task.task_type}${task.project ? ` · ${task.project}` : ""} · #${task.id}`}
            showHideAmounts={showRate}
            actions={
              <>
                {canManage && task.status === "DRAFT" && (
                  <Button className="min-h-[44px]" loading={busy} onClick={submit}>
                    Submit for approval
                  </Button>
                )}
                {canApprove && !isAssignee && task.status === "SUBMITTED" && (
                  <Button variant="secondary" className="min-h-[44px]" onClick={() => setDisputing(true)}>
                    Dispute
                  </Button>
                )}
                {canApprove && !isAssignee && (task.status === "SUBMITTED" || task.status === "DISPUTED") && (
                  <>
                    <Button variant="ghost" className="min-h-[44px] text-danger" onClick={() => setDecision("reject")}>
                      Reject
                    </Button>
                    <Button
                      className="min-h-[44px]"
                      onClick={() => {
                        setAccepted(task.quantity ?? "");
                        setDecision("approve");
                      }}
                    >
                      Approve
                    </Button>
                  </>
                )}
              </>
            }
          />
          {task.warnings.length > 0 && (
            <Notice tone="warning" title="Check before approving">
              <ul className="list-disc ps-5">
                {task.warnings.map((w, i) => (
                  <li key={i}>{typeof w === "string" ? w : w.message ?? w.code}</li>
                ))}
              </ul>
            </Notice>
          )}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-6">
              <Card className="p-5">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <StatusChip vocabulary="task" code={task.status} />
                  {task.status === "PAID" && !task.paid_in_run_id && <span className="text-xs text-warning">No pay run recorded</span>}
                </div>
                <dl className="grid gap-4 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Quantity</dt>
                    <dd className="mt-1">
                      <Decimal value={task.quantity} suffix={task.unit} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Accepted</dt>
                    <dd className="mt-1">
                      <Decimal value={task.accepted_quantity} suffix={task.accepted_quantity ? task.unit : undefined} />
                    </dd>
                  </div>
                  {showRate && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Rate per unit</dt>
                      <dd className="mt-1">{task.rate ? <MoneyText money={task.rate} /> : "From the rate card"}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-muted-foreground">Due</dt>
                    <dd className="mt-1">{fmtDate(task.due_date)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Completed</dt>
                    <dd className="mt-1">{fmtDate(task.completed_on)}</dd>
                  </div>
                </dl>
                {task.description && <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">{task.description}</p>}
              </Card>
              <Card>
                <CardHeader title="Assignees" description={task.assignees.length > 1 ? "Pay is split by these percentages." : undefined} />
                <ul className="px-5 pb-4 text-sm">
                  {task.assignees.map((a) => (
                    <li key={a.employee_id} className="flex min-h-[44px] items-center justify-between border-b border-border/60 last:border-0">
                      <span>{a.employee_name ?? `Employee #${a.employee_id}`}</span>
                      <span className="tabular-nums">
                        <bdi dir="ltr">{a.split_percent}%</bdi>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card>
                <CardHeader title="Evidence" description="Photos or documents that show the work was done." />
                <ul className="px-2 pb-2">
                  {task.evidence.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No evidence yet. The task pay policy may require it before submitting.</li>}
                  {task.evidence.map((ev) => (
                    <li key={ev.id} className="flex min-h-[44px] items-center gap-2 px-3">
                      <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                      <button
                        type="button"
                        className="min-h-[44px] min-w-0 flex-1 truncate text-start text-sm font-medium hover:underline"
                        onClick={async () => {
                          try {
                            saveBlob(await fetchBlob(tasksApi.evidenceUrl(task.id, ev.id)), ev.file_name);
                          } catch (e) {
                            toast.error(errorText(e));
                          }
                        }}
                      >
                        {ev.file_name}
                      </button>
                      {canManage && task.status === "DRAFT" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11"
                          aria-label={`Remove ${ev.file_name}`}
                          onClick={async () => {
                            try {
                              await tasksApi.removeEvidence(task.id, ev.id);
                              void reload();
                            } catch (e) {
                              toast.error(errorText(e));
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {canManage && ["DRAFT", "SUBMITTED", "DISPUTED"].includes(task.status) && (
                  <div className="border-t border-border p-4">
                    <FileDropzone
                      accept={EVIDENCE_ACCEPT}
                      maxBytes={EVIDENCE_MAX_BYTES}
                      multiple
                      label="Add evidence"
                      hint="PDF, PNG or JPEG"
                      upload={async (file, onProgress) => {
                        await tasksApi.addEvidence(task.id, file, onProgress);
                        void reload();
                      }}
                    />
                  </div>
                )}
              </Card>
            </div>
            <Card>
              <CardHeader title="History" />
              <div className="px-5 pb-5">
                <Timeline items={events} label="Task history" />
              </div>
            </Card>
          </div>
          {decision && (
            <DecisionModal
              open
              onOpenChange={(o) => !o && setDecision(null)}
              decision={decision}
              subject={task.title}
              summary={
                <div className="rounded-xl bg-muted/60 p-3 text-sm">
                  <Decimal value={task.quantity} suffix={task.unit} /> · {task.evidence.length} evidence file{task.evidence.length === 1 ? "" : "s"}
                </div>
              }
              acknowledge={task.warnings.map((w) => (typeof w === "string" ? w : String(w.message ?? w.code ?? "")))}
              extra={
                decision === "approve" && (
                  <Field label={`Accepted quantity (${task.unit})`} hint="Lower it to accept part of the work.">
                    <Input inputMode="decimal" dir="ltr" value={accepted} onChange={(e) => setAccepted(e.target.value)} />
                  </Field>
                )
              }
              onReload={reload}
              onSubmit={async (remarks) => {
                if (decision === "approve") {
                  const qty = accepted.trim();
                  if (!isDecimalString(qty) || compareDecimalStrings(qty, "0") < 0 || (task.quantity && compareDecimalStrings(qty, task.quantity) > 0)) {
                    throw new ApiError(422, "Accepted quantity must be between 0 and the submitted quantity.", "VALIDATION", [{ field: "accepted_quantity", msg: "Accepted quantity must be between 0 and the submitted quantity." }]);
                  }
                  const partial = task.quantity ? compareDecimalStrings(qty, task.quantity) !== 0 : false;
                  await tasksApi.approve(task.id, { accepted_quantity: partial ? qty : undefined, remarks: remarks || undefined, expected_step: task.approval?.current_step ?? null });
                  toast.success(partial ? "Part of the task accepted. The next pay run pays the accepted quantity." : "Task approved. The next pay run pays it.");
                } else {
                  await tasksApi.reject(task.id, remarks);
                  toast.success("Task rejected. The assignees see your reason.");
                }
                void reload();
              }}
            />
          )}
          <ReasonModal
            open={disputing}
            onOpenChange={setDisputing}
            title="Dispute this task?"
            consequence="The task is held out of pay until you approve or reject it."
            confirmLabel="Dispute"
            onReload={reload}
            onSubmit={async (reason) => {
              await tasksApi.dispute(task.id, reason);
              toast.success("Task disputed. It is excluded from pay until resolved.");
              void reload();
            }}
          />
        </div>
      )}
    </DetailGate>
  );
}
