"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/primitives";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { newIdempotencyKey } from "@/lib/payroll/api";
import { useModalRoute } from "@/lib/useModalRoute";

import { ShiftApiError, shiftFieldErrors, shiftsApi, type VersionPreview } from "./api";
import { ShiftChip } from "./ShiftChip";
import { ShiftErrorNotice, ShiftFields } from "./ShiftForm";
import { addDays, defaultValues, fmtMinutes, timesLabel, toVersionBody, validateShift, valuesFromVersion, type ShiftFormValues } from "./shiftModel";

const STATE_LABEL = { OPEN: "Open", INPUT_LOCKED: "Locked for payroll", FINALIZED: "Paid (final)" } as const;

/** The dry-run result of §3.6: the version table, people affected, dates by payroll state, minutes old → new. */
const COMPLIANCE_LABEL: Record<string, string> = {
  DAILY_HOURS_EXCEEDED: "Longer than the daily limit",
  SPREAD_OVER_EXCEEDED: "Spread over more hours than allowed",
  OUTDOOR_MIDDAY_BAN: "Outdoor work in the midday ban",
};

export function VersionImpact({ preview, name }: { preview: VersionPreview; name: (id: number) => string }) {
  return (
    <div className="space-y-4 text-sm" data-testid="version-impact">
      <section>
        <h3 className="font-semibold">Versions after saving</h3>
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">Versions after saving</caption>
          <thead className="text-xs text-muted-foreground">
            <tr><th scope="col" className="py-1">Version</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Times</th></tr>
          </thead>
          <tbody>
            {preview.versions.map((v, i) => (
              <tr key={i} className="border-t border-border/60">
                <td className="py-1.5">{v.new ? (v.return_of ? `New (back to v${v.return_of})` : "New") : `v${v.version_no}`}</td>
                <td>{fmtDate(v.effective_from)}</td>
                <td>{v.effective_to ? fmtDate(v.effective_to) : "Open-ended"}</td>
                <td>{timesLabel(v.start_time, v.end_time)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h3 className="font-semibold">Employees affected</h3>
        <p data-testid="impact-employees">
          {preview.affected_employees.count === 0 ? "No one is on this shift in the next 62 days." : `${preview.affected_employees.count} employees`}
        </p>
        {preview.affected_employees.sample.length > 0 && (
          <p className="text-muted-foreground">{preview.affected_employees.sample.map(name).join(", ")}</p>
        )}
      </section>
      <section>
        <h3 className="font-semibold">Days to recalculate</h3>
        <ul className="mt-1 flex flex-wrap gap-3">
          {(Object.keys(STATE_LABEL) as (keyof typeof STATE_LABEL)[]).map((k) => (
            <li key={k}>{STATE_LABEL[k]}: {preview.dates_by_payroll_state[k]}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="font-semibold">Leave to recount</h3>
        <p className="text-muted-foreground" data-testid="impact-leave">
          {preview.affected_employees.count
            ? `Approved hourly and half-day leave of these ${preview.affected_employees.count} employees from ${fmtDate(preview.versions.find((v) => v.new)?.effective_from)} is recounted after you save.`
            : "No leave to recount."}
        </p>
      </section>
      <section>
        <h3 className="font-semibold">Scheduled time per day</h3>
        <p>{fmtMinutes(preview.scheduled_minutes.old)} → {fmtMinutes(preview.scheduled_minutes.new)}</p>
      </section>
      {(preview.compliance ?? []).length > 0 && (
        <section data-testid="version-compliance">
          <h3 className="font-semibold">Compliance (one shift at a time)</h3>
          <div role="status" className="mt-1 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3">
            <ul className="space-y-1">
              {(preview.compliance ?? []).map((c, i) => (
                <li key={i}>
                  {COMPLIANCE_LABEL[c.rule_key] ?? c.rule_key} — {c.employees} {c.employees === 1 ? "employee" : "employees"} ({c.country})
                  {c.measured && c.limit ? `: ${c.measured} vs ${c.limit}${c.unit ? ` ${c.unit}` : ""}` : ""}
                  {c.message_key.endsWith(".not_verified") ? " · compliance not verified" : ""}
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Shown for planning; rosters and attendance apply the binding checks.</p>
        </section>
      )}
      {preview.warnings.length > 0 && (
        <div role="status" className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3">
          <ul className="space-y-1">
            {preview.warnings.map((w, i) => (
              <li key={i}>{w.code === "VERSION_RANGE_TRUNCATED" ? `The change now ends on ${fmtDate(String(w.applied_effective_to))}, before the scheduled version.` : w.code}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * "Change times from a date…" (`?modal=shift-version&id={shift_id}`; §17.3, 09-ui-ux/03 §5.10): step 1 the Times,
 * Breaks and Advanced fields pre-filled from the version in force, from tomorrow by default; step 2 "Review impact"
 * (dry run); Save is enabled once the review has loaded, Back keeps the input.
 */
export function ShiftVersionModal({ onSaved, name = (id) => `Employee #${id}` }: { onSaved?: () => void; name?: (id: number) => string }) {
  const [dirty, setDirty] = useState(false);
  const route = useModalRoute("shift-version", { keys: ["id"], dirty });
  const id = route.open ? route.id : null;
  const { data: shift, error: loadError } = useApi(() => (id ? shiftsApi.get(id) : Promise.resolve(null)), [id]);
  const tomorrow = shift ? addDays(shift.owner_today, 1) : "";
  const initial = useMemo<ShiftFormValues | null>(() => {
    if (!shift) return null;
    const base = { ...defaultValues(tomorrow), effective_from: tomorrow };
    return valuesFromVersion(base, shift.kind, shift.current_version ?? shift.versions[shift.versions.length - 1]);
  }, [shift, tomorrow]);
  const [values, setValues] = useState<ShiftFormValues | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [preview, setPreview] = useState<VersionPreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [truncate, setTruncate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);

  useEffect(() => {
    setValues(initial);
    setStep("edit");
    setPreview(null);
    setError(null);
    setErrors({});
    setTruncate(false);
    setKey(newIdempotencyKey());
  }, [initial]);
  useEffect(() => setDirty(!!values && !!initial && JSON.stringify(values) !== JSON.stringify(initial)), [values, initial]);

  if (!route.open) return null;
  const body = () => ({ ...toVersionBody(values!, "version"), on_overlap: truncate ? ("TRUNCATE" as const) : ("REJECT" as const) });

  const review = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!values || !shift) return;
    const next = validateShift(values, "version", shift.owner_today);
    setErrors(next);
    setError(null);
    if (Object.keys(next).length) return;
    setStep("review");
    setPreview(null);
    try {
      setPreview(await shiftsApi.previewVersion(shift.id, body()));
    } catch (err) {
      setError(err);
      setErrors(shiftFieldErrors(err));
      setStep("edit");
    }
  };

  const save = async () => {
    if (!shift || !values) return;
    setBusy(true);
    try {
      const saved = await shiftsApi.createVersion(shift.id, body(), key);
      toast.success(`Version ${saved.version.version_no} saved. ${saved.effects.employees} employees affected${saved.effects.leave_recalculation_queued ? "; leave recount queued" : ""}.`);
      setDirty(false);
      onSaved?.();
      void route.close();
    } catch (err) {
      setError(err);
      setStep("edit");
    } finally {
      setBusy(false);
    }
  };

  const nextAllowed = error instanceof ShiftApiError && error.code === "SHIFT_VERSION_IN_FORCE" ? String(error.details?.next_allowed_from ?? "") : "";
  const overlap = error instanceof ShiftApiError && error.code === "SHIFT_VERSION_OVERLAP_SCHEDULED";

  return (
    <Modal open onOpenChange={route.onOpenChange} size="lg"
      title={shift ? <span className="flex items-center gap-2">Change times from a date · <ShiftChip code={shift.code} color={shift.color_token} /></span> : "Change times from a date"}
      description={step === "review" ? "Step 2 of 2 · Review impact" : "Step 1 of 2 · New times"}
      footer={step === "edit" ? (
        <>
          <Button variant="secondary" onClick={() => void route.close()}>Cancel</Button>
          <Button type="submit" form="shift-version-form" disabled={!values}>Review impact</Button>
        </>
      ) : (
        <>
          <Button variant="secondary" onClick={() => setStep("edit")}>Back</Button>
          <Button onClick={() => void save()} loading={busy} disabled={!preview}>Save version</Button>
        </>
      )}>
      {loadError ? <ShiftErrorNotice error={loadError} /> : !values || !shift ? <Skeleton className="h-64 w-full" /> : step === "edit" ? (
        <form id="shift-version-form" onSubmit={review} noValidate className="space-y-4">
          <ShiftErrorNotice error={error} />
          {nextAllowed && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setValues({ ...values, effective_from: nextAllowed })}>
              Start on {fmtDate(nextAllowed)} instead
            </Button>
          )}
          {overlap && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={truncate} onChange={(e) => setTruncate(e.target.checked)} />
              End this change the day before the scheduled version
            </label>
          )}
          <p className="text-xs text-muted-foreground">
            {values.effective_from === shift.owner_today ? "This takes effect immediately and cannot be edited today." : `Today for this shift is ${fmtDate(shift.owner_today)}.`}
          </p>
          <ShiftFields values={values} onChange={setValues} errors={errors} section="version" />
        </form>
      ) : preview ? (
        <VersionImpact preview={preview} name={name} />
      ) : (
        <div className="space-y-2" aria-busy="true" aria-label="Loading impact"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-40 w-full" /></div>
      )}
    </Modal>
  );
}
