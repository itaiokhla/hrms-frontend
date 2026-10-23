"use client";

import { ArrowUpRight, ChevronDown, Lock, MoreHorizontal, PauseCircle, RefreshCw, ShieldAlert, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import toast from "react-hot-toast";

import { MoneyText } from "@/components/payroll/MoneyText";
import { useStepUp } from "@/components/payroll/StepUpAuthModal";
import { TypedConfirmModal } from "@/components/payroll/TypedConfirmModal";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { DropdownMenu, MenuItem, Modal, useConfirm } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/hooks";
import { isConflict, newIdempotencyKey, stepUpApi } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { runsApi } from "./api";
import { canApproveReversal, canHold, canRequestReversal, hasAction, useRun } from "./context";
import { ConflictBanner, MoneyStack, Notice, figureByCurrency, humanize, primaryLink } from "./shared";
import type { FinalizationStatus } from "./types";

/* ------------------------------------------------------------------ action bar (3.8 §5.3 action bar rules) */

type ReasonAction = "SUBMIT" | "CANCEL" | "REOPEN" | "REWORK" | "CLOSE" | "RESUME";

/**
 * Only the actions valid for the run's state and the viewer (server-computed `available_actions`,
 * plus the approval request's `can_act` for approve / reject), never two contradictory primary
 * buttons, and everything disabled while a calculation job runs.
 */
export function RunActionBar({ onHold }: { onHold: () => void }) {
  const { run, me, approval, calculating, startCalculation, reload } = useRun();
  const confirm = useConfirm();
  const action = useModalRoute("run-action", { keys: ["action"] });
  const approve = useModalRoute("approve", { keys: ["run", "decision"] });
  const finalize = useModalRoute("finalize", { keys: ["run"] });
  const reverse = useModalRoute("reverse", { keys: ["run"] });
  const [busy, setBusy] = useState<string | null>(null);
  const has = (...a: string[]) => hasAction(run, ...a);
  const canApprove = has("APPROVE_STEP", "APPROVE_FINAL") && approval?.can_act === true;
  const canReject = has("REJECT") && approval?.can_act === true;
  const disabled = calculating || !!busy;

  const precheck = async () => {
    setBusy("precheck");
    try {
      const result = await runsApi.precheck(run.id, run.row_version);
      if (result.blocking > 0) toast.error(`Pre-checks found ${result.blocking} blocking item(s) — fix them on the Exceptions tab`);
      else toast.success("Pre-checks passed — the run is ready to calculate");
      reload();
    } catch (error) {
      if (isConflict(error)) reload();
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const calculate = async () => {
    const first = run.status === "READY";
    const ok = await confirm({
      title: first ? "Lock inputs and calculate?" : "Recalculate every employee?",
      message: first
        ? `Inputs (attendance, leave, wage inputs, salaries) are locked for the ${run.population?.included ?? ""} included employees and a calculation starts. Changes made after this show as "inputs changed since lock".`
        : "Every included employee is calculated again from fresh inputs. Acknowledged variance stays acknowledged only where nothing changed.",
      confirmLabel: first ? "Lock & calculate" : "Recalculate all",
      tone: "primary",
    });
    if (!ok) return;
    setBusy("calculate");
    try {
      await startCalculation();
    } finally {
      setBusy(null);
    }
  };

  // The one primary action of this state.
  let primary: ReactNode = null;
  const secondary: ReactNode[] = [];
  const more: ReactNode[] = [];

  if (has("PRECHECK_PASSED", "PRECHECK_BLOCKED")) {
    primary = (
      <Button key="precheck" onClick={precheck} loading={busy === "precheck"} disabled={disabled}>
        <ShieldAlert className="h-4 w-4" aria-hidden /> Run pre-checks
      </Button>
    );
  }
  if (has("CALCULATE")) {
    primary = (
      <Button key="calc" onClick={calculate} loading={busy === "calculate"} disabled={disabled}>
        <Lock className="h-4 w-4" aria-hidden /> Lock &amp; calculate
      </Button>
    );
  }
  if (has("RECALCULATE")) {
    const button = (
      <Button key="recalc" variant={run.status === "VALIDATION_FAILED" ? "primary" : "secondary"} onClick={calculate} loading={busy === "calculate"} disabled={disabled}>
        <RefreshCw className="h-4 w-4" aria-hidden /> Recalculate
      </Button>
    );
    if (run.status === "VALIDATION_FAILED" && !primary) primary = button;
    else secondary.push(button);
  }
  if (canHold(me, run)) {
    secondary.push(
      <Button key="hold" variant="secondary" onClick={onHold} disabled={disabled}>
        <PauseCircle className="h-4 w-4" aria-hidden /> Hold employee
      </Button>,
    );
  }
  if (has("SUBMIT_FOR_APPROVAL")) {
    primary = (
      <Button key="submit" onClick={() => action.openModal({ action: "SUBMIT" })} disabled={disabled || run.stale} title={run.stale ? "Recalculate the changed employees first" : undefined}>
        Submit for approval
      </Button>
    );
  }
  if (canApprove) {
    primary = (
      <Button key="approve" variant="success" onClick={() => approve.openModal({ run: run.id, decision: "approve" })} disabled={disabled}>
        Approve
      </Button>
    );
  }
  if (canReject) {
    secondary.push(
      <Button key="reject" variant="danger-ghost" onClick={() => approve.openModal({ run: run.id, decision: "reject" })} disabled={disabled}>
        Reject
      </Button>,
    );
  }
  if (has("REWORK")) {
    primary = primary ?? (
      <Button key="rework" onClick={() => action.openModal({ action: "REWORK" })} disabled={disabled}>
        Return to review
      </Button>
    );
  }
  if (has("RESUME_REVIEW", "RETURN_TO_DRAFT")) {
    primary = (
      <Button key="resume" onClick={() => action.openModal({ action: "RESUME" })} disabled={disabled}>
        Continue the correction
      </Button>
    );
  }
  if (has("FINALIZE")) {
    primary = (
      <Button key="finalize" onClick={() => finalize.openModal({ run: run.id })} disabled={disabled}>
        Finalize
      </Button>
    );
  }
  if (run.status === "FINALIZED" && can(me, P.PAYROLL_PAYMENT_PREPARE)) {
    primary = (
      <Link key="pay" href={`/payroll/payments?modal=new-batch&run=${run.id}`} className={primaryLink}>
        Prepare payments <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
      </Link>
    );
  }
  if (has("CLOSE")) {
    const button = (
      <Button key="close" variant={primary ? "secondary" : "primary"} onClick={() => action.openModal({ action: "CLOSE" })} disabled={disabled}>
        Close run
      </Button>
    );
    if (!primary) primary = button;
    else secondary.push(button);
  }
  if (has("REOPEN")) {
    more.push(
      <MenuItem key="reopen" icon={<Undo2 className="h-4 w-4" />} onSelect={() => action.openModal({ action: "REOPEN" })}>
        Reopen for correction
      </MenuItem>,
    );
  }
  const reversible = canRequestReversal(me, run) || canApproveReversal(me, run);
  if (reversible) {
    more.push(
      <MenuItem key="reverse" icon={<Undo2 className="h-4 w-4" />} onSelect={() => reverse.openModal({ run: run.id })}>
        {canRequestReversal(me, run) ? "Reverse run…" : "Reversal requests…"}
      </MenuItem>,
    );
  }
  if (has("CANCEL")) {
    more.push(
      <MenuItem key="cancel" tone="danger" onSelect={() => action.openModal({ action: "CANCEL" })}>
        Cancel run
      </MenuItem>,
    );
  }

  const nothing = !primary && !secondary.length && !more.length;
  return (
    <>
      <div
        className={cn(
          "flex flex-wrap items-center justify-end gap-2",
          // Sticky bottom action bar on phones (3.8 §10).
          "max-md:sticky max-md:bottom-0 max-md:z-20 max-md:-mx-4 max-md:border-t max-md:border-border max-md:bg-surface/95 max-md:px-4 max-md:py-3 max-md:backdrop-blur",
        )}
        role="toolbar"
        aria-label="Run actions"
      >
        {nothing && <p className="text-sm text-muted-foreground">No action for you at this stage.</p>}
        {more.length > 0 && (
          <DropdownMenu
            align="end"
            trigger={
              <Button variant="ghost" className="min-h-[44px]" disabled={disabled} aria-label="More run actions">
                <MoreHorizontal className="h-4 w-4" aria-hidden /> More <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </Button>
            }
          >
            {more}
          </DropdownMenu>
        )}
        {secondary}
        {primary}
      </div>
      <RunActionModal open={action.open} kind={(action.param("action") as ReasonAction | null) ?? null} onOpenChange={action.onOpenChange} onDone={() => void action.close().then(reload)} />
      <ApproveModal open={approve.open && canApprove} decision={approve.param("decision") === "reject" ? "reject" : "approve"} onOpenChange={approve.onOpenChange} onDone={() => void approve.close().then(reload)} />
      <FinalizeModal open={finalize.open && has("FINALIZE")} onOpenChange={finalize.onOpenChange} onDone={() => void finalize.close().then(reload)} />
      <ReverseModal open={reverse.open && reversible} onOpenChange={reverse.onOpenChange} onDone={() => void reverse.close().then(reload)} />
    </>
  );
}

/* ------------------------------------------------------------------ reason / comment actions */

const ACTION_COPY: Record<ReasonAction, { title: string; message: string; label: string; field: string; required: boolean; tone?: "danger" }> = {
  SUBMIT: {
    title: "Submit for approval",
    message: "The run goes to its approval chain. Nobody can change it while it waits; an approver can reject it back to you.",
    label: "Submit for approval",
    field: "Comment for the approvers (optional)",
    required: false,
  },
  CANCEL: {
    title: "Cancel this run",
    message: "Cancelling stops the run for good. Reserved wage inputs are released for another run. This can't be undone.",
    label: "Cancel run",
    field: "Reason",
    required: true,
    tone: "danger",
  },
  REOPEN: {
    title: "Reopen for correction",
    message: "Approvals given so far are cleared and the run leaves the approval chain. You then return to review or to a fresh draft.",
    label: "Reopen",
    field: "Reason",
    required: true,
  },
  REWORK: {
    title: "Return to review",
    message: "The rejected run goes back to review so you can fix what the approver raised and submit again.",
    label: "Return to review",
    field: "Note (optional)",
    required: false,
  },
  CLOSE: {
    title: "Close this run",
    message: "Closing ends the run's lifecycle. Employees still on hold are carried to the carried-holds list.",
    label: "Close run",
    field: "Note (optional)",
    required: false,
  },
  RESUME: {
    title: "Continue the correction",
    message: "Return to review to keep the calculated results, or back to a draft to lock the inputs again.",
    label: "Continue",
    field: "Reason",
    required: true,
  },
};

function RunActionModal({ open, kind, onOpenChange, onDone }: { open: boolean; kind: ReasonAction | null; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { run } = useRun();
  const [text, setText] = useState("");
  const [target, setTarget] = useState<"REVIEW_REQUIRED" | "DRAFT">("REVIEW_REQUIRED");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) {
      setText("");
      setError(null);
      setTouched(false);
      setTarget(run.available_actions.includes("RESUME_REVIEW") ? "REVIEW_REQUIRED" : "DRAFT");
    }
  }, [open, run.available_actions]);
  const copy = kind ? ACTION_COPY[kind] : null;
  if (!copy || !kind) return null;
  const missing = copy.required && !text.trim();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (missing || busy) return;
    setBusy(true);
    setError(null);
    try {
      const v = run.row_version;
      if (kind === "SUBMIT") await runsApi.submit(run.id, text.trim(), v);
      else if (kind === "CANCEL") await runsApi.cancel(run.id, text.trim(), v);
      else if (kind === "REOPEN") await runsApi.reopen(run.id, { reason: text.trim(), row_version: v });
      else if (kind === "RESUME") await runsApi.reopen(run.id, { reason: text.trim(), target, row_version: v });
      else if (kind === "REWORK") await runsApi.rework(run.id, text.trim(), v);
      else if (kind === "CLOSE") await runsApi.close(run.id, text.trim(), v);
      toast.success(
        kind === "SUBMIT"
          ? "Run submitted — the approvers have been notified"
          : kind === "CANCEL"
            ? "Run cancelled"
            : kind === "CLOSE"
              ? "Run closed"
              : kind === "REWORK"
                ? "Run returned to review"
                : "Run reopened for correction",
      );
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={copy.title}
      size="md"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button type="submit" form="run-action-form" variant={copy.tone === "danger" ? "danger" : "primary"} loading={busy}>
            {copy.label}
          </Button>
        </>
      }
    >
      <form id="run-action-form" onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm">{copy.message}</p>
        <ConflictBanner error={error} onReload={() => onDone()} />
        {!!error && !isConflict(error) && (
          <Notice tone="danger" title="That didn't work">
            {errorMessage(error)}
          </Notice>
        )}
        {kind === "RESUME" && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Continue with</legend>
            {run.available_actions.includes("RESUME_REVIEW") && (
              <label className="flex min-h-[44px] items-center gap-3 rounded-xl border border-border px-3 text-sm">
                <input type="radio" name="target" checked={target === "REVIEW_REQUIRED"} onChange={() => setTarget("REVIEW_REQUIRED")} />
                Review the calculated results again
              </label>
            )}
            {run.available_actions.includes("RETURN_TO_DRAFT") && (
              <label className="flex min-h-[44px] items-center gap-3 rounded-xl border border-border px-3 text-sm">
                <input type="radio" name="target" checked={target === "DRAFT"} onChange={() => setTarget("DRAFT")} />
                Back to a draft (inputs unlocked)
              </label>
            )}
          </fieldset>
        )}
        <Field label={copy.field} required={copy.required} error={touched && missing ? "Give a reason." : undefined}>
          <Textarea rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ approve / reject (3.8 §6, `?modal=approve&run=`) */

function ApproveModal({ open, decision, onOpenChange, onDone }: { open: boolean; decision: "approve" | "reject"; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { run, approval } = useRun();
  const [choice, setChoice] = useState(decision);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);
  const summary = useApi(() => runsApi.summary(run.id), [run.id, open], { enabled: open });
  useEffect(() => {
    if (open) setChoice(decision);
    else {
      setComment("");
      setError(null);
      setTouched(false);
    }
  }, [open, decision]);
  const missing = choice === "reject" && !comment.trim();
  const pendingVariance = summary.data?.exceptions.variance_pending ?? 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (missing || busy) return;
    setBusy(true);
    setError(null);
    try {
      const step = approval?.current_step ?? null;
      if (choice === "approve") {
        await runsApi.approve(run.id, { row_version: run.row_version, comment: comment.trim() || null, expected_step: step });
        toast.success("Run approved — the next approver or the finalizer can continue");
      } else {
        await runsApi.reject(run.id, { row_version: run.row_version, reason: comment.trim(), expected_step: step });
        toast.success("Run rejected — payroll has been told why");
      }
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={choice === "approve" ? "Approve this run" : "Reject this run"}
      description={run.label}
      size="md"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button type="submit" form="approve-form" variant={choice === "approve" ? "success" : "danger"} loading={busy}>
            {choice === "approve" ? "Approve" : "Reject"}
          </Button>
        </>
      }
    >
      <form id="approve-form" onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Decision">
          {(["approve", "reject"] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={choice === c}
              onClick={() => setChoice(c)}
              className={cn("min-h-[44px] rounded-xl border px-3 text-sm font-medium", choice === c ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-muted")}
            >
              {c === "approve" ? "Approve" : "Reject"}
            </button>
          ))}
        </div>
        {summary.loading && !summary.data ? (
          <Skeleton className="h-20 w-full" />
        ) : summary.data ? (
          <dl className="grid gap-2 rounded-2xl border border-border p-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Net pay</dt>
              <dd>
                <MoneyStack amounts={figureByCurrency(summary.data.totals, "net")} className="items-start" />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Employees</dt>
              <dd className="tabular-nums">
                {summary.data.population.included} included · {summary.data.population.excluded} excluded
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Open exceptions</dt>
              <dd className="tabular-nums">{summary.data.exceptions.open}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Variance flags</dt>
              <dd>{pendingVariance ? `${pendingVariance} not acknowledged` : "All acknowledged"}</dd>
            </div>
          </dl>
        ) : null}
        <ConflictBanner error={error} onReload={() => onDone()} />
        {!!error && !isConflict(error) && (
          <Notice tone="danger" title="That didn't work">
            {errorMessage(error)}
          </Notice>
        )}
        <Field label={choice === "reject" ? "Reason" : "Comment (optional)"} required={choice === "reject"} error={touched && missing ? "A rejection needs a reason." : undefined}>
          <Textarea rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ finalize (typed confirmation + step-up + statutory gate) */

export function blockerText(blocker: FinalizationStatus["blockers"][number]): ReactNode {
  if (blocker.code === "STATUTORY_NOT_VERIFIED") {
    return (
      <>
        Statutory: no verified country pack covers this period and there is no approved statutory attestation for the legal entity. Create and approve an attestation on the
        Summary tab first (&ldquo;Compliance not verified&rdquo;).
      </>
    );
  }
  if (blocker.code === "RUN_STALE") return "Inputs changed after lock: recalculate the changed employees first.";
  return blocker.message;
}

function FinalizeModal({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { run } = useRun();
  const { requestStepUp } = useStepUp();
  const status = useApi(() => runsApi.finalization(run.id), [run.id, open], { enabled: open });
  const key = useRef(newIdempotencyKey());
  useEffect(() => {
    if (open) key.current = newIdempotencyKey();
  }, [open]);

  if (!open) return null;
  const data = status.data;
  const blocked = data && (!data.can_finalize || data.blockers.length > 0 || data.self_lines_pending.length > 0);
  if (!data || blocked || status.error) {
    return (
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="Finalize run"
        size="md"
        footer={
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        }
      >
        {status.error ? (
          <Notice tone="danger" title="Couldn't check what blocks finalization">
            {status.error.message}
          </Notice>
        ) : !data ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-3 text-sm">
            <p>This run can&apos;t be finalized yet:</p>
            <ul className="list-disc space-y-1.5 ps-5">
              {data.blockers.map((b) => (
                <li key={b.code}>{blockerText(b)}</li>
              ))}
              {data.self_lines_pending.length > 0 && <li>{data.self_lines_pending.length} approver pay line(s) still need another approver (Approvals tab).</li>}
              {!data.can_finalize && !data.blockers.length && !data.self_lines_pending.length && <li>The run must be approved first.</li>}
            </ul>
          </div>
        )}
      </Modal>
    );
  }

  const confirm = async () => {
    try {
      const step = await stepUpApi.status().catch(() => null);
      if (!step?.active) {
        const verified = await requestStepUp("Finalizing a pay run needs you to confirm it's you.");
        if (!verified) throw new Error("STEP_UP_CANCELLED");
      }
      await runsApi.finalize(run.id, run.label, run.row_version, key.current);
      toast.success("Run finalized — payslips are being generated");
      onDone();
    } catch (error) {
      if (!(error instanceof Error && error.message === "STEP_UP_CANCELLED")) toast.error(error instanceof ApiError ? error.message : errorMessage(error));
      throw error;
    }
  };

  return (
    <TypedConfirmModal
      open={open}
      onOpenChange={onOpenChange}
      title="Finalize run"
      message="Finalizing locks this run. Payslips will be generated and nothing in this run can be edited; later changes become corrections."
      consequences={[
        "Year-to-date figures, liabilities and loan or claim ledgers are posted.",
        "Wage inputs, overtime and tasks in this run are marked as paid by it.",
        "Payment instructions are created for the payout files.",
        data.statutory.verified ? "Statutory lines use the verified country pack." : "Statutory obligations are handled outside this system (approved attestation).",
      ]}
      confirmText={run.label}
      confirmLabel="Finalize"
      onConfirm={confirm}
    />
  );
}


/* ------------------------------------------------------------------ reverse (corrections; two approvers, recovery) */

/**
 * Reverse run (`?modal=reverse&run=`): request a reversal of a finalized run, or, when one is pending,
 * approve or reject it as one of the two required approvers. The original run never changes; money
 * already paid becomes a recovery in later runs, never a bank debit.
 */
function ReverseModal({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { run, me } = useRun();
  const existing = useApi(() => runsApi.reversals(run.id), [run.id, open], { enabled: open });
  const [text, setText] = useState("");
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) {
      setText("");
      setDecision("approve");
      setError(null);
      setTouched(false);
    }
  }, [open]);
  const live = (existing.data?.items ?? []).filter((r) => r.status === "PENDING_APPROVAL" || r.status === "APPROVED");
  const pending = live.find((r) => r.status === "PENDING_APPROVAL") ?? null;
  const userId = me?.user.id;
  const alreadyActed = !!pending && (pending.requested_by_user_id === userId || pending.approvals.some((a) => a.user_id === userId));
  const mayDecide = !!pending && canApproveReversal(me, run) && !alreadyActed;
  const mayRequest = !live.length && canRequestReversal(me, run);
  const textRequired = mayRequest || (mayDecide && decision === "reject");
  const missing = textRequired && !text.trim();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (missing || busy || (!mayRequest && !mayDecide)) return;
    setBusy(true);
    setError(null);
    try {
      if (mayRequest) {
        await runsApi.reverse(run.id, text.trim(), run.row_version);
        toast.success("Reversal requested — two different approvers must approve it");
      } else if (pending && decision === "approve") {
        const result = await runsApi.approveReversal(pending.id, text.trim() || null, pending.row_version);
        toast.success(result.status === "PENDING_APPROVAL" ? "First approval recorded — a second approver is needed" : "Reversal approved — the reversal run is created");
      } else if (pending) {
        await runsApi.rejectReversal(pending.id, text.trim(), pending.row_version);
        toast.success("Reversal rejected");
      }
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const action = mayRequest ? "Request reversal" : mayDecide ? (decision === "approve" ? "Approve reversal" : "Reject reversal") : null;

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title="Reverse this run"
      description={run.label}
      size="md"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Back
          </Button>
          {action && (
            <Button type="submit" form="reverse-form" variant={mayDecide && decision === "approve" ? "primary" : "danger"} loading={busy}>
              {action}
            </Button>
          )}
        </>
      }
    >
      <form id="reverse-form" onSubmit={submit} className="space-y-4" noValidate>
        <div className="rounded-2xl bg-warning-soft p-3 text-sm">
          <p className="font-medium">What a reversal does</p>
          <ul className="mt-1 list-disc space-y-1 ps-5">
            <li>A reversal run with the opposite of every line of this run is created; this run itself never changes.</li>
            <li>Two different approvers must approve it before it takes effect; the requester can&apos;t approve it.</li>
            <li>Money already paid is not pulled back from bank accounts: it becomes a recovery in later runs.</li>
          </ul>
        </div>
        {existing.error ? (
          <Notice tone="danger" title="Couldn't load reversal requests">
            {existing.error.message}
          </Notice>
        ) : existing.loading && !existing.data ? (
          <Skeleton className="h-12 w-full" />
        ) : live.length > 0 ? (
          <Notice tone="info" title="A reversal is already in progress">
            Request #{live[0].id}: {humanize(live[0].status).toLowerCase()}, {live[0].approvals.length} of 2 approvals. Reason: {live[0].reason}
            {alreadyActed && <span className="mt-1 block text-xs">You requested or already approved it, so another person must decide.</span>}
          </Notice>
        ) : !mayRequest ? (
          <p className="text-sm text-muted-foreground">No reversal has been requested for this run.</p>
        ) : null}
        {live[0] && Object.entries(live[0].preview).length > 0 && (
          <dl className="space-y-1 text-sm">
            {Object.entries(live[0].preview).map(([cur, v]) => (
              <div key={cur} className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted-foreground">Net reversed ({v.employees} employees)</dt>
                <dd>
                  <MoneyText money={v.net} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        {mayDecide && (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Decision">
            {(["approve", "reject"] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={decision === c}
                onClick={() => setDecision(c)}
                className={cn("min-h-[44px] rounded-xl border px-3 text-sm font-medium", decision === c ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-muted")}
              >
                {c === "approve" ? "Approve" : "Reject"}
              </button>
            ))}
          </div>
        )}
        {(mayRequest || mayDecide) && (
          <Field label={textRequired ? "Reason" : "Comment (optional)"} required={textRequired} error={touched && missing ? "Give a reason." : undefined}>
            <Textarea rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
        <ConflictBanner error={error} onReload={() => onDone()} />
        {!!error && !isConflict(error) && (
          <Notice tone="danger" title="That didn't work">
            {errorMessage(error)}
          </Notice>
        )}
      </form>
    </Modal>
  );
}
