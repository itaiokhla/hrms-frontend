"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCheck, Inbox, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, PageHeader, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Avatar, Badge, Card, Skeleton } from "@/components/ui/primitives";
import { toApiError } from "@/lib/api";
import { ERROR_TEXT, requestsApi, type InboxItem } from "@/lib/attendanceRequests";
import { canAny } from "@/lib/access";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import { useTabParam } from "@/lib/useTabParam";

const MODULES = [
  { value: "", label: "All modules" },
  { value: "attendance", label: "Attendance" },
  { value: "timesheet", label: "Timesheets" },
  { value: "overtime", label: "Overtime" },
  { value: "task", label: "Tasks" },
  { value: "shift_request", label: "Shift requests" },
  { value: "team_inputs", label: "Team payroll" },
];
const TABS = ["pending", "decided", "stuck"] as const;
type Tab = (typeof TABS)[number];

/**
 * Module-neutral approvals inbox (D-AS-55, XV-REQ-06; 04-attendance/04 §9.8): one list of every engine item the user
 * may decide, filtered by `?module=`. Approve / Reject / Return per row, bulk Approve / Reject for selected rows.
 */
export default function ApprovalsPage() {
  return (
    <RequireAccess check={(me) => canAny(me, [P.ATTENDANCE_APPROVE, P.ATTENDANCE_REGULARIZE, P.OVERTIME_APPROVE,
      P.TASK_APPROVE, P.ATTENDANCE_REQUEST, P.ROSTER_APPROVE])}>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Approvals />
      </Suspense>
    </RequireAccess>
  );
}

