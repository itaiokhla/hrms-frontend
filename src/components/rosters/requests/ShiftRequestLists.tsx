"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeftRight, CalendarOff, CalendarPlus, Check, Hand, Inbox, Plus, Tag, Undo2, X } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Avatar, Badge, Card, Skeleton } from "@/components/ui/primitives";
import { toApiError } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import {
  KIND_LABEL, STATUS_LABEL, consentToConfirm, reasonText, shiftRequestsApi, warningsToConfirm, type Availability, type CheckResult,
  type OpenShift, type RequestError, type ShiftRequest,
} from "@/lib/shiftRequests";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function cellText(r: ShiftRequest): string {
  const e = r.entry;
  if (!e) return "";
  return e.kind === "OFF" ? "Off" : e.shift_code ?? `${e.custom_start_time}–${e.custom_end_time}`;
}

function describe(r: ShiftRequest): string {
  switch (r.kind) {
    case "SWAP": return `${r.requester_name} ⇄ ${r.target_name} · ${fmtDate(r.shift_date)} (${cellText(r)})`;
    case "DROP": return `${r.requester_name} gives ${fmtDate(r.shift_date)} (${cellText(r)}) to ${r.target_name}`;
    case "RELEASE": return `${r.requester_name} releases ${fmtDate(r.shift_date)} (${cellText(r)})`;
    case "PICKUP": return `${r.requester_name} picks up ${fmtDate(r.shift_date)}`;
    case "CHANGE": {
      const c = r.requested_change ?? {};
      const to = r.requested_shift_code ?? (c.custom_start_time ? `${c.custom_start_time}–${c.custom_end_time}` : "?");
      return `${r.requester_name}: ${fmtDate(r.shift_date)} ${cellText(r)} → ${to}`;
    }
  }
}

function refusalText(e: unknown): string {
  const err = e as RequestError;
  const rules = (err.issues ?? []).map((i) => reasonText(i.rule_key));
  return rules.length ? `${err.message} (${rules.join(", ")})` : toApiError(e).message;
}

async function act(run: () => Promise<unknown>, done: string, after: () => void,
  onWarnings?: (issues: CheckResult[]) => void, onConsent?: (noticeHours?: number) => void) {
  try {
    await run();
    toast.success(done);
    after();
  } catch (e) {
    const consent = consentToConfirm(e);
    if (consent && onConsent) {
      onConsent(consent.notice_hours);
      return;
    }
    const issues = warningsToConfirm(e);
    if (issues && onWarnings) {
      onWarnings(issues);
      return;
    }
    toast.error(refusalText(e));
  }
}

/** "This comes with warnings": the WARN results the API asked to acknowledge, and a confirm that resends with them. */
function WarningsConfirm({ issues, action, onConfirm, onCancel }: {
  issues: CheckResult[] | null; action: string; onConfirm: (keys: string[]) => void; onCancel: () => void;
}) {
  return (
    <Modal open={issues !== null} onOpenChange={(o) => !o && onCancel()} title="This comes with warnings"
      description="Nothing is broken, but the schedule would trigger these warnings."
      footer={<><Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button data-testid="warnings-confirm" onClick={() => onConfirm((issues ?? []).map((i) => i.rule_key))}>{action}</Button></>}>
      <ul className="space-y-1 text-sm" data-testid="warnings-list">
        {(issues ?? []).map((i, n) => <li key={`${i.rule_key}-${n}`} className="flex items-center gap-2"><Badge tone="warning">WARN</Badge>{i.message || reasonText(i.rule_key)}</li>)}
      </ul>
    </Modal>
  );
}

/** 03-shifts/03 §7.3: a shift added inside the pack's notice window needs the person's agreement (recorded consent). */
function ConsentConfirm({ open, noticeHours, onConfirm, onCancel }: {
  open: boolean; noticeHours?: number; onConfirm: () => void; onCancel: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const days = noticeHours ? Math.round(noticeHours / 24) : null;
  const close = () => { setAgreed(false); onCancel(); };
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) close(); }} title="Agree to work this shift"
      description={`This shift starts within the schedule notice period${days ? ` (${days} days)` : ""}. Your agreement is recorded with the change.`}
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button>
        <Button data-testid="consent-confirm" disabled={!agreed} onClick={() => { setAgreed(false); onConfirm(); }}>I agree</Button></>}>
      <label className="flex items-start gap-2 text-sm" data-testid="consent-dialog">
        <input type="checkbox" data-testid="consent-check" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>I voluntarily agree to work this shift although it comes with less notice than the schedule rules require.
          I may refuse without any consequence.</span>
      </label>
    </Modal>
  );
}

