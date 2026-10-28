"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Eye, Lock, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { useStepUp } from "@/components/payroll/StepUpAuthModal";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/overlay";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { P } from "@/lib/permissions.generated";

import { CaptureApiError, captureApi, type Evidence, type ReviewItem } from "./captureApi";
import { DECISION_LABEL, FLAG_LABEL, REVIEW_KIND_LABEL, REVIEW_STATUS, SEVERITY, ageText } from "./captureModel";

export function SeverityBadge({ severity }: { severity: string }) {
  const s = SEVERITY[severity] ?? { label: severity, tone: "neutral" as const };
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

export function ReviewStatusBadge({ status }: { status: string }) {
  const s = REVIEW_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/**
 * Masked evidence of one punch (07 §8 E3, 09-ui-ux/02 §3.5 rule 3): "Evidence available · [Reveal]" for holders of
 * `attendance:evidence:read`; the reveal asks for step-up (`STEP_UP_REQUIRED` opens "Confirm it's you") and is
 * audited `EVIDENCE_VIEWED`. Without the permission only the masked line shows.
 */
export function EvidencePanel({ punchId }: { punchId: number }) {
  const { can } = useCan();
  const { withStepUp } = useStepUp();
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = can(P.ATTENDANCE_EVIDENCE_READ);

  const reveal = async () => {
    setBusy(true);
    setError(null);
    try {
      setEvidence(await withStepUp(() => captureApi.revealEvidence(punchId)));
    } catch (e) {
      const err = e as CaptureApiError;
      setError(err.code === "STEP_UP_REQUIRED" ? "Confirm it's you to see the evidence." : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border p-3 text-sm" data-testid="evidence-panel" data-punch-id={punchId}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-medium">
          {evidence ? <Eye className="h-4 w-4 text-primary" aria-hidden /> : <Lock className="h-4 w-4 text-muted-foreground" aria-hidden />}
          Evidence {evidence ? "revealed" : "available"}
        </p>
        {allowed && !evidence && (
          <Button size="sm" variant="secondary" onClick={reveal} loading={busy} data-testid="evidence-reveal">Reveal</Button>
        )}
      </div>
      {!allowed && <p className="mt-1 text-xs text-muted-foreground">Face scores and punch photos need the “Reveal attendance evidence” permission.</p>}
      <AnimatePresence>
        {evidence && (
          <motion.dl initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-3 grid grid-cols-2 gap-2 overflow-hidden text-xs"
            data-testid="evidence-result">
            <div><dt className="text-muted-foreground">Verified by</dt><dd className="font-medium">{evidence.verify_mode ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Face match score</dt><dd className="font-medium tabular-nums">{evidence.face_match_score ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Photo</dt><dd className="font-medium">{evidence.photo_redacted ? "Deleted after retention" : evidence.photo_available ? "Stored" : "None"}</dd></div>
            <div><dt className="text-muted-foreground">Flags</dt><dd className="font-medium">{evidence.evidence_flags.map((f) => FLAG_LABEL[f] ?? f).join(", ") || "None"}</dd></div>
            <p className="col-span-2 text-[11px] text-muted-foreground">This view was recorded in the audit log and is listed on the employee&apos;s privacy page.</p>
          </motion.dl>
        )}
      </AnimatePresence>
      {error && <p role="alert" className="mt-2 text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}

/**
 * The `review-item` view and decision form (09-ui-ux/02 §4.7): what was flagged, for whom, when; Approve / Reject
 * (note required) or Acknowledge for informational kinds; `If-Match` row_version (409 "changed since you opened it").
 * Decisions never change status or pay by themselves (D-AS-28).
 */
export function ReviewItemView({ item, onDecided }: { item: ReviewItem; onDecided?: (item: ReviewItem) => void }) {
  const [choice, setChoice] = useState<string>(item.allowed_actions[0] ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<ReviewItem>(item);
  const noteRequired = choice === "REJECTED";

  const decide = async () => {
    setBusy(true);
    setError(null);
    try {
      const decided = await captureApi.decide(current.id, { status: choice, note: note.trim() || undefined }, current.row_version);
      setCurrent(decided);
      toast.success(`${DECISION_LABEL[choice] ?? "Decided"}: ${REVIEW_KIND_LABEL[decided.kind] ?? decided.kind}`);
      onDecided?.(decided);
    } catch (e) {
      const err = e as CaptureApiError;
      setError(err.code === "ROW_VERSION_CONFLICT" ? "This item changed since you opened it. Reload to see the latest." : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="review-item" data-item-id={current.id} data-kind={current.kind} data-status={current.status}>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={current.severity} />
        <Badge tone="primary">{REVIEW_KIND_LABEL[current.kind] ?? current.kind}</Badge>
        <span data-testid="review-status"><ReviewStatusBadge status={current.status} /></span>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-muted-foreground">Who</dt><dd className="font-medium" data-testid="review-employee">{current.employee_name ?? current.device_user_id ?? "—"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Shift date</dt><dd className="font-medium">{current.shift_date ? fmtDate(current.shift_date, "EEE d MMM yyyy") : "—"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Raised</dt><dd className="font-medium">{fmtDateTime(current.created_at)} · {ageText(current.created_at)} ago</dd></div>
        <div><dt className="text-xs text-muted-foreground">Session</dt><dd className="font-medium">
          {current.session_id ? <Link href={`/attendance/sessions/${current.session_id}`} className="text-primary hover:underline" data-testid="review-session-link">Open session</Link> : "—"}
        </dd></div>
      </dl>
      <p className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        A decision records your review. It never changes the day&apos;s status or pay by itself.
      </p>
      {current.punch_id && <EvidencePanel punchId={current.punch_id} />}

      {current.status === "OPEN" && current.allowed_actions.length > 0 ? (
        <div className="space-y-3 border-t border-border pt-4" data-testid="review-decide">
          <div role="radiogroup" aria-label="Decision" className="flex flex-wrap gap-2">
            {current.allowed_actions.map((a) => (
              <button key={a} type="button" role="radio" aria-checked={choice === a} onClick={() => setChoice(a)}
                data-testid={`review-decision-${a}`}
                className={cn("rounded-xl border px-4 py-2 text-sm font-medium transition",
                  choice === a ? a === "REJECTED" ? "border-danger bg-danger-soft text-danger" : "border-primary bg-primary-soft text-primary"
                    : "border-border text-muted-foreground hover:text-foreground")}>
                {DECISION_LABEL[a] ?? a}
              </button>
            ))}
          </div>
          <Field label={noteRequired ? "Note (required to reject)" : "Note (optional)"}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} data-testid="review-note" />
          </Field>
          {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
          <div className="flex justify-end">
            <Button onClick={decide} loading={busy} disabled={!choice || (noteRequired && !note.trim())} data-testid="review-submit">
              {DECISION_LABEL[choice] ?? "Decide"}
            </Button>
          </div>
        </div>
      ) : (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 rounded-xl bg-success-soft px-3 py-2 text-sm text-success"
          data-testid="review-decided">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Decided{current.decided_at ? ` ${fmtDateTime(current.decided_at)}` : ""}{current.note ? ` · “${current.note}”` : ""}
        </motion.p>
      )}
    </div>
  );
}

/** The `review-item` overlay (non-modal Sheet on wide screens so the queue stays usable). */
export function ReviewItemSheet({ item, onClose, onDecided }: {
  item: ReviewItem | null;
  onClose: () => void;
  onDecided?: (item: ReviewItem) => void;
}) {
  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}
      title={item ? `Review item #${item.id}` : "Review item"}
      description={item ? `${REVIEW_KIND_LABEL[item.kind] ?? item.kind}${item.employee_name ? ` · ${item.employee_name}` : ""}` : undefined}>
      {item && <ReviewItemView key={item.id} item={item} onDecided={onDecided} />}
    </Sheet>
  );
}