function Approvals() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const moduleParam = search?.get("module") ?? "";
  const [tab, setTab] = useTabParam<Tab>(TABS, "pending");
  const setModule = (value: string) => {
    const next = new URLSearchParams(search?.toString() ?? "");
    if (value) next.set("module", value); else next.delete("module");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return (
    <div>
      <PageHeader title="Approvals" description="Everything waiting for your decision, in one place. Nothing is ever approved automatically." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Module" className="w-56">
          <Select data-testid="approvals-module" value={moduleParam} onChange={(e) => setModule(e.target.value)}>
            {MODULES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </Field>
      </div>
      <Tabs tabs={[{ value: "pending", label: "Waiting for me" }, { value: "decided", label: "Decided by me" },
        { value: "stuck", label: "Stuck" }]} value={tab} onValueChange={(v) => setTab(v as Tab)}>
        {TABS.map((t) => (
          <TabPanel key={t} value={t}>{tab === t && <InboxList tab={t} module={moduleParam} />}</TabPanel>
        ))}
      </Tabs>
    </div>
  );
}

function InboxList({ tab, module }: { tab: Tab; module: string }) {
  const { data, loading, error, reload } = useApi(
    () => requestsApi.inbox({ tab, module: module || undefined, limit: 100 }), [tab, module]);
  const [selected, setSelected] = useState<number[]>([]);
  const [deciding, setDeciding] = useState<{ item: InboxItem; decision: "REJECT" | "RETURN" } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const approve = async (item: InboxItem) => {
    setBusy(item.id);
    try {
      await requestsApi.decide(item.id, { decision: "APPROVE", expected_step: item.current_step });
      toast.success("Approved");
      await reload();
    } catch (e) {
      const err = toApiError(e);
      toast.error(ERROR_TEXT[err.code ?? ""] ?? err.message);
    } finally {
      setBusy(null);
    }
  };

  const bulk = async (decision: "APPROVE" | "REJECT") => {
    const result = await requestsApi.decideBulk({ request_ids: selected, decision,
      remarks: decision === "REJECT" ? "Rejected in bulk" : undefined });
    toast.success(`${result.applied} of ${selected.length} ${decision === "APPROVE" ? "approved" : "rejected"}`);
    setSelected([]);
    await reload();
  };

  if (error) return <ErrorState message={error.message} onRetry={() => void reload()} />;
  if (loading || !data) return <Skeleton className="h-64" />;
  if (!data.items.length) {
    return <EmptyState icon={<Inbox />} title={tab === "pending" ? "Nothing waiting for you" : "Nothing here"}
      description={tab === "pending" ? "New requests appear here when they reach your step." : undefined} />;
  }
  return (
    <div className="space-y-3">
      {tab === "pending" && selected.length > 0 && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 text-sm" data-testid="bulk-bar">
          <span>{selected.length} selected</span>
          <Button size="sm" variant="success" onClick={() => void bulk("APPROVE")}><CheckCheck className="h-4 w-4" /> Approve</Button>
          <Button size="sm" variant="danger-ghost" onClick={() => void bulk("REJECT")}>Reject</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
        </motion.div>
      )}
      <AnimatePresence initial={false}>
        {data.items.map((item, index) => (
          <motion.div key={item.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.2, delay: Math.min(index, 8) * 0.03 }}>
            <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center" data-testid={`approval-row-${item.id}`}>
              {tab === "pending" && item.can_act && (
                <input type="checkbox" aria-label="Select" checked={selected.includes(item.id)}
                  onChange={(e) => setSelected((prev) => e.target.checked ? [...prev, item.id] : prev.filter((x) => x !== item.id))} />
              )}
              <Avatar name={item.subject_employee_name ?? "?"} size={36} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{item.subject_employee_name ?? "—"}
                  <span className="ml-2 text-xs text-muted-foreground">{item.module_label}</span></p>
                <p className="text-sm" data-testid="approval-summary">
                  {item.subject?.shift_date && <>{fmtDate(item.subject.shift_date, "EEE d MMM")} · </>}
                  {item.subject?.summary ?? `${item.subject_type} #${item.subject_id}`}
                  {item.subject?.reason_label && <span className="text-muted-foreground"> · {item.subject.reason_label}</span>}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {item.subject?.issues?.some((i) => i.code === "REQUEST_LIMIT_REACHED") && (
                    <Badge tone="warning">Over the employee&apos;s limit</Badge>)}
                  {item.pending_reason === "NO_ELIGIBLE_APPROVER" && <Badge tone="danger">No eligible approver</Badge>}
                  {item.steps.find((s) => s.status === "pending")?.due_at && (
                    <Badge tone="neutral">Due {fmtDate(item.steps.find((s) => s.status === "pending")!.due_at!, "d MMM HH:mm")}</Badge>)}
                  {tab !== "pending" && <Badge tone={item.status === "APPROVED" ? "success" : item.status === "PENDING" ? "warning" : "neutral"}>{item.status.toLowerCase()}</Badge>}
                </div>
              </div>
              {tab === "pending" && item.can_act && (
                <div className="flex gap-2">
                  <Button size="sm" variant="success" loading={busy === item.id} data-testid={`approve-${item.id}`}
                    onClick={() => void approve(item)}><ThumbsUp className="h-4 w-4" /> Approve</Button>
                  {(item.module === "attendance" || item.module === "timesheet") && (
                    <Button size="sm" variant="secondary" data-testid={`return-${item.id}`}
                      onClick={() => setDeciding({ item, decision: "RETURN" })}><RotateCcw className="h-4 w-4" /> Return</Button>
                  )}
                  <Button size="sm" variant="danger-ghost" data-testid={`reject-${item.id}`}
                    onClick={() => setDeciding({ item, decision: "REJECT" })}><ThumbsDown className="h-4 w-4" /> Reject</Button>
                </div>
              )}
            </Card>
          </motion.div>
        ))}
      </AnimatePresence>
      <DecisionModal state={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); void reload(); }} />
    </div>
  );
}

function DecisionModal({ state, onClose, onDone }: {
  state: { item: InboxItem; decision: "REJECT" | "RETURN" } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const verb = state?.decision === "RETURN" ? "Return" : "Reject";
  const save = async () => {
    if (!state) return;
    setSaving(true);
    try {
      await requestsApi.decide(state.item.id, { decision: state.decision, remarks, expected_step: state.item.current_step });
      toast.success(state.decision === "RETURN" ? "Returned to the requester" : "Rejected");
      setRemarks("");
      onDone();
    } catch (e) {
      toast.error(toApiError(e).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={!!state} onOpenChange={(o) => !o && onClose()} title={`${verb} request`}
      description={state?.decision === "RETURN" ? "The requester can edit and resubmit." : "The requester is told the reason."}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button data-testid="decision-confirm" variant={state?.decision === "RETURN" ? "primary" : "danger"} loading={saving}
          disabled={!remarks.trim()} onClick={save}>{verb}</Button></>}>
      <Field label={state?.decision === "RETURN" ? "What should change?" : "Reason"} required>
        <Textarea data-testid="decision-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={1000} />
      </Field>
    </Modal>
  );
}