/** One request card with the actions this viewer may take (API `can`). */
export function RequestCard({ r, onChanged }: { r: ShiftRequest; onChanged: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<{ issues: CheckResult[]; action: "accept" | "approve" } | null>(null);
  const [consent, setConsent] = useState<{ keys: string[]; hours?: number } | null>(null);
  const status = STATUS_LABEL[r.status];
  const warns = r.checks.filter((c) => c.severity === "WARN").map((c) => c.rule_key);
  const accept = (extra: string[] = [], agreed = false) => void act(
    () => shiftRequestsApi.accept(r.id, [...warns, ...extra], agreed), "Accepted",
    () => { setPending(null); setConsent(null); onChanged(); }, (issues) => setPending({ issues, action: "accept" }),
    (hours) => { setPending(null); setConsent({ keys: extra, hours }); });
  const approve = (extra: string[] = []) => void act(() => shiftRequestsApi.approve(r.id, undefined, [...warns, ...extra]),
    "Approved — the schedule changed", () => { setPending(null); onChanged(); }, (issues) => setPending({ issues, action: "approve" }));
  return (
    <motion.li layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-2 px-4 py-3"
      data-testid={`shift-request-${r.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">{KIND_LABEL[r.kind]}</Badge>
        <span className="flex-1 text-sm font-medium">{describe(r)}</span>
        <Badge tone={status.tone} dot><span data-testid="shift-request-status">{status.label}</span></Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Sent {fmtDateTime(r.submitted_at)}{r.expires_at && r.status.startsWith("PENDING") ? ` · cutoff ${fmtDateTime(r.expires_at)}` : ""}
        {r.reason ? ` · “${r.reason}”` : ""}{r.decision_note ? ` · note: ${r.decision_note}` : ""}
        {r.close_reason ? ` · ${reasonText(r.close_reason)}` : ""}
      </p>
      {r.checks.length > 0 && r.status.startsWith("PENDING") && (
        <p className="flex flex-wrap gap-1 text-xs">{r.checks.map((c, i) => <Badge key={i} tone={c.severity === "BLOCK" ? "danger" : "warning"}>{reasonText(c.rule_key)}</Badge>)}</p>
      )}
      {r.can && (r.can.accept || r.can.decline || r.can.withdraw || r.can.approve || r.can.reject) && (
        <div className="flex flex-wrap gap-2">
          {r.can.accept && <Button size="sm" data-testid={`accept-${r.id}`} onClick={() => accept()}><Check className="h-4 w-4" /> Accept</Button>}
          {r.can.decline && <Button size="sm" variant="secondary" data-testid={`decline-${r.id}`} onClick={() => void act(() => shiftRequestsApi.decline(r.id), "Declined", onChanged)}><X className="h-4 w-4" /> Decline</Button>}
          {r.can.approve && <Button size="sm" data-testid={`approve-${r.id}`} onClick={() => approve()}><Check className="h-4 w-4" /> Approve</Button>}
          {r.can.reject && <Button size="sm" variant="secondary" data-testid={`reject-${r.id}`} onClick={() => setRejecting(true)}><X className="h-4 w-4" /> Reject</Button>}
          {r.can.withdraw && <Button size="sm" variant="ghost" data-testid={`withdraw-${r.id}`} onClick={() => void act(() => shiftRequestsApi.withdraw(r.id), "Withdrawn", onChanged)}><Undo2 className="h-4 w-4" /> Withdraw</Button>}
        </div>
      )}
      <Modal open={rejecting} onOpenChange={setRejecting} title="Reject request"
        footer={<><Button variant="secondary" onClick={() => setRejecting(false)}>Cancel</Button>
          <Button data-testid={`reject-confirm-${r.id}`} disabled={note.trim().length < 3}
            onClick={() => void act(() => shiftRequestsApi.reject(r.id, note.trim()), "Rejected", () => { setRejecting(false); onChanged(); })}>Reject</Button></>}>
        <Field label="Reason (shown to the employee)"><Textarea data-testid="reject-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Modal>
      <WarningsConfirm issues={pending?.issues ?? null} action={pending?.action === "approve" ? "Approve anyway" : "Accept anyway"}
        onCancel={() => setPending(null)}
        onConfirm={(keys) => (pending?.action === "approve" ? approve(keys) : accept(keys))} />
      <ConsentConfirm open={consent !== null} noticeHours={consent?.hours} onCancel={() => setConsent(null)}
        onConfirm={() => consent && accept(consent.keys, true)} />
    </motion.li>
  );
}

/** My requests and the requests coworkers sent me. */
export function MyShiftRequests({ onChanged }: { onChanged?: () => void }) {
  const mine = useApi(() => shiftRequestsApi.list("mine"), []);
  const incoming = useApi(() => shiftRequestsApi.list("incoming"), []);
  const reload = () => { void mine.reload(); void incoming.reload(); onChanged?.(); };
  const waiting = (incoming.data?.items ?? []).filter((r) => r.status === "PENDING_ACCEPTANCE");
  return (
    <div className="space-y-4" data-testid="my-shift-requests">
      <Card className="p-0">
        <p className="flex items-center gap-2 border-b border-border px-4 py-3 font-medium"><Inbox className="h-4 w-4" /> Asked of me
          {waiting.length > 0 && <Badge tone="info" data-testid="incoming-count">{waiting.length}</Badge>}</p>
        {incoming.error ? <ErrorState message={incoming.error.message} onRetry={incoming.reload} /> :
          !incoming.data ? <Skeleton className="m-4 h-16" /> : incoming.data.items.length === 0 ?
            <p className="px-4 py-3 text-sm text-muted-foreground">Nobody asked you to swap or take a shift.</p> : (
              <ul className="divide-y divide-border">{incoming.data.items.map((r) => <RequestCard key={r.id} r={r} onChanged={reload} />)}</ul>
            )}
      </Card>
      <Card className="p-0">
        <p className="flex items-center gap-2 border-b border-border px-4 py-3 font-medium"><ArrowLeftRight className="h-4 w-4" /> My requests</p>
        {mine.error ? <ErrorState message={mine.error.message} onRetry={mine.reload} /> :
          !mine.data ? <Skeleton className="m-4 h-16" /> : mine.data.items.length === 0 ?
            <p className="px-4 py-3 text-sm text-muted-foreground">Pick a day on your schedule and choose Request change.</p> : (
              <ul className="divide-y divide-border"><AnimatePresence initial={false}>{mine.data.items.map((r) => <RequestCard key={r.id} r={r} onChanged={reload} />)}</AnimatePresence></ul>
            )}
      </Card>
    </div>
  );
}

/** Approvers' queue (PENDING_APPROVAL in their roster:approve scope, never their own). */
export function ShiftRequestApprovals() {
  const { data, error, reload } = useApi(() => shiftRequestsApi.list("approvals"), []);
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (!data) return <Skeleton className="h-32" />;
  return (
    <Card className="p-0" data-testid="shift-request-approvals">
      {data.items.length === 0 ? <EmptyState icon={<Inbox />} title="Nothing to approve" description="Swaps, changes and pickups waiting for you appear here." /> : (
        <ul className="divide-y divide-border">{data.items.map((r) => <RequestCard key={r.id} r={r} onChanged={reload} />)}</ul>
      )}
    </Card>
  );
}

/** Open shifts: employees claim (acknowledging warnings), planners post / cancel and approve claims. */
export function OpenShiftsBoard({ branches, shifts }: {
  branches?: { id: number; name: string }[]; shifts?: { id: number; code: string }[];
}) {
  const { data, error, reload } = useApi(() => shiftRequestsApi.openShifts(), []);
  const [posting, setPosting] = useState(false);
  const [detail, setDetail] = useState<OpenShift | null>(null);
  const [form, setForm] = useState({ branch_id: "", shift_date: "", shift_id: "", required_count: "1", tags: "", approval: true });
  const [confirm, setConfirm] = useState<{ shift: OpenShift; issues: CheckResult[] } | null>(null);
  const [consent, setConsent] = useState<{ shift: OpenShift; keys: string[]; hours?: number } | null>(null);

  const claim = (s: OpenShift, extra: string[] = [], agreed = false) => void act(
    () => shiftRequestsApi.claim(s.id, [...(s.warnings ?? []), ...extra], undefined, agreed),
    s.approval_required ? "Claim sent for approval" : "The shift is yours",
    () => { setConfirm(null); setConsent(null); void reload(); }, (issues) => setConfirm({ shift: s, issues }),
    (hours) => { setConfirm(null); setConsent({ shift: s, keys: extra, hours }); });
  const post = async () => {
    try {
      await shiftRequestsApi.postOpenShift({ branch_id: Number(form.branch_id), shift_date: form.shift_date,
        shift_id: Number(form.shift_id), required_count: Number(form.required_count) || 1,
        required_tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean), approval_required: form.approval });
      toast.success("Open shift posted");
      setPosting(false);
      void reload();
    } catch (e) {
      toast.error(toApiError(e).message);
    }
  };
  const openDetail = async (s: OpenShift) => {
    try { setDetail(await shiftRequestsApi.openShift(s.id)); } catch (e) { toast.error(toApiError(e).message); }
  };

  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (!data) return <Skeleton className="h-40" />;
  return (
    <div className="space-y-3" data-testid="open-shifts">
      {data.can_post && (
        <div className="flex justify-end"><Button data-testid="open-shift-post" onClick={() => setPosting(true)}><Plus className="h-4 w-4" /> Post open shift</Button></div>
      )}
      {data.items.length === 0 ? <Card><EmptyState icon={<CalendarPlus />} title="No open shifts" description="Shifts offered to the team appear here." /></Card> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {data.items.map((s, i) => (
              <motion.div key={s.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.03 }}>
                <Card className="space-y-2 p-4" data-testid={`open-shift-${s.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{fmtDate(s.shift_date)} · {s.shift_code ?? `${s.custom_start_time}–${s.custom_end_time}`}</p>
                      <p className="text-xs text-muted-foreground">{s.source === "RELEASED" ? "Released by a coworker" : s.source === "UNCOVERED" ? "Cover needed" : "Extra shift"} · {s.filled_count}/{s.required_count} filled</p>
                    </div>
                    <Badge tone={s.status === "OPEN" ? "info" : s.status === "FILLED" ? "success" : "neutral"}><span data-testid="open-shift-status">{s.status}</span></Badge>
                  </div>
                  {s.required_tags.length > 0 && <p className="flex flex-wrap gap-1 text-xs"><Tag className="h-3 w-3" />{s.required_tags.map((t) => <Badge key={t}>{t}</Badge>)}</p>}
                  {(s.warnings ?? []).length > 0 && <p className="text-xs text-warning">{(s.warnings ?? []).map(reasonText).join(" · ")} — claiming confirms you understand.</p>}
                  {s.reasons && s.reasons.length > 0 && <p className="text-xs text-muted-foreground">{s.reasons.map(reasonText).join(" · ")}</p>}
                  {s.my_claim && <p className="text-xs"><Badge tone={STATUS_LABEL[s.my_claim.status].tone}>Your claim: {STATUS_LABEL[s.my_claim.status].label}</Badge></p>}
                  <div className="flex flex-wrap gap-2">
                    {s.can_claim && <Button size="sm" data-testid={`claim-${s.id}`} onClick={() => claim(s)}><Hand className="h-4 w-4" /> Claim</Button>}
                    {data.can_post && <Button size="sm" variant="secondary" data-testid={`open-shift-claims-${s.id}`} onClick={() => void openDetail(s)}>Claims ({s.pending_claims})</Button>}
                    {data.can_post && s.status === "OPEN" && <Button size="sm" variant="ghost" data-testid={`open-shift-cancel-${s.id}`}
                      onClick={() => void act(() => shiftRequestsApi.cancelOpenShift(s.id), "Cancelled", reload)}><CalendarOff className="h-4 w-4" /> Cancel</Button>}
                  </div>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
      <Modal open={posting} onOpenChange={setPosting} title="Post an open shift"
        footer={<><Button variant="secondary" onClick={() => setPosting(false)}>Cancel</Button>
          <Button data-testid="open-shift-submit" disabled={!form.branch_id || !form.shift_date || !form.shift_id} onClick={() => void post()}>Post</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2" data-testid="open-shift-form">
          <Field label="Branch"><Select data-testid="open-shift-branch" value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
            <option value="">Choose</option>{(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
          <Field label="Date"><Input type="date" data-testid="open-shift-date" value={form.shift_date} onChange={(e) => setForm({ ...form, shift_date: e.target.value })} /></Field>
          <Field label="Shift"><Select data-testid="open-shift-shift" value={form.shift_id} onChange={(e) => setForm({ ...form, shift_id: e.target.value })}>
            <option value="">Choose</option>{(shifts ?? []).map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</Select></Field>
          <Field label="People needed"><Input type="number" min={1} max={50} data-testid="open-shift-count" value={form.required_count} onChange={(e) => setForm({ ...form, required_count: e.target.value })} /></Field>
          <Field label="Required skill tags (comma separated)" className="sm:col-span-2"><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="FORKLIFT" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.approval} onChange={(e) => setForm({ ...form, approval: e.target.checked })} /> Claims need approval</label>
        </div>
      </Modal>
      <WarningsConfirm issues={confirm?.issues ?? null} action="Claim anyway" onCancel={() => setConfirm(null)}
        onConfirm={(keys) => confirm && claim(confirm.shift, keys)} />
      <ConsentConfirm open={consent !== null} noticeHours={consent?.hours} onCancel={() => setConsent(null)}
        onConfirm={() => consent && claim(consent.shift, consent.keys, true)} />
      <Modal open={detail !== null} onOpenChange={(o) => !o && setDetail(null)} size="lg" title={detail ? `Claims · ${fmtDate(detail.shift_date)}` : "Claims"}>
        {detail && ((detail.claims ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No claims yet.</p> : (
          <ul className="divide-y divide-border" data-testid="open-shift-claim-list">
            {(detail.claims ?? []).map((r) => <RequestCard key={r.id} r={r} onChanged={() => { void openDetail(detail); void reload(); }} />)}
          </ul>
        ))}
      </Modal>
    </div>
  );
}

/** My availability (UNAVAILABLE / PREFERRED windows) and, for planners, the team's pending ones. */
export function AvailabilityPanel({ planner }: { planner?: boolean }) {
  const mine = useApi(() => (planner ? Promise.resolve({ items: [] as Availability[] }) : shiftRequestsApi.myAvailability()), [planner]);
  const team = useApi(() => (planner ? shiftRequestsApi.teamAvailability() : Promise.resolve({ items: [] as Availability[] })), [planner]);
  const [form, setForm] = useState({ kind: "UNAVAILABLE" as "UNAVAILABLE" | "PREFERRED", weekday: "", start_date: "", end_date: "", start_time: "", end_time: "", note: "" });
  const add = async () => {
    try {
      await shiftRequestsApi.addAvailability({ kind: form.kind, weekday: form.weekday === "" ? null : Number(form.weekday),
        start_date: form.start_date, end_date: form.end_date || null, start_time: form.start_time || null,
        end_time: form.end_time || null, note: form.note || undefined });
      toast.success("Availability sent");
      setForm({ ...form, note: "" });
      void mine.reload();
    } catch (e) {
      toast.error(toApiError(e).message);
    }
  };
  const rows = planner ? team.data?.items : mine.data?.items;
  const describe = (a: Availability) => `${a.kind === "UNAVAILABLE" ? "Unavailable" : "Prefers"} ${a.weekday !== null ? `every ${WEEKDAYS[a.weekday]}` : ""} from ${fmtDate(a.start_date)}${a.end_date ? ` to ${fmtDate(a.end_date)}` : ""}${a.start_time ? `, ${a.start_time}–${a.end_time}` : ", all day"}`;
  return (
    <div className="space-y-4" data-testid="availability-panel">
      {!planner && (
        <Card className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6 lg:items-end">
          <Field label="I am"><Select data-testid="availability-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "UNAVAILABLE" | "PREFERRED" })}>
            <option value="UNAVAILABLE">Unavailable</option><option value="PREFERRED">Prefer to work</option></Select></Field>
          <Field label="Every"><Select data-testid="availability-weekday" value={form.weekday} onChange={(e) => setForm({ ...form, weekday: e.target.value })}>
            <option value="">Dates only</option>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></Field>
          <Field label="From"><Input type="date" data-testid="availability-from" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
          <Field label="Until"><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
          <Field label="Times (optional)"><div className="flex gap-1"><Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /><Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div></Field>
          <Button data-testid="availability-add" disabled={!form.start_date} onClick={() => void add()}><Plus className="h-4 w-4" /> Add</Button>
        </Card>
      )}
      <Card className="p-0">
        <ul className="divide-y divide-border">
          {(rows ?? []).length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">{planner ? "No availability to review." : "You have not set any availability."}</li>}
          {(rows ?? []).map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm" data-testid={`availability-${a.id}`}>
              {planner && <Avatar name={a.employee_name ?? "?"} size={28} />}
              <span className="flex-1">{planner && <span className="font-medium">{a.employee_name} · </span>}{describe(a)}{a.note ? ` — ${a.note}` : ""}</span>
              <Badge tone={a.status === "APPROVED" ? "success" : a.status === "PENDING" ? "info" : "neutral"}><span data-testid="availability-status">{a.status}</span></Badge>
              {planner && a.status === "PENDING" && <>
                <Button size="sm" data-testid={`availability-approve-${a.id}`} onClick={() => void act(() => shiftRequestsApi.decideAvailability(a.id, "approve"), "Approved", team.reload)}>Approve</Button>
                <Button size="sm" variant="secondary" onClick={() => void act(() => shiftRequestsApi.decideAvailability(a.id, "reject"), "Rejected", team.reload)}>Reject</Button>
              </>}
              {!planner && (a.status === "PENDING" || a.status === "APPROVED") && (
                <Button size="sm" variant="ghost" onClick={() => void act(() => shiftRequestsApi.cancelAvailability(a.id), "Cancelled", mine.reload)}>Cancel</Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
