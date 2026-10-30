"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRightLeft,
  Check,
  CornerUpLeft,
  FileQuestion,
  Lock,
  MessageSquare,
  Pencil,
  Send,
  Split,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Switch, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, TabPanel, Tabs } from "@/components/ui/layout";
import { Sheet, useConfirm } from "@/components/ui/overlay";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate, fmtDateTime, fromNow, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import {
  CHANGE_LABEL,
  STATUS_LABEL,
  accessBeyondSelf,
  accessHas,
  categoryLabel,
  leaveApi,
  leaveErrorMessage,
  units,
} from "@/lib/leave/api";
import { emitLeaveChanged, useLeaveChanged } from "@/lib/leave/events";
import type { LeaveAction, LeaveChange, LeaveDetail, LeaveMessage } from "@/lib/leave/types";
import { withStepUp } from "@/lib/payroll/api";
import type { ModalRoute } from "@/lib/useModalRoute";

import { AttachmentUploader } from "./AttachmentUploader";
import { ChangeDialog, DecisionDialog, describeChange } from "./LeaveDialogs";
import { ApprovalSteps, DateRangeText, FlagBadges, IssueList, LeaveStatusChip, LeaveTypeChip } from "./LeaveBits";
import { useLeaveAccess } from "./LeaveAccessContext";

type Dialog = null | "approve" | "reject" | "return" | "change";

/** `?modal=leave&id=` — the request drawer of every leave page (notification links point here). */
export function LeaveRequestDrawer({ route, onEdit }: { route: ModalRoute; onEdit: (id: number) => void }) {
  const raw = route.id;
  const id = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  return (
    <Sheet open={route.open} onOpenChange={route.onOpenChange} title="Leave request" description={id ? `Request #${id}` : undefined} width="max-w-2xl">
      {route.open && id ? (
        <LeaveRequestDetail key={id} id={id} onClose={() => void route.close({ force: true })} onEdit={onEdit} />
      ) : route.open ? (
        <EmptyState title="This request could not be found" />
      ) : null}
    </Sheet>
  );
}

