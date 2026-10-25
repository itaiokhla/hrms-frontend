"use client";

import { useEffect, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { EmployeeField } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { ModalRoute } from "@/components/payroll/useModalRoute";

import { ConflictBanner, ErrorSummary, Notice, closeAfterSave, fieldErrors, formatDate, useEntities, useReportDirty } from "../documents/shared";
import { holdsApi } from "./api";
import { DOC_TYPE_LABEL, HOLD_SCOPES, SCOPE_HELP, SCOPE_LABEL, type ErasureResult, type HoldScope, type LegalHold, type SweepCounts } from "./types";

const isLegalHold = (error: unknown) => error instanceof ApiError && error.code === "LEGAL_HOLD";

/** The refusal banners every action here can meet; the generic summary covers the rest. */
function Refusals({ error, fields, onReload }: { error: unknown; fields?: Record<string, string>; onReload?: () => void }) {
  if (isLegalHold(error)) {
    return (
      <Notice tone="danger" title="This data is under a legal hold">
        {(error as ApiError).message} Release the hold first (a second person is needed), then try again.
      </Notice>
    );
  }
  return (
    <>
      <ConflictBanner error={error} onReload={onReload} />
      <ErrorSummary error={error} fields={fields} />
    </>
  );
}

/* ------------------------------------------------------------------ place a hold */

export function PlaceHoldModal({ route, onDone, onDirtyChange }: { route: ModalRoute; onDone: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const entities = useEntities();
  const [scope, setScope] = useState<HoldScope>("EMPLOYEE");
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [entityId, setEntityId] = useState("");
  const [docType, setDocType] = useState("PAYSLIP_V2");
  const [documentId, setDocumentId] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useReportDirty(route.open && !!(employeeId || entityId || documentId || reference.trim() || reason.trim()), onDirtyChange);
  useEffect(() => {
    if (route.open) {
      setScope("EMPLOYEE");
      setEmployeeId(null);
      setEntityId("");
      setDocType("PAYSLIP_V2");
      setDocumentId("");
      setReference("");
      setReason("");
      setErrors({});
      setError(null);
    }
  }, [route.open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const missing: Record<string, string> = {};
    if (scope === "EMPLOYEE" && !employeeId) missing.employee_id = "Choose the employee.";
    if (scope === "LEGAL_ENTITY" && !entityId) missing.legal_entity_id = "Choose the legal entity.";
    if (scope === "DOCUMENT" && !/^\d+$/.test(documentId)) missing.document_id = "Enter the document id.";
    if (!reason.trim()) missing.reason = "Give the reason for the hold.";
    setErrors(missing);
    if (Object.keys(missing).length) return;
    setBusy(true);
    setError(null);
    try {
      const hold = await holdsApi.place({
        scope,
        ...(scope === "EMPLOYEE" ? { employee_id: employeeId as number } : {}),
        ...(scope === "LEGAL_ENTITY" ? { legal_entity_id: Number(entityId) } : {}),
        ...(scope === "DOCUMENT_TYPE" ? { doc_type: docType } : {}),
        ...(scope === "DOCUMENT" ? { document_id: Number(documentId) } : {}),
        reason: reason.trim(),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      toast.success(`Legal hold placed. It covers ${hold.documents_covered ?? 0} document${hold.documents_covered === 1 ? "" : "s"}.`);
      closeAfterSave(onDirtyChange, () => route.onOpenChange(false));
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const merged = { ...fieldErrors(error), ...errors };
  return (
    <Modal
      open={route.open}
      onOpenChange={route.onOpenChange}
      size="md"
      title="Place a legal hold"
      description="Covered documents are kept: the retention sweep skips them and erasure requests touching them are refused."
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => route.onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="place-hold" className="min-h-[44px]" loading={busy}>
            Place hold
          </Button>
        </>
      }
    >
      <form id="place-hold" onSubmit={submit} className="space-y-4" noValidate>
        <ErrorSummary error={error} fields={merged} />
        <Field label="What does it cover?" hint={SCOPE_HELP[scope]}>
          <Select className="min-h-[44px]" value={scope} onChange={(e) => setScope(e.target.value as HoldScope)}>
            {HOLD_SCOPES.map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        {scope === "EMPLOYEE" && <EmployeeField value={employeeId} onChange={setEmployeeId} error={merged.employee_id} />}
        {scope === "LEGAL_ENTITY" &&
          (entities.options ? (
            <Field label="Legal entity" required error={merged.legal_entity_id}>
              <Select className="min-h-[44px]" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                <option value="">Choose…</option>
                {entities.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Legal entity id" required error={merged.legal_entity_id} hint="The list needs organisation access; enter an id.">
              <Input className="min-h-[44px]" inputMode="numeric" value={entityId} onChange={(e) => setEntityId(e.target.value.replace(/\D/g, ""))} />
            </Field>
          ))}
        {scope === "DOCUMENT_TYPE" && (
          <Field label="Document type" required>
            <Select className="min-h-[44px]" value={docType} onChange={(e) => setDocType(e.target.value)}>
              {Object.entries(DOC_TYPE_LABEL).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {scope === "DOCUMENT" && (
          <Field label="Document id" required error={merged.document_id} hint="The number in the document's address, for example /payroll/payslips/123.">
            <Input className="min-h-[44px]" inputMode="numeric" value={documentId} onChange={(e) => setDocumentId(e.target.value.replace(/\D/g, ""))} />
          </Field>
        )}
        <Field label="Reference (optional)" hint="Case or matter number.">
          <Input className="min-h-[44px]" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Reason" required error={merged.reason}>
          <Textarea rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ release a hold */

export function ReleaseHoldModal({ route, onDone, onDirtyChange }: { route: ModalRoute; onDone: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const id = route.open ? route.id : null;
  const { me } = useCan();
  const hold = useApi(() => holdsApi.get(id as string), [id], { enabled: !!id });
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useReportDirty(route.open && !!reason.trim(), onDirtyChange);
  useEffect(() => {
    if (route.open) {
      setReason("");
      setErrors({});
      setError(null);
    }
  }, [route.open, id]);
  const h: LegalHold | undefined = hold.data && String(hold.data.id) === id ? hold.data : undefined;
  const mine = !!h && me?.user.id === h.created_by_user_id;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!h) return;
    if (!reason.trim()) {
      setErrors({ reason: "Give the reason for releasing the hold." });
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      await holdsApi.release(h.id, { reason: reason.trim(), row_version: h.row_version });
      toast.success("Legal hold released. Its documents follow their normal retention again.");
      closeAfterSave(onDirtyChange, () => route.onOpenChange(false));
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const merged = { ...fieldErrors(error), ...errors };
  return (
    <Modal
      open={route.open}
      onOpenChange={route.onOpenChange}
      size="md"
      title="Release legal hold"
      description={h ? `Hold #${h.id}${h.reference ? ` · ${h.reference}` : ""}` : undefined}
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => route.onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="release-hold" variant="danger" className="min-h-[44px]" loading={busy} disabled={!h || h.status !== "ACTIVE" || mine}>
            Release hold
          </Button>
        </>
      }
    >
      {hold.error && !h ? (
        <ErrorSummary error={hold.error} />
      ) : !h ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          Loading…
        </p>
      ) : (
        <form id="release-hold" onSubmit={submit} className="space-y-4" noValidate>
          {mine && (
            <Notice tone="warning" title="Another person must release this hold">
              You placed it, and a legal hold is released by someone else who holds this permission (maker and checker).
            </Notice>
          )}
          {h.status !== "ACTIVE" && <Notice title="This hold is already released">Placed holds never reopen; place a new one if needed.</Notice>}
          <Refusals error={error} fields={merged} onReload={() => void hold.reload()} />
          <dl className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3 text-sm">
            <dt className="text-muted-foreground">Covers</dt>
            <dd>{SCOPE_LABEL[h.scope]}</dd>
            <dt className="text-muted-foreground">Documents covered</dt>
            <dd>{h.documents_covered ?? "—"}</dd>
            <dt className="text-muted-foreground">Placed</dt>
            <dd>{formatDate(h.created_at)}</dd>
            <dt className="text-muted-foreground">Reason</dt>
            <dd className="break-words">{h.reason}</dd>
          </dl>
          <p className="text-sm">
            Releasing does not delete anything. Documents that are past their retention date can be deleted by the next sweep unless another hold still covers them. You will be asked to confirm it&apos;s you.
          </p>
          <Field label="Reason for releasing" required error={merged.reason}>
            <Textarea rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </form>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ run the sweep now */

export function SweepModal({ route, onDone }: { route: ModalRoute; onDone: () => void }) {
  const summary = useApi(() => holdsApi.summary(), [route.open], { enabled: route.open });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SweepCounts | null>(null);
  useEffect(() => {
    if (route.open) {
      setError(null);
      setResult(null);
    }
  }, [route.open]);
  const s = summary.data;
  const deletable = s?.documents_due_deletable ?? 0;
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const counts = await holdsApi.sweep();
      setResult(counts);
      toast.success(`Retention sweep done: ${counts.redacted ?? 0} stored file${counts.redacted === 1 ? "" : "s"} deleted.`);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={route.open}
      onOpenChange={route.onOpenChange}
      size="md"
      title="Run the retention sweep"
      description="Deletes the stored PDFs of payslips and payroll registers whose retention period has ended and that are under no legal hold."
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => route.onOpenChange(false)}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button variant="danger" className="min-h-[44px]" loading={busy} disabled={!s || deletable === 0} onClick={() => void run()}>
              {deletable ? `Delete ${deletable} stored file${deletable === 1 ? "" : "s"}` : "Nothing to delete"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <Refusals error={error} />
        {summary.error && !s && <ErrorSummary error={summary.error} />}
        {s && !result && (
          <>
            <dl className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3 text-sm">
              <dt className="text-muted-foreground">Past retention</dt>
              <dd data-testid="sweep-due">{s.documents_due}</dd>
              <dt className="text-muted-foreground">Held back by legal holds</dt>
              <dd data-testid="sweep-held">{s.documents_due_held}</dd>
              <dt className="text-muted-foreground">Files that will be deleted</dt>
              <dd data-testid="sweep-deletable">{deletable}</dd>
            </dl>
            <Notice tone="warning" title="Deleted files cannot be restored">
              The finalized payroll records stay: runs, lines, document numbers and hashes. Only the stored PDF goes, and it is never re-created. At most {s.sweep_limit} files are deleted per sweep. You will be asked to confirm it&apos;s you.
            </Notice>
          </>
        )}
        {result && (
          <dl className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3 text-sm" aria-label="Sweep result">
            <dt className="text-muted-foreground">Stored files deleted</dt>
            <dd data-testid="result-redacted">{result.redacted}</dd>
            <dt className="text-muted-foreground">Held back</dt>
            <dd>{result.held}</dd>
            <dt className="text-muted-foreground">Still due (next sweep)</dt>
            <dd>{result.remaining}</dd>
            <dt className="text-muted-foreground">Not yet due</dt>
            <dd>{result.not_due}</dd>
          </dl>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ erasure request */

export function ErasureModal({ route, onDone, onDirtyChange }: { route: ModalRoute; onDone: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ErasureResult | null>(null);
  useReportDirty(route.open && !result && !!(employeeId || reason.trim()), onDirtyChange);
  useEffect(() => {
    if (route.open) {
      setEmployeeId(null);
      setReason("");
      setErrors({});
      setError(null);
      setResult(null);
    }
  }, [route.open]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const missing: Record<string, string> = {};
    if (!employeeId) missing.employee_id = "Choose the employee.";
    if (!reason.trim()) missing.reason = "Give the reason for the request.";
    setErrors(missing);
    if (Object.keys(missing).length) return;
    setBusy(true);
    setError(null);
    try {
      const done = await holdsApi.erase(employeeId as number, reason.trim());
      setResult(done);
      toast.success("Erasure request processed.");
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const merged = { ...fieldErrors(error), ...errors };
  return (
    <Modal
      open={route.open}
      onOpenChange={route.onOpenChange}
      size="md"
      title="Employee erasure request"
      description="Deletes the employee's stored payslip PDFs once their retention period has ended. Refused while a legal hold covers their data."
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => route.onOpenChange(false)}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button type="submit" form="erasure-request" variant="danger" className="min-h-[44px]" loading={busy}>
              Process request
            </Button>
          )}
        </>
      }
    >
      {result ? (
        <div className="space-y-3" aria-label="Erasure result">
          <dl className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3 text-sm">
            <dt className="text-muted-foreground">Stored files deleted</dt>
            <dd data-testid="erasure-redacted">{result.redacted}</dd>
            <dt className="text-muted-foreground">Kept until retention ends</dt>
            <dd data-testid="erasure-kept">{result.kept_until_retention_ends}</dd>
          </dl>
          <Notice title="Finalized records are kept">Documents still inside their retention period are kept until it ends; the finalized payroll records themselves are never erased.</Notice>
        </div>
      ) : (
        <form id="erasure-request" onSubmit={submit} className="space-y-4" noValidate>
          <Refusals error={error} fields={merged} />
          <EmployeeField value={employeeId} onChange={setEmployeeId} error={merged.employee_id} />
          <Field label="Reason" required error={merged.reason}>
            <Textarea rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <p className="text-sm text-muted-foreground">You will be asked to confirm it&apos;s you. The request and its outcome are recorded in the audit trail.</p>
        </form>
      )}
    </Modal>
  );
}
