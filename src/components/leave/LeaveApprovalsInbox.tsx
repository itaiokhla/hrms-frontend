"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRightLeft, Check, CornerUpLeft, Eye, Banknote, Inbox, Timer, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState, ErrorState, TabPanel, Tabs } from "@/components/ui/layout";
import { Avatar, Badge, Card, Skeleton } from "@/components/ui/primitives";
import { fmtDate, fromNow, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { leaveApi, leaveErrorMessage, units } from "@/lib/leave/api";
import { emitLeaveChanged, useLeaveChanged } from "@/lib/leave/events";
import type { ApprovalsInbox, CompOffClaim, Encashment, InboxRequest, PendingChange } from "@/lib/leave/types";
import { withStepUp } from "@/lib/payroll/api";
import { useTabParam } from "@/lib/useTabParam";

import { DateRangeText, FlagBadges, IssueList, LeaveTypeChip } from "./LeaveBits";
import { DecisionDialog, describeChange } from "./LeaveDialogs";
import { useLeaveAccess } from "./LeaveAccessContext";
import { useLeaveOverlays } from "./LeaveOverlays";

const TABS = ["requests", "changes", "comp-off", "encashments"] as const;
type InboxTab = (typeof TABS)[number];

type Pending =
  | { kind: "reject" | "return"; item: InboxRequest }
  | { kind: "reject-change"; item: PendingChange }
  | { kind: "reject-claim"; item: CompOffClaim }
  | { kind: "reject-encashment"; item: Encashment };

function hours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * One approvals inbox (`GET /leaves/approvals/inbox`): leave requests (approve / reject with a reason / return for
 * changes), changes of approved leave, comp-off claims and encashments. Decided cards slide out.
 */
export function LeaveApprovalsInbox() {
  const { access } = useLeaveAccess();
  const { openLeave } = useLeaveOverlays();
  const { data, error, loading, reload, setData } = useApi(() => leaveApi.inbox(), []);
  const [tab, setTab] = useTabParam<InboxTab>(TABS, "requests");
  const [remarks, setRemarks] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  useLeaveChanged(() => void reload());

  const drop = (key: keyof ApprovalsInbox, id: number) =>
    setData((current) => (current ? { ...current, [key]: (current[key] as { id: number }[]).filter((x) => x.id !== id) } : current) as ApprovalsInbox | undefined);

  const act = async (key: string, fn: () => Promise<unknown>, message: string, list: keyof ApprovalsInbox, id: number) => {
    setBusy(key);
    try {
      await withStepUp(fn);
      toast.success(message);
      drop(list, id);
      emitLeaveChanged();
    } catch (e) {
      toast.error(leaveErrorMessage(e));
      void reload();
    } finally {
      setBusy(null);
    }
  };

  if (error) return <Card><ErrorState message={error.message} onRetry={() => void reload()} /></Card>;
  if (loading && !data) return <div className="space-y-3"><Skeleton className="h-36 rounded-2xl" /><Skeleton className="h-36 rounded-2xl" /></div>;
  const inbox = data ?? { requests: [], changes: [], comp_off_claims: [], encashments: [] };

  return (
    <div data-testid="approvals-inbox">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as InboxTab)}
        tabs={[
          { value: "requests", label: "Leave requests", badge: inbox.requests.length },
          { value: "changes", label: "Changes", badge: inbox.changes.length },
          { value: "comp-off", label: "Comp-off claims", badge: inbox.comp_off_claims.length },
          { value: "encashments", label: "Encashments", badge: inbox.encashments.length },
        ]}
      >
        <TabPanel value="requests">
          <CardList empty="No leave requests waiting for you" emptyHint="Requests routed or delegated to you appear here.">
            {inbox.requests.map((r) => {
              const cancellation = r.status === "approved" && r.cancellation_status === "pending";
              const key = `r${r.id}`;
              return (
                <InboxCard key={key} testId={`approval-card-${r.id}`} label={`Leave request from ${r.employee_name}, ${fmtDate(r.start_date)}`}>
                  <div className="flex min-w-0 flex-1 gap-3">
                    <Avatar name={r.employee_name} size={42} />
                    <div className="min-w-0 space-y-1.5">
                      <p className="font-semibold">{r.employee_name}{r.department && <span className="font-normal text-muted-foreground"> · {r.department}</span>}</p>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <LeaveTypeChip name={r.leave_type_name} token={r.color_token} />
                        <DateRangeText start={r.start_date} end={r.end_date} startPortion={r.start_portion} endPortion={r.end_portion} />
                        <span className="text-muted-foreground">· {units(r.number_of_days)}</span>
                      </div>
                      <FlagBadges flags={r.flags} source={r.source} />
                      {cancellation && <Badge tone="warning">Cancellation request</Badge>}
                      {r.reason && <p className="text-sm">“{r.reason}”</p>}
                      <IssueList issues={r.issues} testId={`approval-issues-${r.id}`} />
                      {r.acting_as && r.acting_as !== "approver" && (
                        <p className="text-xs font-medium text-warning">
                          {r.acting_as === "delegate" ? "You are acting as a delegate for the assigned approver." : "Company-wide override — this will be recorded."}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-2 lg:w-72">
                    <label htmlFor={`remarks-${r.id}`} className="sr-only">Note for {r.employee_name}</label>
                    <Input id={`remarks-${r.id}`} placeholder="Note (optional)" value={remarks[r.id] ?? ""} onChange={(e) => setRemarks({ ...remarks, [r.id]: e.target.value })} data-testid={`approval-remarks-${r.id}`} />
                    <div className="flex gap-2">
                      <Button variant="success" className="flex-1" loading={busy === key} disabled={busy !== null && busy !== key} data-testid={`approval-approve-${r.id}`}
                        onClick={() => void act(key, () => leaveApi.approve(r.id, remarks[r.id]), "Approved", "requests", r.id)}>
                        <Check className="h-4 w-4" aria-hidden /> Approve
                      </Button>
                      <Button variant="danger-ghost" className="flex-1" disabled={busy !== null} onClick={() => setPending({ kind: "reject", item: r })} data-testid={`approval-reject-${r.id}`}>
                        <X className="h-4 w-4" aria-hidden /> Reject
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      {!cancellation && access?.return_enabled !== false && (
                        <Button variant="secondary" size="sm" className="flex-1" disabled={busy !== null} onClick={() => setPending({ kind: "return", item: r })} data-testid={`approval-return-${r.id}`}>
                          <CornerUpLeft className="h-4 w-4" aria-hidden /> Return
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="flex-1" onClick={() => openLeave(r.id)} data-testid={`approval-open-${r.id}`}>
                        <Eye className="h-4 w-4" aria-hidden /> Details
                      </Button>
                    </div>
                    <p className="text-end text-xs text-muted-foreground">Requested {fromNow(r.created_at)}</p>
                  </div>
                </InboxCard>
              );
            })}
          </CardList>
        </TabPanel>

        <TabPanel value="changes">
          <CardList empty="No changes waiting for you" emptyHint="Cancellations and date or type changes of approved leave appear here.">
            {inbox.changes.map((c) => {
              const key = `c${c.id}`;
              return (
                <InboxCard key={key} testId={`change-card-${c.id}`} label={`Change request from ${c.employee_name}`}>
                  <div className="flex min-w-0 flex-1 gap-3">
                    <Avatar name={c.employee_name} size={42} />
                    <div className="min-w-0 space-y-1">
                      <p className="font-semibold">{c.employee_name}</p>
                      <p className="inline-flex items-center gap-1.5 text-sm font-medium"><ArrowRightLeft className="h-4 w-4 text-primary" aria-hidden /> {describeChange(c)}</p>
                      <p className="text-sm text-muted-foreground">
                        {titleCase(c.leave_type)} · <DateRangeText start={c.start_date} end={c.end_date} /> · {units(c.number_of_days)}
                      </p>
                      {c.reason && <p className="text-sm">“{c.reason}”</p>}
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-2 lg:w-60">
                    <div className="flex gap-2">
                      <Button variant="success" className="flex-1" loading={busy === key} disabled={busy !== null && busy !== key} data-testid={`change-approve-${c.id}`}
                        onClick={() => void act(key, () => leaveApi.approveChange(c.id), "Change approved", "changes", c.id)}>
                        <Check className="h-4 w-4" aria-hidden /> Approve
                      </Button>
                      <Button variant="danger-ghost" className="flex-1" disabled={busy !== null} onClick={() => setPending({ kind: "reject-change", item: c })} data-testid={`change-reject-${c.id}`}>
                        <X className="h-4 w-4" aria-hidden /> Reject
                      </Button>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => openLeave(c.leave_id)}><Eye className="h-4 w-4" aria-hidden /> Open leave</Button>
                  </div>
                </InboxCard>
              );
            })}
          </CardList>
        </TabPanel>

        <TabPanel value="comp-off">
          <CardList empty="No comp-off claims waiting for you" emptyHint="Claims for work on holidays and weekly offs appear here.">
            {inbox.comp_off_claims.map((c) => {
              const key = `o${c.id}`;
              return (
                <InboxCard key={key} testId={`claim-card-${c.id}`} label={`Comp-off claim from ${c.employee_name ?? "employee"}`}>
                  <div className="flex min-w-0 flex-1 gap-3">
                    <Avatar name={c.employee_name} size={42} />
                    <div className="min-w-0 space-y-1">
                      <p className="font-semibold">{c.employee_name}</p>
                      <p className="inline-flex items-center gap-1.5 text-sm"><Timer className="h-4 w-4 text-primary" aria-hidden />
                        Worked {fmtDate(c.worked_date, "EEE, d MMM yyyy")} ({c.source === "HOLIDAY_WORK" ? "holiday" : "weekly off"}) · {hours(c.worked_minutes)}
                      </p>
                      <p className="text-sm text-muted-foreground">Credit: {units(c.credit_units)}</p>
                      {c.reason && <p className="text-sm">“{c.reason}”</p>}
                    </div>
                  </div>
                  <div className="flex w-full gap-2 lg:w-60">
                    <Button variant="success" className="flex-1" loading={busy === key} disabled={busy !== null && busy !== key} data-testid={`claim-approve-${c.id}`}
                      onClick={() => void act(key, () => leaveApi.actOnClaim(c.id, "approve"), "Comp-off approved", "comp_off_claims", c.id)}>
                      <Check className="h-4 w-4" aria-hidden /> Approve
                    </Button>
                    <Button variant="danger-ghost" className="flex-1" disabled={busy !== null} onClick={() => setPending({ kind: "reject-claim", item: c })} data-testid={`claim-reject-${c.id}`}>
                      <X className="h-4 w-4" aria-hidden /> Reject
                    </Button>
                  </div>
                </InboxCard>
              );
            })}
          </CardList>
        </TabPanel>

        <TabPanel value="encashments">
          <CardList empty="No encashments waiting for you" emptyHint="Requests to be paid for unused leave appear here.">
            {inbox.encashments.map((e) => {
              const key = `e${e.id}`;
              return (
                <InboxCard key={key} testId={`encashment-card-${e.id}`} label={`Encashment request from ${e.employee_name ?? "employee"}`}>
                  <div className="flex min-w-0 flex-1 gap-3">
                    <Avatar name={e.employee_name} size={42} />
                    <div className="min-w-0 space-y-1">
                      <p className="font-semibold">{e.employee_name}</p>
                      <p className="inline-flex items-center gap-1.5 text-sm"><Banknote className="h-4 w-4 text-primary" aria-hidden /> Encash {units(e.units)} of {titleCase(e.leave_type)}</p>
                      {e.reason && <p className="text-sm">“{e.reason}”</p>}
                      <p className="text-xs text-muted-foreground">Requested {fromNow(e.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex w-full gap-2 lg:w-60">
                    <Button variant="success" className="flex-1" loading={busy === key} disabled={busy !== null && busy !== key} data-testid={`encashment-approve-${e.id}`}
                      onClick={() => void act(key, () => leaveApi.actOnEncashment(e.id, "approve"), "Encashment approved", "encashments", e.id)}>
                      <Check className="h-4 w-4" aria-hidden /> Approve
                    </Button>
                    <Button variant="danger-ghost" className="flex-1" disabled={busy !== null} onClick={() => setPending({ kind: "reject-encashment", item: e })} data-testid={`encashment-reject-${e.id}`}>
                      <X className="h-4 w-4" aria-hidden /> Reject
                    </Button>
                  </div>
                </InboxCard>
              );
            })}
          </CardList>
        </TabPanel>
      </Tabs>

      <DecisionDialog
        open={pending?.kind === "reject" || pending?.kind === "reject-change" || pending?.kind === "reject-claim" || pending?.kind === "reject-encashment"}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === "reject-change" ? "Reject this change?" : pending?.kind === "reject-claim" ? "Reject this comp-off claim?" : pending?.kind === "reject-encashment" ? "Reject this encashment?" : "Reject this request?"}
        description="The employee sees your reason."
        label="Reason"
        required
        confirmLabel="Reject"
        tone="danger"
        testId="inbox-reject-dialog"
        onConfirm={async (text) => {
          if (!pending) return;
          const id = pending.item.id;
          if (pending.kind === "reject") await withStepUp(() => leaveApi.reject(id, text));
          else if (pending.kind === "reject-change") await withStepUp(() => leaveApi.rejectChange(id, text));
          else if (pending.kind === "reject-claim") await leaveApi.actOnClaim(id, "reject", text);
          else if (pending.kind === "reject-encashment") await leaveApi.actOnEncashment(id, "reject", text);
          toast.success("Rejected");
          drop(pending.kind === "reject" ? "requests" : pending.kind === "reject-change" ? "changes" : pending.kind === "reject-claim" ? "comp_off_claims" : "encashments", id);
          emitLeaveChanged();
        }}
      />
      <DecisionDialog
        open={pending?.kind === "return"}
        onOpenChange={(o) => !o && setPending(null)}
        title="Send back for changes?"
        description="The employee can edit the request and resubmit it."
        label="What should change?"
        required
        confirmLabel="Return"
        testId="inbox-return-dialog"
        onConfirm={async (text) => {
          if (pending?.kind !== "return") return;
          await withStepUp(() => leaveApi.returnForChanges(pending.item.id, text));
          toast.success("Sent back for changes");
          drop("requests", pending.item.id);
          emitLeaveChanged();
        }}
      />
    </div>
  );
}

function CardList({ children, empty, emptyHint }: { children: ReactNode[]; empty: string; emptyHint: string }) {
  if (!children.length) return <Card><EmptyState icon={<Inbox />} title={empty} description={emptyHint} /></Card>;
  return (
    <div className="space-y-4">
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </div>
  );
}

function InboxCard({ children, label, testId }: { children: ReactNode; label: string; testId: string }) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}>
      <Card className="p-5" role="article" aria-label={label} data-testid={testId}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">{children}</div>
      </Card>
    </motion.div>
  );
}
