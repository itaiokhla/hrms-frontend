"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { Segmented } from "@/components/branding/fields";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";

import { LEVEL_LABELS, definitionOf, fmtDay, formatValue } from "./model";
import { settingsApi } from "./settingsApi";
import type { ChangeRequest } from "./types";

type Status = "PENDING" | "APPROVED" | "REJECTED" | "ALL";

const TONES = { PENDING: "warning", APPROVED: "success", REJECTED: "danger" } as const;
const STATUS_LABELS = { PENDING: "Waiting for approval", APPROVED: "Approved", REJECTED: "Rejected" } as const;

/**
 * Settings change requests (maker-checker, 3.1 §9): changes that wait for a second administrator.
 * The requester can't approve their own change; the server enforces it too.
 */
export function ChangeRequests() {
  const { me, can } = useCan();
  const [status, setStatus] = useState<Status>("PENDING");
  const { data, error, loading, reload } = useApi(() => settingsApi.changeRequests(status), [status]);
  const [deciding, setDeciding] = useState<{ request: ChangeRequest; approve: boolean } | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const canApprove = can(P.SETTINGS_APPROVE_CHANGES);

  const decide = async () => {
    if (!deciding) return;
    if (!deciding.approve && !comment.trim()) {
      setDecisionError("Give a reason for the rejection.");
      return;
    }
    setBusy(true);
    setDecisionError(null);
    try {
      await settingsApi.decide(deciding.request.id, deciding.approve, comment.trim() || undefined);
      toast.success(deciding.approve ? "Change approved" : "Change rejected");
      setDeciding(null);
      setComment("");
      void reload();
    } catch (e) {
      setDecisionError(e instanceof Error ? e.message : "That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Segmented
        label="Show"
        value={status}
        onChange={setStatus}
        options={[
          { value: "PENDING", label: "Waiting" },
          { value: "APPROVED", label: "Approved" },
          { value: "REJECTED", label: "Rejected" },
          { value: "ALL", label: "All" },
        ]}
      />
      <div aria-busy={loading || undefined} aria-live="polite">
        {error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : !data ? (
          <div className="space-y-2">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        ) : data.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border">
            <EmptyState title="No change requests" description="When approval of settings changes is on, changes wait here for a second administrator." />
          </div>
        ) : (
          <ul className="space-y-2">
            {data.map((request) => {
              const def = definitionOf(request.key);
              const mine = request.requested_by?.id === me?.user.id;
              return (
                <li key={request.id} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {request.label}
                        <Badge tone={TONES[request.status]} dot>
                          {STATUS_LABELS[request.status]}
                        </Badge>
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {LEVEL_LABELS[request.scope.scope_type] ?? request.scope.scope_type}
                        {request.scope.scope_id ? ` #${request.scope.scope_id}` : ""} · from {fmtDay(request.effective_from)}
                      </p>
                      <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                        <dt className="text-muted-foreground">Now</dt>
                        <dd>{formatValue(def, request.current_value)}</dd>
                        <dt className="text-muted-foreground">Requested</dt>
                        <dd className="font-medium">
                          {formatValue(def, request.value)}
                          {request.locked ? " (locked)" : ""}
                        </dd>
                      </dl>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Requested by {request.requested_by?.name ?? "someone"}
                        {request.requested_at ? ` on ${fmtDay(request.requested_at.slice(0, 10))}` : ""}
                        {request.reason ? ` · “${request.reason}”` : ""}
                        {request.decided_by ? ` · decided by ${request.decided_by.name}` : ""}
                        {request.comment ? ` · “${request.comment}”` : ""}
                      </p>
                    </div>
                    {request.status === "PENDING" && canApprove && (
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          className="h-11"
                          disabled={mine}
                          title={mine ? "You requested this change, so another administrator must decide" : undefined}
                          onClick={() => {
                            setComment("");
                            setDecisionError(null);
                            setDeciding({ request, approve: false });
                          }}
                        >
                          <X className="h-4 w-4" /> Reject
                        </Button>
                        <Button
                          className="h-11"
                          disabled={mine}
                          title={mine ? "You requested this change, so another administrator must decide" : undefined}
                          onClick={() => {
                            setComment("");
                            setDecisionError(null);
                            setDeciding({ request, approve: true });
                          }}
                        >
                          <Check className="h-4 w-4" /> Approve
                        </Button>
                      </div>
                    )}
                  </div>
                  {request.status === "PENDING" && mine && (
                    <p className="mt-2 text-xs text-muted-foreground">You requested this change, so another administrator must decide.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Modal
        open={!!deciding}
        onOpenChange={(o) => !o && setDeciding(null)}
        title={deciding?.approve ? `Approve the change to ${deciding.request.label}?` : `Reject the change to ${deciding?.request.label ?? ""}?`}
        description={deciding?.approve ? "The new value applies from its effective date." : "The current value stays in force."}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <Button variant={deciding?.approve ? "primary" : "danger"} loading={busy} onClick={decide}>
              {deciding?.approve ? "Approve" : "Reject"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {decisionError && (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-foreground">
              {decisionError}
            </p>
          )}
          <Field label={deciding?.approve ? "Comment (optional)" : "Reason"} required={!deciding?.approve}>
            <Textarea value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
