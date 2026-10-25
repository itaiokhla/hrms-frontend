"use client";

import { AlertTriangle, CheckCircle2, Circle, Clock3, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { formatMoney, isDecimalString } from "@/lib/money";

import type { TaxField, TaxFormValues, TaxProfileStatus, TaxVersion } from "./types";

/* ------------------------------------------------------------------ status */

const STATUS: Record<TaxProfileStatus, { label: string; hint: string; tone: "info" | "success" | "danger" | "neutral"; icon: typeof Circle }> = {
  SUBMITTED: { label: "Submitted", hint: "Waiting for HR to review.", tone: "info", icon: Clock3 },
  APPROVED: { label: "Approved", hint: "HR approved these declarations; payroll can use them.", tone: "success", icon: CheckCircle2 },
  REJECTED: { label: "Rejected", hint: "HR could not approve these declarations. Read the reason and submit them again.", tone: "danger", icon: XCircle },
  WITHDRAWN: { label: "Withdrawn", hint: "Withdrawn by the employee before review.", tone: "neutral", icon: Circle },
};

const TONE: Record<string, string> = {
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-muted text-muted-foreground",
};

/** SUBMITTED / APPROVED / REJECTED (and WITHDRAWN) with the same look as the payroll status chips. */
export function TaxStatusChip({ status, className }: { status: string; className?: string }) {
  const entry = STATUS[status as TaxProfileStatus] ?? { label: status, hint: "", tone: "neutral" as const, icon: Circle };
  const Icon = entry.icon;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", TONE[entry.tone], className)}
      data-status={status}
      data-tone={entry.tone}
      title={entry.hint || undefined}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {entry.label}
    </span>
  );
}

/** An honesty label from the pack ("FIXTURE — not law"): shown as the pack sent it, never rephrased or hidden. */
export function PackNote({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-start gap-1 rounded-md border border-warning/40 bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span>{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ values */

/** The shown form of a stored value: money with its currency, choices by label, yes/no, dates formatted. */
export function displayValue(field: TaxField, value: string | number | boolean | undefined | null, currency: string | null): string {
  if (value === undefined || value === null || value === "") return "—";
  if (field.type === "BOOL") return value === true || value === "true" ? "Yes" : "No";
  if (field.type === "ENUM") return field.choices.find((c) => c.value === value)?.label ?? String(value);
  if (field.type === "MONEY" && currency && typeof value === "string" && isDecimalString(value)) return formatMoney(value, currency);
  if (field.type === "DATE" && typeof value === "string") return fmtDate(value, "d MMM yyyy");
  return String(value);
}

/** Flat values of a stored version as the form's strings (a boolean becomes "true"/"false"). */
export function toFormValues(version: Pick<TaxVersion, "values"> | null | undefined): TaxFormValues {
  const out: TaxFormValues = {};
  Object.entries(version?.values ?? {}).forEach(([code, value]) => {
    out[code] = typeof value === "boolean" ? String(value) : String(value);
  });
  return out;
}

/** The request body for a submission: empty fields are left out, integers and booleans keep their JSON type. */
export function toRequestValues(schema: TaxField[], form: TaxFormValues): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  schema.forEach((field) => {
    const raw = (form[field.code] ?? "").trim();
    if (!raw) return;
    if (field.type === "BOOL") out[field.code] = raw === "true";
    else if (field.type === "INTEGER" && /^-?\d+$/.test(raw)) out[field.code] = Number(raw);
    else out[field.code] = raw;
  });
  return out;
}

/** Fields grouped as the pack groups them, in the pack's order. */
export function groupFields(schema: TaxField[]): { group: string; fields: TaxField[] }[] {
  const groups: { group: string; fields: TaxField[] }[] = [];
  schema.forEach((field) => {
    const name = field.group || "Details";
    const found = groups.find((g) => g.group === name);
    if (found) found.fields.push(field);
    else groups.push({ group: name, fields: [field] });
  });
  return groups;
}

/**
 * Field errors of a 422 TAX_PROFILE_INVALID, keyed by the full field code (a code may contain a dot, so the
 * shared `fieldErrors`, which keeps the first path segment, is not used here).
 */
export function taxFieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const fields = error instanceof ApiError ? error.fields ?? [] : [];
  fields.forEach((f) => {
    const key = String(f.field || "form");
    if (!out[key]) out[key] = f.msg;
  });
  return out;
}

export function formatDay(value: string | null | undefined): string {
  return value ? fmtDate(value, "d MMM yyyy") : "—";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Read-only table of what was declared, labelled by the pack's fields (identifiers masked). */
export function VersionValues({ version, schema, currency }: { version: TaxVersion; schema: TaxField[]; currency: string | null }) {
  const rows = schema.filter((f) => (f.type === "IDENTIFIER" ? version.identifiers[f.code] : version.values[f.code] !== undefined));
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing was declared in this version.</p>;
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {rows.map((field) => (
        <div key={field.code} className="min-w-0">
          <dt className="text-muted-foreground">{field.label}</dt>
          <dd className="break-words font-medium" data-field={field.code}>
            <bdi dir="auto">{field.type === "IDENTIFIER" ? version.identifiers[field.code] : displayValue(field, version.values[field.code], currency)}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}