/** Everything about one request: summary, actions, days, approval route, changes, discussion and documents. */
export function LeaveRequestDetail({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (id: number) => void }) {
  const { access } = useLeaveAccess();
  const confirm = useConfirm();
  const { data: leave, error, loading, reload } = useApi(() => leaveApi.get(id), [id]);
  const { data: changes, reload: reloadChanges } = useApi(() => leaveApi.changes(id), [id]);
  const [tab, setTab] = useState("details");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<LeaveAction | null>(null);

  useLeaveChanged(() => {
    void reload();
    void reloadChanges();
  });

  if (error) return <ErrorState message={error.status === 404 ? "This request does not exist or you cannot see it." : error.message} onRetry={() => void reload()} />;
  if (loading && !leave) {
    return (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-10 rounded-xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }
  if (!leave) return null;

  const own = access?.employee_id != null && leave.employee_id === access.employee_id;
  const staff = !own && (leave.can_act || accessHas(access, "leave:approve") || accessBeyondSelf(access, "leave:read"));
  const actions = leave.allowed_actions ?? [];
  const pendingChanges = (changes ?? []).filter((c) => c.status === "PENDING").length;
  const closed = ["REJECTED", "CANCELLED", "WITHDRAWN"].includes(leave.status_v2);

  const after = (message: string) => {
    toast.success(message);
    emitLeaveChanged();
  };

  const run = async (action: LeaveAction, fn: () => Promise<LeaveDetail>, message: string) => {
    setBusy(action);
    try {
      const result = await fn();
      if (result.deleted) {
        after("Draft deleted");
        onClose();
        return;
      }
      after(message);
    } catch (e) {
      toast.error(leaveErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const withdraw = async () => {
    const draft = leave.status_v2 === "DRAFT";
    const ok = await confirm({
      title: draft ? "Delete this draft?" : "Withdraw this request?",
      message: draft ? "The draft is removed. Nothing was sent to your approvers." : "Your approvers stop seeing it and any reserved days go back to your balance.",
      confirmLabel: draft ? "Delete draft" : "Withdraw",
      cancelLabel: "Keep it",
      tone: "danger",
    });
    if (ok) await run("WITHDRAW", () => leaveApi.withdraw(leave.id), "Request withdrawn");
  };

  return (
    <div className="space-y-5" data-testid="leave-detail" data-status={leave.status_v2}>
      {/* ------------------------------------------------ summary */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 rounded-2xl border border-border bg-surface-muted/40 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <LeaveTypeChip name={leave.leave_type_name} token={leave.color_token} pending={leave.status_v2 === "PENDING"} />
          <LeaveStatusChip status={leave.status_v2} />
          {leave.masked && <Badge><Lock className="h-3 w-3" aria-hidden /> Protected</Badge>}
          {leave.cancellation_status === "pending" && <Badge tone="warning">Cancellation pending</Badge>}
          <span className="ms-auto text-xs text-muted-foreground">v{leave.version}</span>
        </div>
        <div>
          <p className="text-lg font-semibold" data-testid="leave-detail-dates">
            <DateRangeText start={leave.start_date} end={leave.end_date} startPortion={leave.start_portion} endPortion={leave.end_portion} />
          </p>
          <p className="text-sm text-muted-foreground">
            {units(leave.number_of_days)}
            {!own && <> · {leave.employee_name}{leave.department ? `, ${leave.department}` : ""}</>}
            {leave.submitted_at && <> · submitted {fromNow(leave.submitted_at)}</>}
          </p>
        </div>
        <FlagBadges flags={[...(leave.is_emergency && !leave.flags.includes("EMERGENCY") ? ["EMERGENCY"] : []), ...leave.flags]} source={leave.source} />
        {leave.reason && <p className="text-sm">“{leave.reason}”</p>}
        {leave.contact_note && <p className="text-xs text-muted-foreground">Contact while away: {leave.contact_note}</p>}
        {leave.parent_leave_id && (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Split className="h-3.5 w-3.5" aria-hidden /> Unpaid part of request #{leave.parent_leave_id}</p>
        )}
      </motion.div>

      {/* ------------------------------------------------ actions */}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="leave-actions">
          {actions.includes("APPROVE") && (
            <Button variant="success" size="sm" onClick={() => setDialog("approve")} disabled={busy !== null} data-testid="leave-action-approve">
              <Check className="h-4 w-4" aria-hidden /> Approve
            </Button>
          )}
          {actions.includes("REJECT") && (
            <Button variant="danger-ghost" size="sm" onClick={() => setDialog("reject")} disabled={busy !== null} data-testid="leave-action-reject">
              <X className="h-4 w-4" aria-hidden /> Reject
            </Button>
          )}
          {actions.includes("RETURN") && access?.return_enabled !== false && (
            <Button variant="secondary" size="sm" onClick={() => setDialog("return")} disabled={busy !== null} data-testid="leave-action-return">
              <CornerUpLeft className="h-4 w-4" aria-hidden /> Return for changes
            </Button>
          )}
          {actions.includes("EDIT") && (
            <Button variant="secondary" size="sm" onClick={() => onEdit(leave.id)} disabled={busy !== null} data-testid="leave-action-edit">
              <Pencil className="h-4 w-4" aria-hidden /> Edit
            </Button>
          )}
          {actions.includes("SUBMIT") && (
            <Button size="sm" loading={busy === "SUBMIT"} disabled={busy !== null} data-testid="leave-action-submit"
              onClick={() => void run("SUBMIT", () => leaveApi.submit(leave.id), leave.status_v2 === "RETURNED" ? "Request resubmitted" : "Request submitted")}>
              <Send className="h-4 w-4" aria-hidden /> {leave.status_v2 === "RETURNED" ? "Resubmit" : "Submit"}
            </Button>
          )}
          {actions.includes("CHANGE") && (
            <Button variant="secondary" size="sm" onClick={() => setDialog("change")} disabled={busy !== null} data-testid="leave-action-change">
              <ArrowRightLeft className="h-4 w-4" aria-hidden /> Change or cancel
            </Button>
          )}
          {actions.includes("WITHDRAW") && (
            <Button variant="danger-ghost" size="sm" loading={busy === "WITHDRAW"} disabled={busy !== null} onClick={() => void withdraw()} data-testid="leave-action-withdraw">
              {leave.status_v2 === "DRAFT" ? <Trash2 className="h-4 w-4" aria-hidden /> : <Undo2 className="h-4 w-4" aria-hidden />}
              {leave.status_v2 === "DRAFT" ? "Delete draft" : "Withdraw"}
            </Button>
          )}
        </div>
      )}
      {leave.status_v2 === "RETURNED" && own && (
        <p className="rounded-xl border border-info/30 bg-info-soft px-3 py-2 text-sm">Your approver sent this back. Read the note in Discussion, edit the request and resubmit it.</p>
      )}

      {/* ------------------------------------------------ tabs */}
      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "details", label: "Details" },
          { value: "changes", label: "Changes", badge: pendingChanges || undefined },
          { value: "discussion", label: "Discussion" },
          { value: "documents", label: "Documents" },
        ]}
      >
        <TabPanel value="details">
          <DetailsTab leave={leave} />
        </TabPanel>
        <TabPanel value="changes">
          <ChangesTab leave={leave} changes={changes} own={own} onChanged={() => { void reloadChanges(); void reload(); emitLeaveChanged(); }} />
        </TabPanel>
        <TabPanel value="discussion">
          <DiscussionTab leaveId={leave.id} staff={staff} enabled={access?.discussion_enabled !== false} />
        </TabPanel>
        <TabPanel value="documents">
          <DocumentsTab leave={leave} canUpload={!closed && (own || actions.includes("EDIT") || actions.includes("WITHDRAW") || accessHas(access, "leave:verify_documents"))} />
        </TabPanel>
      </Tabs>

      {/* ------------------------------------------------ dialogs */}
      <DecisionDialog
        open={dialog === "approve"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Approve this request?"
        description={`${leave.employee_name} · ${units(leave.number_of_days)}`}
        label="Note to the employee (optional)"
        confirmLabel="Approve"
        tone="success"
        testId="approve-dialog"
        onConfirm={async (text) => {
          await withStepUp(() => leaveApi.approve(leave.id, text));
          after("Approved");
        }}
      />
      <DecisionDialog
        open={dialog === "reject"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Reject this request?"
        description="The employee sees your reason."
        label="Reason"
        required
        confirmLabel="Reject"
        tone="danger"
        testId="reject-dialog"
        onConfirm={async (text) => {
          await withStepUp(() => leaveApi.reject(leave.id, text));
          after("Rejected");
        }}
      />
      <DecisionDialog
        open={dialog === "return"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Send back for changes?"
        description="The employee can edit the request and resubmit it."
        label="What should change?"
        required
        confirmLabel="Return"
        testId="return-dialog"
        onConfirm={async (text) => {
          await withStepUp(() => leaveApi.returnForChanges(leave.id, text));
          after("Sent back for changes");
        }}
      />
      {actions.includes("CHANGE") && (
        <ChangeDialog
          leave={leave}
          open={dialog === "change"}
          onOpenChange={(o) => !o && setDialog(null)}
          v2Enabled={!!access?.v2_enabled}
          halfDayEnabled={!!access?.half_day_enabled}
          onDone={() => {
            void reloadChanges();
            setTab("changes");
          }}
        />
      )}
    </div>
  );
}

/* ================================================================ details */
function DetailsTab({ leave }: { leave: LeaveDetail }) {
  return (
    <div className="space-y-5">
      {leave.issues.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Warnings and notes</h3>
          <IssueList issues={leave.issues} testId="leave-detail-issues" />
        </section>
      )}
      {leave.siblings.length > 0 && (
        <section className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-sm" data-testid="leave-siblings">
          <p className="inline-flex items-center gap-1.5 font-medium"><Split className="h-4 w-4 text-warning" aria-hidden /> Split to unpaid leave</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {leave.siblings.map((s) => (
              <li key={s.id}>
                Request #{s.id}: {units(s.number_of_days)} of {titleCase(s.leave_type)} · {STATUS_LABEL[s.status.toUpperCase()] ?? titleCase(s.status)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {leave.days.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Days</h3>
          <ul className="divide-y divide-border/60 rounded-xl border border-border" data-testid="leave-detail-days">
            {leave.days.map((d) => (
              <li key={d.date} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="tabular-nums">{fmtDate(d.date, "EEE, d MMM yyyy")}</span>
                <span className="text-xs text-muted-foreground">
                  {d.portion === "FULL" ? "Full day" : d.portion === "FIRST_HALF" ? "First half" : d.portion === "SECOND_HALF" ? "Second half" : titleCase(d.portion)}
                  {" · "}
                  {d.counted ? `${units(d.units)}${d.charge_reason === "SANDWICH" ? " (sandwich)" : ""}` : "not counted"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="mb-2 text-sm font-semibold">Approval</h3>
        <ApprovalSteps steps={leave.steps} />
        {leave.remarks && <p className="mt-2 text-sm italic text-muted-foreground">“{leave.remarks}”</p>}
      </section>
    </div>
  );
}

/* ================================================================ changes */
function ChangesTab({ leave, changes, own, onChanged }: { leave: LeaveDetail; changes?: LeaveChange[]; own: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<LeaveChange | null>(null);
  const act = async (change: LeaveChange, fn: () => Promise<unknown>, message: string) => {
    setBusy(change.id);
    try {
      await fn();
      toast.success(message);
      onChanged();
    } catch (e) {
      toast.error(leaveErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  if (!changes) return <Skeleton className="h-24 rounded-2xl" />;
  if (!changes.length) {
    return <EmptyState icon={<ArrowRightLeft />} title="No changes yet" description={leave.allowed_actions.includes("CHANGE") ? "Use “Change or cancel” to cancel days, move dates or change the type." : undefined} />;
  }
  return (
    <>
      <ul className="space-y-3" data-testid="leave-changes">
        {changes.map((c) => {
          const pending = c.status === "PENDING";
          const canWithdraw = pending && c.kind !== "RECALL" && !c.can_decide && (own || leave.allowed_actions.includes("CHANGE"));
          const canAck = pending && c.kind === "RECALL" && own;
          return (
            <li key={c.id} className="rounded-xl border border-border p-3 text-sm" data-testid={`leave-change-${c.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{CHANGE_LABEL[c.kind] ?? c.kind}</span>
                <LeaveStatusChip status={c.status} />
                {c.initiator === "EMPLOYER" && <Badge tone="primary">By HR / manager</Badge>}
                <span className="ms-auto text-xs text-muted-foreground">{c.created_at ? fmtDateTime(c.created_at) : ""}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{describeChange(c)}</p>
              {c.reason && <p className="mt-1">“{c.reason}”</p>}
              {c.decision_note && <p className="mt-1 text-xs text-muted-foreground">Decision note: {c.decision_note}</p>}
              {c.applied_at && c.units_delta !== 0 && <p className="mt-1 text-xs text-muted-foreground">Balance effect: {c.units_delta > 0 ? "+" : ""}{c.units_delta}</p>}
              {(c.can_decide || canWithdraw || canAck) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {c.can_decide && (
                    <>
                      <Button size="sm" variant="success" loading={busy === c.id} onClick={() => void act(c, () => withStepUp(() => leaveApi.approveChange(c.id)), "Change approved")} data-testid={`change-approve-${c.id}`}>
                        <Check className="h-4 w-4" aria-hidden /> Approve
                      </Button>
                      <Button size="sm" variant="danger-ghost" disabled={busy === c.id} onClick={() => setRejecting(c)} data-testid={`change-reject-${c.id}`}>
                        <X className="h-4 w-4" aria-hidden /> Reject
                      </Button>
                    </>
                  )}
                  {canWithdraw && (
                    <Button size="sm" variant="ghost" loading={busy === c.id} onClick={() => void act(c, () => leaveApi.withdrawChange(c.id), "Change withdrawn")} data-testid={`change-withdraw-${c.id}`}>
                      <Undo2 className="h-4 w-4" aria-hidden /> Withdraw
                    </Button>
                  )}
                  {canAck && (
                    <Button size="sm" loading={busy === c.id} onClick={() => void act(c, () => leaveApi.acknowledgeChange(c.id), "Recall acknowledged")} data-testid={`change-ack-${c.id}`}>
                      <Check className="h-4 w-4" aria-hidden /> Acknowledge recall
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <DecisionDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title="Reject this change?"
        label="Reason"
        required
        confirmLabel="Reject change"
        tone="danger"
        testId="change-reject-dialog"
        onConfirm={async (text) => {
          if (!rejecting) return;
          await withStepUp(() => leaveApi.rejectChange(rejecting.id, text));
          toast.success("Change rejected");
          onChanged();
        }}
      />
    </>
  );
}

/* ================================================================ discussion */
function DiscussionTab({ leaveId, staff, enabled }: { leaveId: number; staff: boolean; enabled: boolean }) {
  const { data: messages, error, reload, setData } = useApi(() => leaveApi.messages(leaveId), [leaveId]);
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const row = await leaveApi.postMessage(leaveId, text.trim(), staff && internal);
      setData([...(messages ?? []), row]);
      setText("");
      void reload();
    } catch (e) {
      toast.error(leaveErrorMessage(e));
    } finally {
      setSending(false);
    }
  };
  if (error) return <ErrorState message={error.message} onRetry={() => void reload()} />;
  return (
    <div className="space-y-4" data-testid="leave-discussion">
      {!messages ? (
        <Skeleton className="h-24 rounded-2xl" />
      ) : messages.length === 0 ? (
        <EmptyState icon={<MessageSquare />} title="No messages yet" />
      ) : (
        <ol className="space-y-3">
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <MessageItem key={m.id} message={m} />
            ))}
          </AnimatePresence>
        </ol>
      )}
      {enabled ? (
        <div className="space-y-2 rounded-2xl border border-border p-3">
          <label htmlFor={`leave-message-${leaveId}`} className="sr-only">Message</label>
          <Textarea id={`leave-message-${leaveId}`} value={text} maxLength={4000} placeholder={internal ? "Internal note (not shown to the employee)…" : "Write a message…"}
            onChange={(e) => setText(e.target.value)} className="min-h-[72px]" data-testid="leave-message-input" />
          <div className="flex items-center justify-between gap-2">
            {staff ? (
              <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={internal} onChange={setInternal} label="Internal note" />
                Internal note (approvers and HR only)
              </span>
            ) : <span />}
            <Button size="sm" loading={sending} disabled={!text.trim()} onClick={() => void send()} data-testid="leave-message-send">
              <Send className="h-4 w-4" aria-hidden /> Send
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Discussion on leave requests is turned off for your company.</p>
      )}
    </div>
  );
}

function MessageItem({ message: m }: { message: LeaveMessage }) {
  const system = m.kind === "SYSTEM_EVENT";
  const note = m.visibility === "APPROVERS_HR";
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn("flex", m.mine && !system ? "justify-end" : "justify-start")} data-kind={m.kind}>
      {system ? (
        <p className="w-full text-center text-xs text-muted-foreground">{m.body} · {m.created_at ? fromNow(m.created_at) : ""}</p>
      ) : (
        <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", note ? "border border-warning/30 bg-warning-soft" : m.mine ? "bg-primary-soft" : "bg-surface-muted")}>
          <p className="mb-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{m.author ?? "Someone"}</span>
            {note && <Badge tone="warning">Internal note</Badge>}
            {m.kind === "DECISION_NOTE" && <Badge tone="info">Decision</Badge>}
            {m.kind === "DOCUMENT_REQUEST" && <Badge tone="info">Document request</Badge>}
            <span>{m.created_at ? fromNow(m.created_at) : ""}</span>
          </p>
          <p className="whitespace-pre-wrap">{m.body}</p>
        </div>
      )}
    </motion.li>
  );
}

/* ================================================================ documents */
function DocumentsTab({ leave, canUpload }: { leave: LeaveDetail; canUpload: boolean }) {
  const { data: files, error, reload, setData } = useApi(() => leaveApi.attachments(leave.id), [leave.id]);
  const { data: requests } = useApi(() => leaveApi.documentRequests(leave.id), [leave.id]);
  if (error) return <ErrorState message={error.message} onRetry={() => void reload()} />;
  const open = (requests ?? []).filter((r) => r.status === "OPEN" || r.status === "OVERDUE");
  return (
    <div className="space-y-4" data-testid="leave-documents">
      {(requests ?? []).length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Requested documents</h3>
          <ul className="space-y-1.5" data-testid="leave-document-requests">
            {requests!.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                <FileQuestion className="h-4 w-4 text-primary" aria-hidden />
                <span className="font-medium">{categoryLabel(r.category)}</span>
                <span className="text-xs text-muted-foreground">by {fmtDate(r.due_date)}</span>
                <Badge tone={r.status === "FULFILLED" ? "success" : r.status === "OVERDUE" ? "danger" : r.status === "OPEN" ? "warning" : "neutral"} className="ms-auto">
                  {titleCase(r.status.toLowerCase())}
                </Badge>
                {r.note && <p className="w-full text-xs text-muted-foreground">{r.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="mb-2 text-sm font-semibold">Files</h3>
        {!files ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : canUpload ? (
          <AttachmentUploader
            attachments={files}
            leaveId={leave.id}
            suggestedCategory={open[0]?.category ?? null}
            onUploaded={(a) => {
              setData([...(files ?? []), a]);
              void reload();
              emitLeaveChanged();
            }}
          />
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents.</p>
        ) : (
          <AttachmentUploader attachments={files} onUploaded={() => undefined} readOnly leaveId={leave.id} />
        )}
      </section>
    </div>
  );
}
