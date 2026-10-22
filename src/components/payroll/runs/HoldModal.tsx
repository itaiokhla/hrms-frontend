"use client";

import { useEffect, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApi, useDebounced } from "@/lib/hooks";

import { runsApi } from "./api";
import { FULL_HOLD_STATES, useRun } from "./context";
import { HOLD_REASON_LABELS, Notice } from "./shared";

/** `?modal=hold&employee=<run employee id>[,<id>…]` */
export function useHoldRoute() {
  return useModalRoute("hold", { keys: ["employee"] });
}

/**
 * Hold employee (3.8 §6, `sm`): a reason code and a note. A payment hold keeps the employee
 * calculated and finalized but holds the money; a full hold (before approval only) takes the
 * employee out of this run's results. Several employees are held one by one and failures listed.
 */
export function HoldModal() {
  const { run, reload } = useRun();
  const route = useHoldRoute();
  const ids = (route.param("employee") ?? "")
    .split(",")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
  const [type, setType] = useState<"PAYMENT" | "FULL">("PAYMENT");
  const [reason, setReason] = useState("OTHER");
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const search = useDebounced(q, 300);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [failures, setFailures] = useState<{ id: number; message: string }[]>([]);
  const fullAllowed = FULL_HOLD_STATES.includes(run.status);
  const needsPick = route.open && ids.length === 0;
  const candidates = useApi(() => runsApi.employees(run.id, { search: search.trim() || undefined, limit: 20 }), [run.id, search], { enabled: needsPick });

  useEffect(() => {
    if (!route.open) {
      setType("PAYMENT");
      setReason("OTHER");
      setNote("");
      setPicked(null);
      setQ("");
      setTouched(false);
      setFailures([]);
    }
  }, [route.open]);

  const targets = ids.length ? ids : picked ? [picked] : [];
  const errors = {
    employee: targets.length === 0 ? "Choose an employee." : null,
    note: !note.trim() ? "Add a note: it is shown to whoever releases the hold." : null,
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (errors.employee || errors.note || busy) return;
    setBusy(true);
    const failed: { id: number; message: string }[] = [];
    for (const id of targets) {
      try {
        await runsApi.hold(run.id, id, { hold_type: type, reason_code: reason, note: note.trim() });
      } catch (err) {
        failed.push({ id, message: errorMessage(err) });
      }
    }
    setBusy(false);
    setFailures(failed);
    const done = targets.length - failed.length;
    if (done > 0) toast.success(`${done} ${done === 1 ? "employee" : "employees"} put on hold`);
    if (!failed.length) {
      await route.close();
      reload();
    } else if (done > 0) reload();
  };

  return (
    <Modal
      open={route.open}
      onOpenChange={(o) => !busy && route.onOpenChange(o)}
      title={targets.length > 1 ? `Hold ${targets.length} employees` : "Hold employee"}
      size="sm"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => void route.close()}>
            Cancel
          </Button>
          <Button type="submit" form="hold-form" variant="danger" loading={busy}>
            Put on hold
          </Button>
        </>
      }
    >
      <form id="hold-form" onSubmit={submit} className="space-y-4" noValidate>
        {failures.length > 0 && (
          <Notice tone="danger" title={`${failures.length} could not be held`}>
            <ul className="list-disc ps-5">
              {failures.map((f) => (
                <li key={f.id}>
                  #{f.id}: {f.message}
                </li>
              ))}
            </ul>
          </Notice>
        )}
        {needsPick && (
          <Field label="Employee" required error={touched && errors.employee ? errors.employee : undefined}>
            <Input placeholder="Search by name or code" value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
        )}
        {needsPick && (
          <ul className="max-h-40 space-y-1 overflow-y-auto" aria-label="Matching employees">
            {(candidates.data?.items ?? [])
              .filter((r) => r.status !== "EXCLUDED" && !r.hold_type)
              .map((r) => (
                <li key={r.id}>
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-surface-muted">
                    <input type="radio" name="hold-employee" checked={picked === r.id} onChange={() => setPicked(r.id)} />
                    {r.employee_name ?? `Employee #${r.employee_id}`}
                    {r.employee_code && <span className="text-xs text-muted-foreground">{r.employee_code}</span>}
                  </label>
                </li>
              ))}
          </ul>
        )}
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Hold</legend>
          <div className="space-y-2">
            {(["PAYMENT", "FULL"] as const).map((t) => (
              <label
                key={t}
                className={cn("flex min-h-[44px] items-start gap-3 rounded-xl border px-3 py-2 text-sm", type === t ? "border-primary bg-primary-soft" : "border-border", t === "FULL" && !fullAllowed && "opacity-60")}
              >
                <input type="radio" name="hold-type" className="mt-1" checked={type === t} disabled={t === "FULL" && !fullAllowed} onChange={() => setType(t)} />
                <span>
                  <span className="font-medium">{t === "PAYMENT" ? "Hold the payment" : "Hold the whole pay"}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t === "PAYMENT"
                      ? "Pay is calculated and finalized; the money is not sent until someone releases the hold."
                      : fullAllowed
                        ? "The employee is left out of this run's results until released."
                        : "Only before approval."}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {Object.entries(HOLD_REASON_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note" required error={touched && errors.note ? errors.note : undefined}>
          <Textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/** Release a hold: a note is required (POST runs/{id}/employees/{eid}/release). */
export function ReleaseHoldModal({ open, runEmployeeId, onOpenChange, onDone }: { open: boolean; runEmployeeId: number | null; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { run } = useRun();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setNote("");
      setTouched(false);
      setError(null);
    }
  }, [open]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!note.trim() || !runEmployeeId || busy) return;
    setBusy(true);
    try {
      await runsApi.release(run.id, runEmployeeId, note.trim());
      toast.success("Hold released");
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title="Release hold"
      size="sm"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="release-form" loading={busy}>
            Release
          </Button>
        </>
      }
    >
      <form id="release-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <Notice tone="danger" title="Couldn't release the hold">
            {error}
          </Notice>
        )}
        <p className="text-sm">After a finalized run, releasing a payment hold creates the payment for the next payout file.</p>
        <Field label="Note" required error={touched && !note.trim() ? "Add a note." : undefined}>
          <Textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
