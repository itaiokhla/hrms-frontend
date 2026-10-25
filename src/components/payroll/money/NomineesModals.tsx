"use client";

import { CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { CURRENCY_LIST } from "@/lib/payroll/catalogues.generated";
import { newIdempotencyKey } from "@/lib/payroll/api";

import { BANK_COUNTRIES, EMPTY_BANK_FORM, checkBankForm, countryName, fieldLabel, fieldsFor, maskTail, serverField, toBankBody, type BankField, type BankForm } from "@/components/payroll/me/bankFormat";

import {
  KIND_LABELS,
  NOMINEE_KINDS,
  formatShare,
  nomineesApi,
  validateNomineeDraft,
  type Nominee,
  type NomineeChangeResult,
  type NomineeInput,
  type NomineeKind,
} from "./NomineesApi";
import { ConflictBanner, ErrorSummary, Notice, fieldErrors } from "./shared";

const PAYROLL_CURRENCIES = CURRENCY_LIST.filter((c) => c.payroll_allowed);

interface Draft {
  kind: NomineeKind;
  name: string;
  relationship: string;
  proof_ref: string;
  share_percent: string;
  country: string;
  email: string;
}

const EMPTY: Draft = { kind: "NOMINEE", name: "", relationship: "", proof_ref: "", share_percent: "", country: "", email: "" };

/* ------------------------------------------------------------------ add / change a nominee */

/**
 * Add or change a nominee or legal heir (3.5 §15). Identity and money: the server asks for a fresh
 * step-up (the page prompts), checks the shares add up to at most 100 and refuses changes once the
 * settlement run exists. The name, kind and country of a person with a bank account never change: end
 * the nominee and add the right person instead.
 */
export function NomineeFormModal({
  open,
  onOpenChange,
  caseId,
  nominee,
  otherShares,
  defaultCountry,
  onSaved,
  onDirtyChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  caseId: number;
  nominee?: Nominee | null;
  /** Shares of the other active nominees of the case, in percent. */
  otherShares: number;
  defaultCountry?: string;
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const editing = !!nominee;
  const initial = useMemo<Draft>(
    () =>
      nominee
        ? { kind: nominee.kind as NomineeKind, name: nominee.name, relationship: nominee.relationship, proof_ref: nominee.proof_ref, share_percent: nominee.share_percent, country: nominee.country, email: "" }
        : { ...EMPTY, country: defaultCountry ?? "" },
    [nominee, defaultCountry],
  );
  const [d, setD] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  const locked = editing && (nominee?.bank_accounts?.length ?? 0) > 0;
  useEffect(() => {
    if (!open) return;
    setD(initial);
    setErrors({});
    setError(null);
    key.current = newIdempotencyKey();
  }, [open, initial]);
  useEffect(() => onDirtyChange?.(JSON.stringify(d) !== JSON.stringify(initial)), [d, initial, onDirtyChange]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setErrors((x) => ({ ...x, [k]: "" }));
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const next = validateNomineeDraft(d, otherShares);
    setErrors(next);
    if (Object.keys(next).length) return;
    const body: NomineeInput = {
      kind: d.kind,
      name: d.name.trim(),
      relationship: d.relationship.trim(),
      proof_ref: d.proof_ref.trim(),
      share_percent: d.share_percent.trim(),
      country: d.country.trim().toUpperCase(),
      email: d.email.trim() || null,
    };
    setBusy(true);
    setError(null);
    try {
      if (nominee) {
        const changes: Partial<NomineeInput> = { relationship: body.relationship, proof_ref: body.proof_ref, share_percent: body.share_percent };
        if (!locked) Object.assign(changes, { kind: body.kind, name: body.name, country: body.country });
        if (body.email) changes.email = body.email;
        await nomineesApi.update(nominee.id, changes, nominee.row_version);
        toast.success("Nominee updated");
      } else {
        await nomineesApi.create(caseId, body, key.current);
        toast.success("Nominee added");
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const all = { ...fieldErrors(error), ...Object.fromEntries(Object.entries(errors).filter(([, v]) => v)) };
  const formId = "nominee-form";
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={editing ? `Change ${nominee?.name}` : "Add a nominee or legal heir"}
      description="Who receives this settlement, and which document names them. You will be asked to confirm it's you."
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} className="min-h-[44px]" loading={busy}>
            {editing ? "Save changes" : "Add nominee"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
        <ConflictBanner error={error} onReload={() => { onSaved(); onOpenChange(false); }} />
        <ErrorSummary error={error} fields={all} />
        {locked && (
          <Notice title="This person has a bank account">
            The name, kind and country can no longer change. If they are wrong, end this nominee and add the right person.
          </Notice>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kind" required>
            <Select value={d.kind} onChange={(e) => set("kind", e.target.value as NomineeKind)} disabled={locked} className="min-h-[44px]">
              {NOMINEE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Full name" required error={errors.name ?? all.name}>
            <Input value={d.name} maxLength={140} disabled={locked} onChange={(e) => set("name", e.target.value)} className="min-h-[44px]" />
          </Field>
          <Field label="Relationship" required error={errors.relationship ?? all.relationship}>
            <Input value={d.relationship} maxLength={60} placeholder="Spouse, Son, Daughter…" onChange={(e) => set("relationship", e.target.value)} className="min-h-[44px]" />
          </Field>
          <Field label="Share of the settlement (%)" required error={errors.share_percent ?? all.share_percent} hint={`${formatShare(otherShares)}% is already given to others.`}>
            <Input inputMode="decimal" value={d.share_percent} onChange={(e) => set("share_percent", e.target.value)} className="min-h-[44px]" dir="ltr" />
          </Field>
          <Field label="Country" required error={errors.country ?? all.country}>
            <Select value={d.country} onChange={(e) => set("country", e.target.value)} disabled={locked} className="min-h-[44px]">
              <option value="">Choose…</option>
              {BANK_COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {countryName(c)} ({c})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="E-mail for bank alerts" error={errors.email ?? all.email} hint={editing ? "Leave empty to keep the address on file." : "Optional. Alerts about this person's bank account go here and to HR."}>
            <Input type="email" value={d.email} maxLength={254} autoComplete="off" onChange={(e) => set("email", e.target.value)} className="min-h-[44px]" />
          </Field>
        </div>
        <Field label="Proof document" required error={errors.proof_ref ?? all.proof_ref} hint="For example “Succession certificate SC/2026/114” or the nomination form number. The approver of the bank account checks it.">
          <Input value={d.proof_ref} maxLength={300} onChange={(e) => set("proof_ref", e.target.value)} className="min-h-[44px]" />
        </Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ bank account of a nominee */

/**
 * Submit a nominee's bank account. It goes through the same checks as an employee's: country-driven
 * fields, step-up, approval by a second person (never the person who recorded the nominee or entered the
 * account), verification before payout and a cooling-off period that nobody can waive.
 */
export function NomineeAccountModal({
  open,
  onOpenChange,
  nominee,
  currency,
  onSubmitted,
  onDirtyChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  nominee: Nominee | null;
  currency?: string;
  onSubmitted: (result: NomineeChangeResult) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const start = useMemo<BankForm>(
    () => ({ ...EMPTY_BANK_FORM, country: nominee?.country ?? "", currency: currency ?? "", holder_name: nominee?.name ?? "" }),
    [nominee?.country, nominee?.name, currency],
  );
  const [form, setForm] = useState<BankForm>(start);
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<BankField | "form", string>>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<NomineeChangeResult | null>(null);
  const key = useRef(newIdempotencyKey());
  useEffect(() => {
    if (!open) return;
    setForm(start);
    setTouched(false);
    setServerErrors({});
    setError(null);
    setDone(null);
    key.current = newIdempotencyKey();
  }, [open, start]);
  useEffect(() => onDirtyChange?.(!done && JSON.stringify(form) !== JSON.stringify(start)), [form, start, done, onDirtyChange]);

  const { show, accountTypes } = fieldsFor(form.country || "");
  const local = checkBankForm(form, { submitting: touched });
  const errors: Partial<Record<BankField, string>> = { ...serverErrors, ...local };
  const set = (field: BankField, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setServerErrors((e) => ({ ...e, [field]: undefined }));
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setTouched(true);
    if (!nominee) return;
    if (Object.keys(checkBankForm(form, { submitting: true })).length) return;
    setBusy(true);
    setError(null);
    try {
      const result = await nomineesApi.submitAccount(nominee.id, toBankBody(form), key.current);
      setDone(result);
      onSubmitted(result);
      toast.success("Bank account submitted for approval");
    } catch (err) {
      const fields: Partial<Record<BankField | "form", string>> = {};
      (err as { fields?: { field: string; msg: string }[] }).fields?.forEach((f) => {
        fields[serverField(f.field)] = f.msg;
      });
      setServerErrors(fields);
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const text = (field: BankField, props: { mono?: boolean; maxLength?: number } = {}) => (
    <Field key={field} label={fieldLabel(field)} required={["holder_name", "account_number", "iban", "ifsc", "sort_code", "aba"].includes(field)} error={errors[field]}>
      <Input
        value={form[field]}
        maxLength={props.maxLength ?? 140}
        autoComplete="off"
        spellCheck={false}
        dir={props.mono ? "ltr" : undefined}
        className={props.mono ? "min-h-[44px] font-mono" : "min-h-[44px]"}
        onChange={(e) => set(field, e.target.value)}
      />
    </Field>
  );
  const formId = "nominee-account-form";
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={nominee ? `Bank account of ${nominee.name}` : "Bank account"}
      description="The settlement share is paid here. A valid format proves only the format, never that the account belongs to this person."
      footer={
        done ? (
          <Button className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" form={formId} className="min-h-[44px]" loading={busy}>
              Submit for approval
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="space-y-3" role="status">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> Submitted for approval
          </p>
          <p className="text-sm text-muted-foreground">
            Account {maskTail(form.iban || form.account_number)} now waits for a second person with approval rights. Then the cooling-off period runs (it cannot be waived for a nominee) and the account must be verified from the
            cancelled cheque or a bank letter before any money moves.
          </p>
          {(done.risk_flags ?? []).length > 0 && <Notice tone="warning" title="Flagged for the approver">{done.risk_flags?.join(", ")}</Notice>}
        </div>
      ) : (
        <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
          <ConflictBanner error={error} />
          <ErrorSummary error={error} fields={Object.fromEntries(Object.entries(errors).filter(([, v]) => v)) as Record<string, string>} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={fieldLabel("country")} required error={errors.country}>
              <Select value={form.country} onChange={(e) => set("country", e.target.value)} className="min-h-[44px]">
                <option value="">Choose…</option>
                {BANK_COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {countryName(c)} ({c})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={fieldLabel("currency")} required error={errors.currency}>
              <Select value={form.currency} onChange={(e) => set("currency", e.target.value)} className="min-h-[44px]">
                <option value="">Choose…</option>
                {PAYROLL_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            {show.includes("holder_name") && text("holder_name")}
            {show.includes("account_number") && text("account_number", { mono: true, maxLength: 64 })}
            {show.includes("iban") && text("iban", { mono: true, maxLength: 64 })}
            {show.includes("ifsc") && text("ifsc", { mono: true, maxLength: 40 })}
            {show.includes("sort_code") && text("sort_code", { mono: true, maxLength: 40 })}
            {show.includes("aba") && text("aba", { mono: true, maxLength: 40 })}
            {show.includes("bsb") && text("bsb", { mono: true, maxLength: 40 })}
            {show.includes("wps_routing_code") && text("wps_routing_code", { mono: true, maxLength: 40 })}
            {show.includes("bic") && text("bic", { mono: true, maxLength: 40 })}
            {accountTypes && (
              <Field label={fieldLabel("account_type")} required error={errors.account_type}>
                <Select value={form.account_type} onChange={(e) => set("account_type", e.target.value)} className="min-h-[44px]">
                  <option value="">Choose…</option>
                  {accountTypes.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0) + t.slice(1).toLowerCase()}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {show.includes("bank_name") && text("bank_name")}
            {show.includes("branch_name") && text("branch_name")}
            {show.includes("bank_address") && text("bank_address", { maxLength: 300 })}
          </div>
        </form>
      )}
    </Modal>
  );
}
