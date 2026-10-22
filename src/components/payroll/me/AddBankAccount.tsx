"use client";

import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { FileDropzone } from "@/components/payroll/FileDropzone";
import { useStepUp } from "@/components/payroll/StepUpAuthModal";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/hooks";
import { CURRENCY_LIST } from "@/lib/payroll/catalogues.generated";
import { isStepUpRequired, newIdempotencyKey, stepUpApi } from "@/lib/payroll/api";

import { meApi } from "./api";
import {
  BANK_COUNTRIES,
  checkBankForm,
  countryName,
  EMPTY_BANK_FORM,
  fieldLabel,
  fieldsFor,
  maskTail,
  serverField,
  toBankBody,
  type BankField,
  type BankForm,
} from "./bankFormat";
import { ConflictBanner, Notice } from "./shared";
import type { BankChangeResult, MyBankAccount } from "./types";

const STEPS = ["Confirm it's you", "Account details", "Proof", "Review"] as const;
const EVIDENCE_TYPES = [".pdf", ".png", ".jpg", ".jpeg", "application/pdf", "image/png", "image/jpeg"];
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const PAYROLL_CURRENCIES = CURRENCY_LIST.filter((c) => c.payroll_allowed);

const HINTS: Partial<Record<BankField, string>> = {
  ifsc: "11 characters, e.g. HDFC0001234 (printed on your cheque book).",
  sort_code: "6 digits, e.g. 12-34-56.",
  aba: "9 digits, at the bottom left of a US cheque.",
  iban: "Spaces are fine; we remove them.",
  bic: "8 or 11 characters, e.g. DEUTDEFF.",
  wps_routing_code: "9 digits, from your bank (needed for WPS salary transfers).",
  holder_name: "Exactly as the bank has it. A different name is checked by HR before payment.",
};

export interface AddBankAccountProps {
  /** Existing accounts: to replace one, and to know whether payments are split across several. */
  accounts: MyBankAccount[];
  /** Default currency (the pay group's, when known). */
  defaultCurrency?: string;
  defaultCountry?: string;
  onDone: (result: BankChangeResult) => void;
  onCancel: () => void;
  /** Unsaved details: the modal route asks "Discard changes?" before closing (D-12). */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Add bank account (3.8 §6, 3 steps after a step-up first): confirm it's you → country-driven fields
 * with live format checks → proof upload → review. A valid format is never presented as proof that
 * the account is yours: HR verifies ownership, and a new account is used only after approval and its
 * cooling-off period.
 */
export function AddBankAccountWizard({ accounts, defaultCurrency, defaultCountry, onDone, onCancel, onDirtyChange }: AddBankAccountProps) {
  const { requestStepUp } = useStepUp();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<BankForm>({ ...EMPTY_BANK_FORM, country: defaultCountry ?? "", currency: defaultCurrency ?? "" });
  const [touched, setTouched] = useState<Partial<Record<BankField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<BankField | "form", string>>>({});
  const [proof, setProof] = useState<File | null>(null);
  const [replaces, setReplaces] = useState<string>("");
  const [allocation, setAllocation] = useState<{ type: string; value: string }>({ type: "PRIMARY", value: "" });
  const [splitRequired, setSplitRequired] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ result: BankChangeResult; proofFailed: boolean } | null>(null);
  const key = useRef(newIdempotencyKey());
  const limits = useApi(() => meApi.uploadLimits(), []);

  const active = accounts.filter((a) => a.status === "ACTIVE");
  // Split payments are on when an account already shares the net pay, or the server asked for an allocation.
  const split = splitRequired || accounts.some((a) => a.allocation && a.allocation.type !== "PRIMARY");

  // Step 0: a fresh step-up is required before bank details can change (EC-BNK-06).
  const stepUp = useApi(() => stepUpApi.status(), []);
  useEffect(() => {
    if (step === 0 && stepUp.data?.active) setStep(1);
  }, [step, stepUp.data]);

