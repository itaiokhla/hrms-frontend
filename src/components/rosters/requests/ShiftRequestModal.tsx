"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeftRight, Gift, Inbox, Pencil, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { Avatar, Badge, Skeleton } from "@/components/ui/primitives";
import { toApiError } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import {
  reasonText, shiftRequestsApi, type CheckResult, type Coworker, type RequestBody, type RequestPreview,
} from "@/lib/shiftRequests";

import type { RosterEntry } from "../api";

type Kind = RequestBody["kind"];
const KINDS: { value: Kind; label: string; hint: string; icon: typeof ArrowLeftRight }[] = [
  { value: "SWAP", label: "Swap", hint: "Exchange this day with a coworker", icon: ArrowLeftRight },
  { value: "DROP", label: "Give away", hint: "A coworker takes this shift", icon: Gift },
  { value: "RELEASE", label: "Release", hint: "Offer it in the open pool", icon: Inbox },
  { value: "CHANGE", label: "Change", hint: "Another shift or other times", icon: Pencil },
];

function Issues({ items, ack, onAck }: { items: CheckResult[]; ack: string[]; onAck: (k: string) => void }) {
  if (!items.length) return <p className="text-sm text-success" data-testid="request-checks-ok">No rule is broken.</p>;
  return (
    <ul className="space-y-1" data-testid="request-checks">
      {items.map((r, i) => (
        <li key={`${r.rule_key}-${i}`} className="flex items-center gap-2 text-sm">
          <Badge tone={r.severity === "BLOCK" ? "danger" : r.severity === "REQUIRE_REASON" ? "warning" : "neutral"}>{r.severity ?? "WARN"}</Badge>
          <span className="flex-1">{r.message || reasonText(r.rule_key)}</span>
          {r.severity === "WARN" && (
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={ack.includes(r.rule_key)} onChange={() => onAck(r.rule_key)} data-testid={`ack-${r.rule_key}`} /> I understand
            </label>
          )}
        </li>
      ))}
    </ul>
  );
}

/** File a SWAP / DROP / RELEASE / CHANGE on one published entry (03-shifts/03 §12.2): the coworker picker lists only
 * people who can take it; the preview runs every rule before anything is sent. */
