"use client";

import { useId } from "react";

import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import type { PolicyFieldMeta } from "@/lib/settings.generated";

import { humanize } from "./model";
import { JSON_KINDS, fieldLabel, type FieldDraft, type MoneyField } from "./policyFields";
import { PAY_CURRENCIES } from "./SettingControl";

function hint(field: PolicyFieldMeta): string | undefined {
  const parts = [field.help];
  if (field.minimum !== undefined && field.maximum !== undefined) parts.push(`From ${String(field.minimum)} to ${String(field.maximum)}.`);
  if (field.legal_sensitivity && field.legal_sensitivity !== "NONE") parts.push("The law may limit this value.");
  if (JSON_KINDS.has(field.kind)) parts.push("Edited as JSON.");
  return parts.filter(Boolean).join(" ") || undefined;
}

/** Inputs for a policy type's fields, generated from POLICY_TYPES metadata. */
export function PolicyFieldsForm({
  fields,
  drafts,
  onChange,
  errors,
  disabled,
}: {
  fields: PolicyFieldMeta[];
  drafts: Record<string, FieldDraft>;
  onChange: (name: string, value: FieldDraft) => void;
  errors: Record<string, string>;
  disabled?: boolean;
}) {
  const base = useId();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => {
        const draft = drafts[field.name];
        const label = fieldLabel(field);
        const error = errors[field.name];
        const wide = JSON_KINDS.has(field.kind) || field.kind === "formula" || field.kind === "set" || field.kind === "bool";
        const text = typeof draft === "string" ? draft : "";
        const set = (v: FieldDraft) => onChange(field.name, v);
        const unit = typeof field.unit === "string" ? field.unit : null;
        let control;
        switch (field.kind) {
          case "bool":
            return (
              <div key={field.name} className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3 sm:col-span-2">
                <span>
                  <span id={`${base}-${field.name}`} className="block text-sm font-medium">
                    {label}
                  </span>
                  {field.help && <span className="block text-xs text-muted-foreground">{field.help}</span>}
                  {error && (
                    <span role="alert" className="block text-xs font-medium text-danger">
                      {error}
                    </span>
                  )}
                </span>
                <Switch checked={draft === true} onChange={set} label={label} aria-labelledby={`${base}-${field.name}`} disabled={disabled} />
              </div>
            );
          case "enum":
            control = (
              <Select value={text} onChange={(e) => set(e.target.value)} disabled={disabled}>
                {(field.nullable || !text) && <option value="">Not set</option>}
                {((field.choices as string[] | undefined) ?? []).map((c) => (
                  <option key={c} value={c}>
                    {humanize(c)}
                  </option>
                ))}
              </Select>
            );
            break;
          case "hours_or_shift": {
            const choices = (field.choices as string[] | undefined) ?? [];
            const isChoice = choices.includes(text);
            control = (
              <div className="flex gap-2">
                <Select
                  aria-label={`${label}: kind`}
                  className="max-w-[11rem]"
                  value={isChoice ? text : "HOURS"}
                  onChange={(e) => set(e.target.value === "HOURS" ? "" : e.target.value)}
                  disabled={disabled}
                >
                  {choices.map((c) => (
                    <option key={c} value={c}>
                      {humanize(c)}
                    </option>
                  ))}
                  <option value="HOURS">Hours</option>
                </Select>
                {!isChoice && (
                  <Input inputMode="decimal" dir="ltr" aria-label={`${label} in hours`} value={text} onChange={(e) => set(e.target.value)} disabled={disabled} />
                )}
              </div>
            );
            break;
          }
          case "set": {
            const chosen = Array.isArray(draft) ? draft : [];
            control = (
              <div role="group" aria-label={label} className="flex flex-wrap gap-2">
                {((field.choices as string[] | undefined) ?? []).map((c) => (
                  <label key={c} className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-border px-3 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={chosen.includes(c)}
                      disabled={disabled}
                      onChange={(e) => set(e.target.checked ? [...chosen, c] : chosen.filter((x) => x !== c))}
                    />
                    {humanize(c)}
                  </label>
                ))}
              </div>
            );
            break;
          }
          case "money": {
            const money = (draft as MoneyField) ?? { amount: "", currency: "" };
            control = (
              <div className="flex gap-2">
                <Input aria-label={`${label}: amount`} inputMode="decimal" dir="ltr" value={money.amount} onChange={(e) => set({ ...money, amount: e.target.value })} disabled={disabled} />
                <Select aria-label={`${label}: currency`} className="max-w-[7.5rem]" value={money.currency} onChange={(e) => set({ ...money, currency: e.target.value })} disabled={disabled}>
                  <option value="">Currency</option>
                  {PAY_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </div>
            );
            break;
          }
          case "formula":
            control = <Textarea dir="ltr" className="font-mono text-xs" value={text} onChange={(e) => set(e.target.value)} disabled={disabled} />;
            break;
          case "int":
          case "decimal":
          case "ref":
            control = (
              <div className="flex items-center gap-2">
                <Input aria-label={label} inputMode={field.kind === "decimal" ? "decimal" : "numeric"} dir="ltr" value={text} onChange={(e) => set(e.target.value)} disabled={disabled} />
                {unit && <span className="shrink-0 text-sm text-muted-foreground">{unit}</span>}
              </div>
            );
            break;
          default:
            control = JSON_KINDS.has(field.kind) ? (
              <Textarea dir="ltr" className="min-h-[120px] font-mono text-xs" value={text} onChange={(e) => set(e.target.value)} disabled={disabled} />
            ) : (
              <Input value={text} onChange={(e) => set(e.target.value)} disabled={disabled} maxLength={typeof field.max_length === "number" ? field.max_length : undefined} />
            );
        }
        // Field labels the single control it wraps; compound controls label their parts themselves.
        const single = !["hours_or_shift", "set", "money", "int", "decimal", "ref"].includes(field.kind);
        return (
          <Field
            key={field.name}
            label={label}
            required={field.required === true}
            error={error}
            hint={hint(field)}
            className={wide ? "sm:col-span-2" : undefined}
          >
            {single ? control : <div>{control}</div>}
          </Field>
        );
      })}
    </div>
  );
}
