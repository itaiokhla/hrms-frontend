/**
 * Draft values for policy fields (POLICY_TYPES[].fields) and their conversion to the API's JSON.
 * Simple kinds get typed inputs; structured kinds (lists, maps, objects) are edited as JSON.
 */

import { isDecimalString, parseMoneyInput } from "@/lib/money";
import type { PolicyFieldMeta } from "@/lib/settings.generated";

import { humanize } from "./model";

export const JSON_KINDS = new Set(["map", "list", "object"]);

export interface MoneyField {
  amount: string;
  currency: string;
}

export type FieldDraft = string | boolean | string[] | MoneyField;

export function fieldLabel(field: PolicyFieldMeta): string {
  return humanize(field.name);
}

function isMoney(value: unknown): value is { amount?: unknown; currency?: unknown } {
  return !!value && typeof value === "object" && !Array.isArray(value) && "amount" in (value as object);
}

export function fieldToDraft(field: PolicyFieldMeta, value: unknown): FieldDraft {
  const v = value === undefined ? field.default : value;
  if (field.kind === "bool") return v === true;
  if (field.kind === "set") return Array.isArray(v) ? v.map(String) : [];
  if (field.kind === "money") return isMoney(v) ? { amount: String(v.amount ?? ""), currency: String(v.currency ?? "") } : { amount: "", currency: "" };
  if (JSON_KINDS.has(field.kind)) return v === null || v === undefined ? "" : JSON.stringify(v, null, 2);
  return v === null || v === undefined ? "" : String(v);
}

export function draftFields(fields: PolicyFieldMeta[], values: Record<string, unknown> | null | undefined): Record<string, FieldDraft> {
  return Object.fromEntries(fields.map((f) => [f.name, fieldToDraft(f, values?.[f.name])]));
}

export type FieldParse = { ok: true; value: unknown; omit?: boolean } | { ok: false; error: string };

/** One field's draft as JSON; empty optional fields are sent as null (nullable) or left to the default. */
export function parseField(field: PolicyFieldMeta, draft: FieldDraft): FieldParse {
  const label = fieldLabel(field);
  const text = typeof draft === "string" ? draft.trim() : "";
  const nullable = field.nullable === true;
  const emptyText = typeof draft === "string" && text === "";
  if (emptyText && !["bool", "set"].includes(field.kind)) {
    if (nullable) return { ok: true, value: null };
    if (field.required) return { ok: false, error: `Enter ${label.toLowerCase()}.` };
    return { ok: true, value: undefined, omit: true };
  }
  switch (field.kind) {
    case "bool":
      return { ok: true, value: draft === true };
    case "set":
      return { ok: true, value: Array.isArray(draft) ? draft : [] };
    case "int":
      if (!/^-?\d+$/.test(text)) return { ok: false, error: `${label} must be a whole number.` };
      return { ok: true, value: Number(text) };
    case "decimal":
      if (!isDecimalString(text)) return { ok: false, error: `${label} must be a number, for example 1.5.` };
      return { ok: true, value: text };
    case "hours_or_shift": {
      const choices = (field.choices as string[] | undefined) ?? [];
      if (choices.includes(text)) return { ok: true, value: text };
      if (!isDecimalString(text)) return { ok: false, error: `${label}: enter hours, or choose the shift duration.` };
      return { ok: true, value: text };
    }
    case "ref":
      if (!/^\d+$/.test(text) || Number(text) <= 0) return { ok: false, error: `${label} must be a record id.` };
      return { ok: true, value: Number(text) };
    case "money": {
      const money = draft as MoneyField;
      const amount = money.amount.trim();
      if (!amount) return nullable ? { ok: true, value: null } : { ok: true, value: undefined, omit: true };
      if (!money.currency) return { ok: false, error: `Choose the currency of ${label.toLowerCase()}.` };
      const parsed = parseMoneyInput(amount, money.currency, { locale: "en" });
      return parsed.ok ? { ok: true, value: { amount: parsed.amount, currency: money.currency } } : { ok: false, error: parsed.message };
    }
    default:
      if (JSON_KINDS.has(field.kind)) {
        try {
          return { ok: true, value: JSON.parse(text) };
        } catch {
          return { ok: false, error: `${label} must be valid JSON.` };
        }
      }
      if (typeof field.max_length === "number" && text.length > field.max_length) {
        return { ok: false, error: `${label} is at most ${field.max_length} characters.` };
      }
      return { ok: true, value: text };
  }
}

/** All fields → `{fields}` body, or per-field errors. */
export function buildFields(
  fields: PolicyFieldMeta[],
  drafts: Record<string, FieldDraft>,
): { ok: true; value: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const value: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const parsed = parseField(field, drafts[field.name] ?? fieldToDraft(field, undefined));
    if (!parsed.ok) errors[field.name] = parsed.error;
    else if (!parsed.omit) value[field.name] = parsed.value;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

/** A one-line summary of a policy version for its card ("Unmarked day: Exception · …"). */
export function summarizeFields(fields: PolicyFieldMeta[], values: Record<string, unknown> | null | undefined, limit = 4): string {
  if (!values) return "";
  const parts: string[] = [];
  for (const field of fields) {
    if (parts.length >= limit) break;
    const v = values[field.name];
    if (v === null || v === undefined || v === "" || JSON_KINDS.has(field.kind) || field.kind === "formula") continue;
    let text: string;
    if (typeof v === "boolean") text = v ? "yes" : "no";
    else if (isMoney(v)) text = `${String(v.amount)} ${String(v.currency ?? "")}`.trim();
    else if (Array.isArray(v)) text = v.map((x) => humanize(x)).join(", ");
    else if (field.kind === "enum" || field.kind === "hours_or_shift") text = /^[A-Z_]+$/.test(String(v)) ? humanize(v) : String(v);
    else text = `${String(v)}${typeof field.unit === "string" ? ` ${field.unit}` : ""}`;
    parts.push(`${fieldLabel(field)}: ${text}`);
  }
  return parts.join(" · ");
}

/** The field a server validation error points at ("buckets.0.multiplier" → "buckets"). */
export function errorField(error: unknown): string | null {
  const detail = (error as { detail?: unknown })?.detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const field = (detail as { field?: unknown }).field;
  return typeof field === "string" && field ? field.split(".")[0] : null;
}