export function ShiftRequestModal({ entry, shifts, onClose, onDone }: {
  entry: RosterEntry | null;
  shifts: { id: number; code: string; name?: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<Kind>("SWAP");
  const [target, setTarget] = useState<number | null>(null);
  const [shiftId, setShiftId] = useState<string>("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<RequestPreview | null>(null);
  const [ack, setAck] = useState<string[]>([]);
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const open = entry !== null;
  const peer = kind === "SWAP" || kind === "DROP";
  const { data: coworkers, loading: loadingPeers } = useApi<{ coworkers: Coworker[] } | null>(
    () => (open && peer ? shiftRequestsApi.coworkers(entry!.id, kind as "SWAP" | "DROP") : Promise.resolve(null)),
    [entry?.id, kind, open]);

  useEffect(() => {
    if (!open) return;
    setKind(entry?.kind === "OFF" ? "SWAP" : "SWAP");
    setTarget(null); setShiftId(""); setStart(""); setEnd(""); setReason(""); setPreview(null); setAck([]);
  }, [open, entry?.id]);
  useEffect(() => { setPreview(null); setAck([]); }, [kind, target, shiftId, start, end]);

  const body = (): RequestBody | null => {
    if (!entry) return null;
    const b: RequestBody = { kind, entry_id: entry.id, reason: reason.trim() || undefined, acknowledged_warnings: ack };
    if (peer) {
      if (!target) return null;
      b.target_employee_id = target;
    }
    if (kind === "CHANGE") {
      if (shiftId) b.requested_change = { shift_id: Number(shiftId) };
      else if (start && end) b.requested_change = { custom_start_time: start, custom_end_time: end };
      else return null;
    }
    return b;
  };
  const ready = body() !== null;
  const blocking = preview?.blocking.length ?? 0;
  const needAck = (preview?.results ?? []).filter((r) => r.severity === "WARN").map((r) => r.rule_key).filter((k) => !ack.includes(k));
  const needReason = (preview?.results ?? []).some((r) => r.severity === "REQUIRE_REASON") && reason.trim().length < 3;

  const runPreview = async () => {
    const b = body();
    if (!b) return;
    setBusy("preview");
    try {
      setPreview(await shiftRequestsApi.preview(b));
    } catch (e) {
      toast.error(toApiError(e).message);
    } finally {
      setBusy(null);
    }
  };
  const send = async () => {
    const b = body();
    if (!b) return;
    setBusy("send");
    try {
      const created = await shiftRequestsApi.create(b);
      toast.success(created.status === "APPROVED" ? "Posted to the open pool" : created.status === "PENDING_ACCEPTANCE"
        ? "Sent to your coworker" : "Sent for approval");
      onDone();
    } catch (e) {
      const err = toApiError(e);
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} size="lg"
      title={entry ? `Request a change · ${fmtDate(entry.shift_date)}` : "Request a change"}
      description="You stay scheduled until the request is approved."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="secondary" data-testid="request-preview" disabled={!ready} loading={busy === "preview"} onClick={() => void runPreview()}>Check</Button>
        <Button data-testid="request-send" disabled={!ready || !preview || blocking > 0 || needAck.length > 0 || needReason}
          loading={busy === "send"} onClick={() => void send()}>Send request</Button>
      </>}>
      <div className="space-y-4" data-testid="shift-request-form">
        <div className="grid gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Kind">
          {KINDS.filter((k) => entry?.kind === "WORK" || k.value === "SWAP").map((k) => (
            <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} data-testid={`request-kind-${k.value}`}
              onClick={() => setKind(k.value)}
              className={`rounded-2xl border p-3 text-start transition-colors ${kind === k.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}>
              <k.icon className="mb-1 h-4 w-4 text-primary" />
              <p className="text-sm font-medium">{k.label}</p>
              <p className="text-xs text-muted-foreground">{k.hint}</p>
            </button>
          ))}
        </div>

        {peer && (
          <section className="space-y-2">
            <p className="text-sm font-medium">Coworker</p>
            {loadingPeers && !coworkers ? <Skeleton className="h-24" /> : (
              <ul className="max-h-56 space-y-1 overflow-y-auto" data-testid="request-coworkers">
                {(coworkers?.coworkers ?? []).length === 0 && <li className="text-sm text-muted-foreground">Nobody in your team can take it.</li>}
                {(coworkers?.coworkers ?? []).map((c) => (
                  <li key={c.employee_id}>
                    <button type="button" disabled={!c.eligible} onClick={() => setTarget(c.employee_id)}
                      data-testid={`coworker-${c.employee_id}`}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-start text-sm ${target === c.employee_id ? "border-primary bg-primary/5" : "border-border"} ${c.eligible ? "hover:bg-muted/40" : "opacity-50"}`}>
                      <Avatar name={c.name} size={28} />
                      <span className="flex-1 font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.cell ? (c.cell.kind === "OFF" ? "Off" : c.cell.shift_code ?? `${c.cell.custom_start_time}–${c.cell.custom_end_time}`) : ""}
                      </span>
                      {!c.eligible && <span className="text-xs text-muted-foreground">{c.note}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {kind === "CHANGE" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Another shift">
              <Select data-testid="request-shift" value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
                <option value="">— or set times —</option>
                {shifts.filter((s) => s.id !== entry?.shift_id).map((s) => <option key={s.id} value={s.id}>{s.code}{s.name ? ` · ${s.name}` : ""}</option>)}
              </Select>
            </Field>
            <Field label="From"><Input type="time" value={start} disabled={!!shiftId} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="To"><Input type="time" value={end} disabled={!!shiftId} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
        )}

        <Field label="Reason" hint="Seen by your coworker and the approver only.">
          <Textarea data-testid="request-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        <AnimatePresence>
          {preview && (
            <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="space-y-2 rounded-2xl border border-border p-3" data-testid="request-preview-result">
              <p className="flex items-center gap-2 text-sm font-medium"><ShieldAlert className="h-4 w-4" /> Checks
                {preview.approval_required ? <Badge tone="info">Needs approval</Badge> : <Badge tone="success">No approval needed</Badge>}</p>
              {preview.cutoff_at && <p className="text-xs text-muted-foreground">Must be settled before {fmtDateTime(preview.cutoff_at)}.</p>}
              <Issues items={preview.results} ack={ack} onAck={(k) => setAck((a) => a.includes(k) ? a.filter((x) => x !== k) : [...a, k])} />
              {blocking > 0 && <p className="text-xs text-danger">This change breaks a rule and cannot be sent.</p>}
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}