  const dirty = !done && (!!proof || (Object.keys(EMPTY_BANK_FORM) as BankField[]).some((f) => f !== "country" && f !== "currency" && form[f].trim() !== ""));
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const errors = useMemo(() => checkBankForm(form, { submitting: submitted }), [form, submitted]);
  const visible = (f: BankField) => (submitted || touched[f]) && (serverErrors[f] ?? errors[f]);
  const { show, required, accountTypes } = fieldsFor(form.country);
  const maxBytes = limits.data?.max_upload_bytes ?? DEFAULT_MAX_BYTES;

  const set = (f: BankField, v: string) => {
    setForm((prev) => ({ ...prev, [f]: v }));
    setServerErrors((prev) => ({ ...prev, [f]: undefined }));
  };

  const confirmIdentity = async () => {
    const ok = await requestStepUp("Changing where your salary is paid needs a fresh confirmation that it's you.");
    if (ok) setStep(1);
  };

  const next = () => {
    if (step === 1) {
      setSubmitted(true);
      const problems = checkBankForm(form, { submitting: true });
      if (Object.keys(problems).length) return;
      if (split && allocation.type !== "PRIMARY" && allocation.type !== "REMAINDER" && !allocation.value.trim()) return;
    }
    setStep((s) => Math.min(s + 1, 3));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...toBankBody(form),
        replaces_account_id: replaces ? Number(replaces) : null,
        allocation: split ? { type: allocation.type, value: allocation.type === "PRIMARY" || allocation.type === "REMAINDER" ? null : allocation.value.trim(), order: 0 } : null,
      };
      const result = await meApi.submitBankAccount(body, key.current);
      let proofFailed = false;
      if (proof) {
        try {
          await meApi.addBankEvidence(result.bank_account_id, proof);
        } catch {
          proofFailed = true;
        }
      }
      toast.success("Bank account submitted. HR checks it before your salary goes there.");
      setDone({ result, proofFailed });
    } catch (err) {
      if (isStepUpRequired(err)) {
        setStep(0);
        setError(new ApiError(403, "Your confirmation expired. Confirm it's you again, then submit."));
      } else if (err instanceof ApiError && err.status === 422 && err.fields?.length) {
        const mapped: Partial<Record<BankField | "form", string>> = {};
        err.fields.forEach((f) => {
          const k = serverField(f.field);
          if (!mapped[k]) mapped[k] = f.msg.charAt(0).toUpperCase() + f.msg.slice(1);
        });
        setServerErrors(mapped);
        setError(err);
        setStep(1);
      } else if (err instanceof ApiError && err.code === "ALLOCATION_REQUIRED") {
        setSplitRequired(true);
        setError(err);
        setStep(1);
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-4 text-center" role="status">
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" aria-hidden />
        <div>
          <p className="text-lg font-semibold">Submitted for checking</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {done.result.status === "SECURITY_REVIEW"
              ? "Because your bank details changed several times recently, our security team reviews this change first. You'll be notified."
              : "HR verifies the account. Your salary keeps going to your current account until the new one is approved and its waiting period has passed."}
          </p>
        </div>
        {done.proofFailed && (
          <Notice tone="warning" title="The proof didn't upload">
            The account was submitted. Open it from My Bank Accounts and add the proof again.
          </Notice>
        )}
        <Button className="min-h-[44px]" onClick={() => onDone(done.result)}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ol className="flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === step ? "step" : undefined}
            className={cn("rounded-full px-3 py-1 text-xs font-medium", i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-primary-soft text-foreground" : "bg-muted text-muted-foreground")}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>
      <ConflictBanner error={error} />
      {!!error && !(error instanceof ApiError && (error.status === 409 || error.status === 412)) && (
        <div role="alert" className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm">
          <p className="font-medium text-danger">{error instanceof ApiError ? error.message : "Something went wrong. Please try again."}</p>
        </div>
      )}
      {error instanceof ApiError && error.status === 409 && (
        <p className="text-sm text-muted-foreground">
          {error.code === "CHANGE_ALREADY_PENDING"
            ? "Cancel the open change on My Bank Accounts first, or wait for HR to decide it."
            : error.code === "BANK_SELF_SERVICE_DISABLED"
              ? "Your employer updates bank accounts for you. Contact HR."
              : null}
        </p>
      )}

      {step === 0 && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-border p-4">
            <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden />
            <div className="text-sm">
              <p className="font-medium">First, confirm it's you</p>
              <p className="mt-1 text-muted-foreground">Bank changes are a common target of fraud, so we ask for a fresh code before you enter new details.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="min-h-[44px]" onClick={onCancel}>
              Cancel
            </Button>
            <Button className="min-h-[44px]" loading={stepUp.loading && !stepUp.data} onClick={confirmIdentity}>
              Confirm it's you
            </Button>
          </div>
        </div>
      )}

      {step === 1 && (
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
        >
          <Notice tone="info" title="Format checks aren't proof of ownership">
            We check that the details look right for the country as you type. That doesn't prove the account is yours: HR verifies it before any salary goes there.
          </Notice>
          {serverErrors.form && <p role="alert" className="text-sm font-medium text-danger">{serverErrors.form}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={fieldLabel("country")} required error={visible("country") || undefined}>
              <Select
                value={form.country}
                onChange={(e) => set("country", e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, country: true }))}
                className="min-h-[44px]"
                aria-invalid={!!visible("country")}
              >
                <option value="">Choose a country</option>
                {BANK_COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {countryName(c)} ({c})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={fieldLabel("currency")} required error={visible("currency") || undefined}>
              <Select value={form.currency} onChange={(e) => set("currency", e.target.value)} className="min-h-[44px]" aria-invalid={!!visible("currency")}>
                <option value="">Choose a currency</option>
                {PAYROLL_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {form.country && (
            <div className="grid gap-4 sm:grid-cols-2">
              {show.map((f) =>
                f === "account_type" && accountTypes ? (
                  <Field key={f} label={fieldLabel(f)} required error={visible(f) || undefined}>
                    <Select value={form.account_type} onChange={(e) => set("account_type", e.target.value)} className="min-h-[44px]" aria-invalid={!!visible(f)}>
                      <option value="">Choose</option>
                      {accountTypes.map((t) => (
                        <option key={t} value={t}>
                          {t.charAt(0) + t.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <Field key={f} label={fieldLabel(f)} required={required.includes(f)} error={visible(f) || undefined} hint={HINTS[f]} className={f === "bank_address" || f === "holder_name" ? "sm:col-span-2" : undefined}>
                    <Input
                      value={form[f]}
                      onChange={(e) => set(f, e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, [f]: true }))}
                      autoComplete="off"
                      spellCheck={false}
                      inputMode={["account_number", "sort_code", "aba", "bsb", "wps_routing_code"].includes(f) && form.country !== "GB" ? "numeric" : undefined}
                      className={["account_number", "iban", "ifsc", "sort_code", "aba", "bsb", "bic", "wps_routing_code"].includes(f) ? "min-h-[44px] font-mono" : "min-h-[44px]"}
                      dir={["account_number", "iban", "ifsc", "sort_code", "aba", "bsb", "bic", "wps_routing_code"].includes(f) ? "ltr" : undefined}
                      aria-invalid={!!visible(f)}
                    />
                  </Field>
                ),
              )}
            </div>
          )}
          {active.length > 0 && !split && (
            <p className="text-sm text-muted-foreground">
              Your salary currently goes to <bdi dir="ltr">{active.map((a) => a.account_masked).join(", ")}</bdi>. Once approved, this new account replaces it.
            </p>
          )}
          {split && (
            <fieldset className="space-y-3 rounded-2xl border border-border p-4">
              <legend className="px-1 text-sm font-semibold">How much goes to this account?</legend>
              {active.length > 0 && (
                <Field label="Replaces (optional)" hint="Leave empty to add this account next to the others.">
                  <Select value={replaces} onChange={(e) => setReplaces(e.target.value)} className="min-h-[44px]">
                    <option value="">Keep my other accounts</option>
                    {active.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.bank_name ?? "Account"} {a.account_masked}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Share">
                  <Select value={allocation.type} onChange={(e) => setAllocation({ ...allocation, type: e.target.value })} className="min-h-[44px]">
                    <option value="PRIMARY">Everything (main account)</option>
                    <option value="PERCENT">A percentage of net pay</option>
                    <option value="FIXED">A fixed amount</option>
                    <option value="REMAINDER">Whatever is left</option>
                  </Select>
                </Field>
                {(allocation.type === "PERCENT" || allocation.type === "FIXED") && (
                  <Field label={allocation.type === "PERCENT" ? "Percent" : `Amount (${form.currency || "currency"})`} required error={submitted && !allocation.value.trim() ? "Enter a value." : undefined}>
                    <Input value={allocation.value} inputMode="decimal" dir="ltr" onChange={(e) => setAllocation({ ...allocation, value: e.target.value })} className="min-h-[44px]" />
                  </Field>
                )}
              </div>
            </fieldset>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="min-h-[44px]" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" className="min-h-[44px]">
              Continue
            </Button>
          </div>
        </form>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Add a cancelled cheque, a bank statement or a letter from your bank that shows your name and this account. It helps HR verify the account faster.
          </p>
          <FileDropzone accept={EVIDENCE_TYPES} maxBytes={maxBytes} label="Proof of account (PDF, PNG or JPEG)" hint="Optional, one file." onFiles={(files) => setProof(files[0] ?? null)} />
          {proof && <p className="text-sm">Selected: {proof.name}</p>}
          <div className="flex justify-between gap-2">
            <Button variant="ghost" className="min-h-[44px]" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button className="min-h-[44px]" onClick={() => setStep(3)}>
              {proof ? "Continue" : "Skip and continue"}
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-2xl border border-border p-4 text-sm">
            <dt className="text-muted-foreground">Account holder</dt>
            <dd className="font-medium">{form.holder_name}</dd>
            <dt className="text-muted-foreground">Country · currency</dt>
            <dd className="font-medium">
              {countryName(form.country)} · {form.currency}
            </dd>
            {show.includes("iban") && form.iban && (
              <>
                <dt className="text-muted-foreground">IBAN</dt>
                <dd className="font-mono">
                  <bdi dir="ltr">{maskTail(form.iban)}</bdi>
                </dd>
              </>
            )}
            {show.includes("account_number") && form.account_number && (
              <>
                <dt className="text-muted-foreground">Account number</dt>
                <dd className="font-mono">
                  <bdi dir="ltr">{maskTail(form.account_number)}</bdi>
                </dd>
              </>
            )}
            {form.bank_name && (
              <>
                <dt className="text-muted-foreground">Bank</dt>
                <dd>{form.bank_name}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Proof</dt>
            <dd>{proof ? proof.name : "None"}</dd>
          </dl>
          <div className="rounded-2xl border border-warning/40 bg-warning-soft p-4 text-sm">
            <p className="font-medium">What happens next</p>
            <ul className="mt-1 list-disc space-y-1 ps-5 text-muted-foreground">
              <li>HR checks the account. You and your contact addresses get a security notification about this change.</li>
              <li>Until it is approved and its waiting (cooling-off) period has passed, your salary keeps going to your current account.</li>
              <li>If you didn't make this change, contact HR straight away.</li>
            </ul>
          </div>
          <div className="flex justify-between gap-2">
            <Button variant="ghost" className="min-h-[44px]" disabled={busy} onClick={() => setStep(2)}>
              Back
            </Button>
            <Button className="min-h-[44px]" loading={busy} onClick={submit}>
              Submit for approval
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The wizard in an `lg` modal (deep link `?modal=add-bank`); the full page is /me/bank-accounts/new. */
export function AddBankAccountModal({ open, onOpenChange, ...props }: { open: boolean; onOpenChange: (o: boolean) => void } & Omit<AddBankAccountProps, "onCancel">) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg" title="Add bank account" description="Where your salary should be paid.">
      {open && <AddBankAccountWizard {...props} onCancel={() => onOpenChange(false)} />}
    </Modal>
  );
}
