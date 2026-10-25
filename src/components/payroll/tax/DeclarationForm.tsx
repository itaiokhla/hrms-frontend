"use client";

import { Send } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { ConflictBanner, ErrorSummary } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { isStepUpRequired, newIdempotencyKey } from "@/lib/payroll/api";

import { taxApi } from "./api";
import { groupFields, PackNote, taxFieldErrors, toRequestValues } from "./shared";
import type { TaxField, TaxFormValues, TaxSubmitResult, TaxVersion } from "./types";

const MONEY = /^\d+(\.\d+)?$/;

function checkField(field: TaxField, raw: string, onFile: boolean): string | null {
  const value = raw.trim();
  if (!value) return field.required && !onFile ? `${field.label} is required.` : null;
  if (field.type === "MONEY" || field.type === "DECIMAL") {
    if (!MONEY.test(value)) return `${field.label}: enter an amount such as 1200.50 (digits and a decimal point only).`;
  }
  if (field.type === "INTEGER" && !/^\d+$/.test(value)) return `${field.label}: enter a whole number.`;
  if (field.type === "DATE" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${field.label}: enter a date as YYYY-MM-DD.`;
  if (field.max_length && value.length > field.max_length) return `${field.label}: at most ${field.max_length} characters.`;
  return null;
}

export interface DeclarationFormProps {
  schema: TaxField[];
  currency: string | null;
  /** Starting values: the latest declarations, so an update changes only what changed. */
  initial: TaxFormValues;
  /** Identifiers already on file, masked: the field may stay empty to keep them. */
  identifiersOnFile: Record<string, string>;
  /** Today in the company's time zone (the default effective date). */
  today: string;
  onSubmitted: (result: TaxSubmitResult) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * The pack-defined declaration form: exactly the fields the country pack asks for, with the pack's own help and
 * honesty notes. A tax identifier is sent only when typed (it needs a confirmation that it's you); an identifier
 * left empty keeps the one on file. Money is sent as text, never as a number.
 */
export function DeclarationForm({ schema, currency, initial, identifiersOnFile, today, onSubmitted, onDirtyChange }: DeclarationFormProps) {
  const [values, setValues] = useState<TaxFormValues>(initial);
  const [effective, setEffective] = useState(today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  const groups = useMemo(() => groupFields(schema), [schema]);

  const set = (code: string, value: string) => {
    setValues((prev) => ({ ...prev, [code]: value }));
    setErrors((prev) => ({ ...prev, [code]: "" }));
    onDirtyChange?.(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    schema.forEach((field) => {
      const problem = checkField(field, values[field.code] ?? "", !!identifiersOnFile[field.code]);
      if (problem) found[field.code] = problem;
    });
    if (!effective) found.effective_from = "Choose the date these declarations apply from.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      const result = await taxApi.submit({ values: toRequestValues(schema, values), effective_from: effective }, key.current);
      toast.success("Your declarations were sent to HR for review.");
      key.current = newIdempotencyKey();
      onDirtyChange?.(false);
      onSubmitted(result);
    } catch (err) {
      setError(err);
      const server = taxFieldErrors(err);
      if (Object.keys(server).length) setErrors(server);
      if (isStepUpRequired(err)) toast.error("Confirm it's you to send a tax identifier.");
    } finally {
      setBusy(false);
    }
  };

  const visible = { ...errors };
  const summary = Object.fromEntries(Object.entries(visible).filter(([, m]) => !!m));

  return (
    <form onSubmit={submit} className="space-y-6" noValidate aria-label="Tax declarations">
      <ConflictBanner error={error} />
      <ErrorSummary error={Object.keys(summary).length ? null : error} fields={summary} />
      {groups.map(({ group, fields }) => (
        <fieldset key={group} className="space-y-4 rounded-2xl border border-border p-4">
          <legend className="px-2 text-sm font-semibold">{group}</legend>
          {fields.map((field) => {
            const onFile = identifiersOnFile[field.code];
            const hint = (
              <span className="space-y-1">
                {field.help && <span className="block">{field.help}</span>}
                {field.proof_required && <span className="block font-medium text-foreground">HR needs a proof for this: you can add it after sending.</span>}
                {field.note && <PackNote>{field.note}</PackNote>}
              </span>
            );
            const label = field.type === "MONEY" && currency ? `${field.label} (${currency})` : field.label;
            const common = { value: values[field.code] ?? "", "aria-invalid": errors[field.code] ? true : undefined } as const;
            return (
              <Field key={field.code} label={label} error={errors[field.code] || undefined} hint={hint} required={field.required && !onFile}>
                {field.type === "ENUM" ? (
                  <Select {...common} onChange={(e) => set(field.code, e.target.value)}>
                    <option value="">{field.required ? "Choose…" : "Not declared"}</option>
                    {field.choices.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                ) : field.type === "BOOL" ? (
                  <Select {...common} onChange={(e) => set(field.code, e.target.value)}>
                    <option value="">{field.required ? "Choose…" : "Not declared"}</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </Select>
                ) : field.type === "DATE" ? (
                  <Input {...common} type="date" onChange={(e) => set(field.code, e.target.value)} />
                ) : field.type === "IDENTIFIER" ? (
                  <Input
                    {...common}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={field.max_length ?? 60}
                    placeholder={onFile ? `On file ${onFile}: leave empty to keep it` : ""}
                    onChange={(e) => set(field.code, e.target.value)}
                  />
                ) : (
                  <Input
                    {...common}
                    inputMode={field.type === "TEXT" ? undefined : "decimal"}
                    autoComplete="off"
                    maxLength={field.max_length ?? undefined}
                    onChange={(e) => set(field.code, e.target.value)}
                  />
                )}
              </Field>
            );
          })}
        </fieldset>
      ))}
      <Field label="These declarations apply from" error={errors.effective_from} hint="Payroll uses the latest approved declarations that apply on the last day of the pay period.">
        <Input type="date" value={effective} aria-invalid={errors.effective_from ? true : undefined} onChange={(e) => setEffective(e.target.value)} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" loading={busy} className="min-h-[44px]">
          <Send className="h-4 w-4" aria-hidden /> Send for review
        </Button>
      </div>
    </form>
  );
}

/** The declarations of a version as the form's starting point. */
export function initialValues(version: TaxVersion | null | undefined): TaxFormValues {
  const out: TaxFormValues = {};
  Object.entries(version?.values ?? {}).forEach(([code, value]) => {
    out[code] = String(value);
  });
  return out;
}
