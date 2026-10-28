"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { newIdempotencyKey } from "@/lib/payroll/api";
import { useModalRoute } from "@/lib/useModalRoute";

import { rostersApi, type PublishBody, type PublishPreview } from "./api";
import { ResultList, RosterErrorNotice } from "./RosterResults";
import { ROSTER_ERROR_TEXT, blockingCode, keysOf, ruleLabel } from "./rosterModel";

/**
 * Publish (§5.1; `?modal=roster-publish`): opens with a dry run, lists blocking results (a real attempt is refused
 * with INSUFFICIENT_REST_HOURS or ROSTER_RULE_VIOLATION), one checkbox per WARN rule key (`acknowledged_warnings`)
 * and one reason per REQUIRE_REASON key (`reasons`), then publishes. Refusals show in plain words with their issues.
 */
export function PublishModal({ periodId, nameOf, onPublished }: {
  periodId: number;
  nameOf: (employeeId: number) => string;
  onPublished: () => void;
}) {
  const route = useModalRoute("roster-publish", { keys: [] });
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [acks, setAcks] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const open = route.open;

  useEffect(() => {
    if (!open) return;
    let live = true;
    setPreview(null);
    setLoadError(null);
    setAcks(new Set());
    setReasons({});
    setError(null);
    attempt.current = null;
    rostersApi.previewPublish(periodId)
      .then((p) => live && setPreview(p))
      .catch((e) => live && setLoadError(e));
    return () => { live = false; };
  }, [open, periodId]);

  if (!open) return null;
  const results = preview?.results ?? [];
  const blocking = preview?.blocking ?? results.filter((r) => r.severity === "BLOCK");
  const warnKeys = keysOf(results, "WARN");
  const reasonKeys = keysOf(results, "REQUIRE_REASON");
  const nothing = !!preview?.nothing_to_publish;
  const predicted = blockingCode(blocking);

  const submit = async () => {
    const body: PublishBody = {
      acknowledged_warnings: warnKeys.filter((k) => acks.has(k)),
      reasons: Object.fromEntries(reasonKeys.map((k) => [k, (reasons[k] ?? "").trim()]).filter(([, v]) => v)),
    };
    // One Idempotency-Key per payload: a retry of the same body replays, a changed body is a new attempt.
    const text = JSON.stringify(body);
    if (!attempt.current || attempt.current.body !== text) attempt.current = { key: newIdempotencyKey(), body: text };
    setBusy(true);
    setError(null);
    try {
      const done = await rostersApi.publish(periodId, body, attempt.current.key);
      toast.success(done.nothing_to_publish ? "Nothing to publish."
        : `Roster published: ${done.entries_created ?? 0} added, ${done.entries_updated ?? 0} changed, ${done.entries_withdrawn ?? 0} removed.`);
      await route.close({ force: true });
      onPublished();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={route.onOpenChange} size="lg" title="Publish roster"
      description="Publishing sends the drafted cells to the employees' schedules."
      footer={<>
        <Button variant="ghost" onClick={() => void route.close({ force: true })}>Cancel</Button>
        <Button data-testid="publish-confirm" loading={busy} disabled={!preview || nothing || busy} onClick={() => void submit()}>Publish</Button>
      </>}>
      <div className="space-y-5" data-testid="publish-modal">
        {loadError ? <RosterErrorNotice error={loadError} nameOf={nameOf} />
          : !preview ? <p className="text-sm text-muted-foreground">Checking the roster…</p>
          : nothing ? <p className="text-sm" data-testid="publish-nothing">Nothing to publish: there are no drafts in this period.</p> : (
            <>
              <p className="text-sm" data-testid="publish-summary">
                {preview.changes?.length ?? 0} {(preview.changes?.length ?? 0) === 1 ? "cell" : "cells"} will change.
                {results.length === 0 && " No rule findings."}
              </p>
              {blocking.length > 0 && (
                <section className="space-y-2" data-testid="publish-blocking" data-code={predicted ?? undefined}>
                  <h3 className="text-sm font-semibold text-danger">Can&apos;t publish yet</h3>
                  <p className="text-sm text-muted-foreground">
                    {predicted ? ROSTER_ERROR_TEXT[predicted] : ""} Publishing will be refused until these are fixed.
                  </p>
                  <ResultList results={blocking} nameOf={nameOf} testId="publish-blocking-results" />
                </section>
              )}
              {warnKeys.length > 0 && (
                <fieldset className="space-y-2" data-testid="publish-warnings">
                  <legend className="text-sm font-semibold">Acknowledge warnings</legend>
                  {warnKeys.map((key) => (
                    <label key={key} className="flex min-h-[36px] items-center gap-2 text-sm">
                      <input type="checkbox" className="h-4 w-4" data-testid={`ack-${key}`} checked={acks.has(key)}
                        onChange={(e) => setAcks((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(key);
                          else next.delete(key);
                          return next;
                        })} />
                      Acknowledge: {ruleLabel(key)} ({results.filter((r) => r.rule_key === key && r.severity === "WARN").length})
                    </label>
                  ))}
                </fieldset>
              )}
              {reasonKeys.length > 0 && (
                <div className="space-y-3" data-testid="publish-reasons">
                  <h3 className="text-sm font-semibold">Reasons needed</h3>
                  {reasonKeys.map((key) => (
                    <Field key={key} label={`Reason: ${ruleLabel(key)}`}>
                      <Textarea data-testid={`reason-${key}`} maxLength={500} value={reasons[key] ?? ""}
                        onChange={(e) => setReasons((prev) => ({ ...prev, [key]: e.target.value }))} />
                    </Field>
                  ))}
                </div>
              )}
              {results.some((r) => r.severity !== "BLOCK") && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Other findings</h3>
                  <ResultList results={results.filter((r) => r.severity !== "BLOCK")} nameOf={nameOf} testId="publish-results" />
                </section>
              )}
            </>
          )}
        <RosterErrorNotice error={error} nameOf={nameOf} />
      </div>
    </Modal>
  );
}
