/**
 * Pure helpers for the Settings › Payroll pages: definitions per section, draft values for the
 * typed controls, client-side checks that mirror the registry constraints (the API stays the
 * authority), effective-date notices and error mapping. No React here, so every rule is unit-tested.
 */

import { format, parseISO } from "date-fns";

import { ApiError } from "@/lib/api";
import { compareDecimalStrings, isDecimalString, parseMoneyInput } from "@/lib/money";
import {
  POLICY_TYPES,
  SETTING_DEFINITIONS,
  SETTING_SECTIONS,
  SETTINGS_PROFILES,
  type PolicyTypeMeta,
  type SettingDefinition,
  type SettingSection,
} from "@/lib/settings.generated";

import type { EditableScope, SettingIssue, SettingValueItem, ValuesResponse } from "./types";

/* ------------------------------------------------------------------ registry lookups */

export const ALL_DEFINITIONS: SettingDefinition[] = Object.values(SETTING_DEFINITIONS);

export function sectionBySlug(slug: string): SettingSection | undefined {
  return SETTING_SECTIONS.find((s) => s.slug === slug);
}

const order = (d: SettingDefinition) => (typeof d.ui.order === "number" ? d.ui.order : 1000);

/** The settings of one section, in display order. */
export function sectionDefinitions(slug: string): SettingDefinition[] {
  return ALL_DEFINITIONS.filter((d) => d.sectionSlug === slug).sort((a, b) => order(a) - order(b));
}

export function definitionOf(key: string): SettingDefinition | undefined {
  return (SETTING_DEFINITIONS as Record<string, SettingDefinition>)[key];
}

export function policyTypeOf(code: string): PolicyTypeMeta | undefined {
  return POLICY_TYPES.find((t) => t.code === code);
}

/** Scope levels at which at least one setting of the section can be set (TENANT first). */
export function sectionLevels(defs: SettingDefinition[]): EditableScope[] {
  const all: EditableScope[] = ["TENANT", "LEGAL_ENTITY", "BRANCH", "PAY_GROUP"];
  return all.filter((level) => defs.some((d) => (d.allowedLevels as string[]).includes(level)));
}

/** Groups a section's settings by `ui.group`, keeping display order. */
export function groupDefinitions(defs: SettingDefinition[]): { group: string | null; defs: SettingDefinition[] }[] {
  const groups: { group: string | null; defs: SettingDefinition[] }[] = [];
  for (const def of defs) {
    const name = typeof def.ui.group === "string" ? def.ui.group : null;
    const last = groups[groups.length - 1];
    if (last && last.group === name) last.defs.push(def);
    else groups.push({ group: name, defs: [def] });
  }
  return groups;
}

export const LEVEL_LABELS: Record<string, string> = {
  EMPLOYEE: "Employee",
  PAY_GROUP: "Pay group",
  BRANCH: "Branch",
  LEGAL_ENTITY: "Legal entity",
  TENANT: "Company",
  PARTNER: "Partner",
  COUNTRY_PACK: "Country pack",
  PLATFORM: "Platform default",
};

/* ------------------------------------------------------------------ copy */

const WORDS: Record<string, string> = {
  MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
  LOP: "LOP", FX: "FX", CSV: "CSV", PDF: "PDF", IN_APP: "In-app", EMAIL: "Email", HALF_UP: "Half up",
  HALF_EVEN: "Half even (banker's)", GENERIC_CSV: "Generic CSV",
};

/** A readable label for an enum code ("SEMI_MONTHLY" → "Semi monthly"). */
export function humanize(code: unknown): string {
  if (code === null || code === undefined || code === "") return "Not set";
  const text = String(code);
  if (WORDS[text]) return WORDS[text];
  const words = text.toLowerCase().split(/[_\s]+/).filter(Boolean);
  if (!words.length) return text;
  return words
    .map((w, i) => (WORDS[w.toUpperCase()] && w.length <= 3 ? WORDS[w.toUpperCase()] : i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Splits registry help "ON: … OFF: …" into its two consequences; other help stays as text. */
export function splitHelp(help: string): { on: string | null; off: string | null; text: string | null } {
  const match = /^\s*ON:\s*([\s\S]*?)\s*OFF:\s*([\s\S]*)$/.exec(help ?? "");
  if (!match) return { on: null, off: null, text: help?.trim() || null };
  return { on: match[1].trim(), off: match[2].trim(), text: null };
}

/** STARTER_V1 "decision required" question for a key, if any. */
export function decisionFor(key: string): string | null {
  const starter = SETTINGS_PROFILES.find((p) => p.name === "STARTER_V1");
  return (starter?.decisions as Record<string, string> | undefined)?.[key] ?? null;
}

function isMoney(value: unknown): value is { amount: string; currency: string | null } {
  return !!value && typeof value === "object" && "amount" in (value as object);
}

/** A value as text for read-only display (inheritance view, change requests). Money stays a string. */
export function formatValue(def: SettingDefinition | undefined, value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not set";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (isMoney(value)) return [value.amount, value.currency].filter(Boolean).join(" ");
  if (Array.isArray(value)) return value.length ? value.map((v) => (def?.type === "set" ? humanize(v) : String(v))).join(", ") : "None";
  if (typeof value === "object") return JSON.stringify(value);
  if (def?.type === "enum") return humanize(value);
  if (def?.type === "date") return fmtDay(String(value));
  const unit = typeof def?.ui.unit === "string" ? ` ${def.ui.unit}` : "";
  return `${String(value)}${unit}`;
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "d MMM yyyy");
  } catch {
    return iso;
  }
}

/** What an effective date means for open periods (mirrors registry.effective_date_notice). */
export function grainNotice(grain: "PERIOD" | "DAY", effectiveFrom: string): string {
  try {
    const day = parseISO(effectiveFrom);
    return grain === "PERIOD"
      ? `Applies to the whole ${format(day, "MMMM yyyy")} period`
      : `Applies from ${format(day, "d MMM yyyy")}`;
  } catch {
    return `Applies from ${effectiveFrom}`;
  }
}

export function localTodayISO(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/* ------------------------------------------------------------------ drafts */

export interface MoneyDraft {
  amount: string;
  currency: string;
}

/** What a control edits: booleans, strings, string lists or a money pair. */
export type DraftValue = boolean | string | string[] | MoneyDraft | null;

export function toDraft(def: SettingDefinition, value: unknown): DraftValue {
  switch (def.type) {
    case "bool":
      return value === true;
    case "money":
      return isMoney(value) ? { amount: value.amount ?? "", currency: value.currency ?? "" } : { amount: "", currency: "" };
    case "set":
      return Array.isArray(value) ? value.map(String) : [];
    case "list":
      return Array.isArray(value) ? value.map(String).join(", ") : "";
    case "json":
      return value === null || value === undefined ? "" : JSON.stringify(value, null, 2);
    default:
      return value === null || value === undefined ? "" : String(value);
  }
}

export type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

const fail = (error: string): Parsed => ({ ok: false, error });

function bounds(def: SettingDefinition, text: string, label: string): string | null {
  const c = def.constraints as Record<string, unknown>;
  const cmp = (limit: unknown) => compareDecimalStrings(text, String(limit));
  if (c.min !== undefined && cmp(c.min) < 0) return `${label} must be at least ${c.min}.`;
  if (c.max !== undefined && cmp(c.max) > 0) return `${label} must be at most ${c.max}.`;
  if (c.gt !== undefined && cmp(c.gt) <= 0) return `${label} must be more than ${c.gt}.`;
  return null;
}

/**
 * Turns a control's draft into the JSON value the API expects, or explains what is wrong.
 * Integers are sent as JSON integers; decimals, money amounts, dates and times as strings.
 */
export function fromDraft(def: SettingDefinition, draft: DraftValue): Parsed {
  const c = def.constraints as Record<string, unknown>;
  const nullable = c.nullable === true;
  const label = def.label;
  const text = typeof draft === "string" ? draft.trim() : "";
  const empty = draft === null || (typeof draft === "string" && text === "");
  if (empty && def.type !== "bool" && def.type !== "set") {
    return nullable || def.type === "list" || def.type === "json" ? { ok: true, value: def.type === "list" ? [] : null } : fail(`Enter ${label.toLowerCase()}.`);
  }
  switch (def.type) {
    case "bool":
      if (c.const !== undefined && draft !== c.const) return fail(`${label} can't be changed.`);
      return { ok: true, value: draft === true };
    case "int": {
      if (!/^-?\d+$/.test(text)) return fail(`${label} must be a whole number.`);
      const problem = bounds(def, text, label);
      if (problem) return fail(problem);
      const n = Number(text);
      if (!Number.isSafeInteger(n)) return fail(`${label} is too large.`);
      return { ok: true, value: n };
    }
    case "decimal": {
      if (!isDecimalString(text)) return fail(`${label} must be a number, for example 1.5.`);
      const places = text.includes(".") ? text.split(".")[1].replace(/0+$/, "").length : 0;
      if (typeof c.max_places === "number" && places > c.max_places) return fail(`${label} allows at most ${c.max_places} decimal places.`);
      const problem = bounds(def, text, label);
      if (problem) return fail(problem);
      return { ok: true, value: text };
    }
    case "enum": {
      const choices = (c.choices as string[] | undefined) ?? [];
      return choices.length && !choices.includes(text) ? fail(`Choose a value for ${label.toLowerCase()}.`) : { ok: true, value: text };
    }
    case "money": {
      const money = (draft as MoneyDraft | null) ?? { amount: "", currency: "" };
      const currency = money.currency.trim().toUpperCase();
      const amount = money.amount.trim();
      if (!amount) return nullable ? { ok: true, value: null } : fail(`Enter an amount for ${label.toLowerCase()}.`);
      if (!currency) {
        // The registry allows a currency-less amount only for zero (MoneyValue).
        return /^0*(\.0*)?$/.test(amount) ? { ok: true, value: { amount: "0", currency: null } } : fail("Choose the currency of this amount.");
      }
      const parsed = parseMoneyInput(amount, currency, { locale: "en" });
      if (!parsed.ok) return fail(parsed.message);
      if (c.min !== undefined && compareDecimalStrings(parsed.amount, String(c.min)) < 0) return fail(`${label} must be at least ${c.min}.`);
      return { ok: true, value: { amount: parsed.amount, currency } };
    }
    case "ref": {
      if (!/^\d+$/.test(text) || Number(text) <= 0) return fail(`Choose ${label.toLowerCase()}.`);
      return { ok: true, value: Number(text) };
    }
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? { ok: true, value: text } : fail(`${label} must be a date.`);
    case "time":
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? { ok: true, value: text } : fail(`${label} must be a time such as 09:30.`);
    case "string": {
      if (typeof c.max_length === "number" && text.length > c.max_length) return fail(`${label} is at most ${c.max_length} characters.`);
      if (c.format === "iso4217" && !/^[A-Z]{3}$/.test(text.toUpperCase())) return fail(`${label} must be a 3-letter currency code.`);
      return { ok: true, value: c.format === "iso4217" ? text.toUpperCase() : text };
    }
    case "list": {
      const items = text.split(",").map((s) => s.trim()).filter(Boolean);
      if (typeof c.min_items === "number" && items.length < c.min_items) return fail(`Enter at least ${c.min_items}.`);
      if (typeof c.max_items === "number" && items.length > c.max_items) return fail(`Enter at most ${c.max_items}.`);
      if (c.unique && new Set(items).size !== items.length) return fail("Each value may appear once.");
      return { ok: true, value: items };
    }
    case "set": {
      const items = Array.isArray(draft) ? draft : [];
      if (typeof c.min_items === "number" && items.length < c.min_items) return fail(`Choose at least ${c.min_items}.`);
      return { ok: true, value: items };
    }
    case "json":
      try {
        return { ok: true, value: JSON.parse(text) };
      } catch {
        return fail(`${label} must be valid JSON.`);
      }
    default:
      return { ok: true, value: text };
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Structural equality of two JSON values (key order and set order ignored). */
export function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? [...v].sort() : v);
  return stable(norm(a)) === stable(norm(b));
}

/** `ui.visible_when`: {key, equals} | {key, in} | {profile}. Unknown conditions show the control. */
export function isVisible(def: SettingDefinition, valueOf: (key: string) => unknown, profileVersion: string | null): boolean {
  const rule = def.ui.visible_when as { key?: string; equals?: unknown; in?: unknown[]; profile?: string } | undefined;
  if (!rule) return true;
  if (rule.profile) return !!profileVersion && profileVersion.startsWith(rule.profile);
  if (!rule.key) return true;
  const current = valueOf(rule.key);
  if (Array.isArray(rule.in)) return rule.in.includes(current);
  if ("equals" in rule) return current === rule.equals;
  return true;
}

/* ------------------------------------------------------------------ issues and errors */

export function issuesByKey(issues: SettingIssue[]): Record<string, SettingIssue[]> {
  const found: Record<string, SettingIssue[]> = {};
  for (const issue of issues) for (const key of issue.keys ?? []) (found[key] ??= []).push(issue);
  return found;
}

export type SaveProblem =
  | { kind: "conflict"; code: string; key: string | null; message: string; current: Record<string, unknown> | null }
  | { kind: "invalid"; message: string; issues: SettingIssue[] }
  | { kind: "field"; key: string; message: string }
  | { kind: "reason"; message: string }
  | { kind: "other"; message: string; code?: string };

/**
 * Maps a failed save to what the page shows. The payroll client keeps object `detail`s
 * (`PayrollApiError.detail`); `changedKeys` lets a single-change error point at its control.
 */
export function describeSaveError(error: unknown, changedKeys: string[] = []): SaveProblem {
  const status = error instanceof ApiError ? error.status : 0;
  const code = (error instanceof ApiError && error.code) || "";
  const message = error instanceof Error ? error.message : "Saving failed. Please try again.";
  const detail = (error as { detail?: unknown })?.detail;
  const body = detail && typeof detail === "object" && !Array.isArray(detail) ? (detail as Record<string, unknown>) : null;
  if (status === 409) {
    return {
      kind: "conflict",
      code: code || "CONFLICT",
      key: typeof body?.key === "string" ? body.key : changedKeys.length === 1 ? changedKeys[0] : null,
      message,
      current: body?.current && typeof body.current === "object" ? (body.current as Record<string, unknown>) : null,
    };
  }
  if (Array.isArray(body?.issues)) return { kind: "invalid", message, issues: body!.issues as SettingIssue[] };
  if (code === "REASON_REQUIRED") return { kind: "reason", message };
  if (typeof body?.key === "string") return { kind: "field", key: body.key, message };
  if (status === 400 && changedKeys.length === 1 && code !== "SETTING_LOCKED") return { kind: "field", key: changedKeys[0], message };
  return { kind: "other", message, code: code || undefined };
}

/* ------------------------------------------------------------------ setup checklist */

export interface ChecklistItem {
  key: string;
  label: string;
  question: string;
  sectionSlug: string;
  sectionTitle: string;
  /** "decided" once an administrator saved a value; the starter profile value alone is not a decision. */
  state: "decided" | "required";
  value: unknown;
}

/** The STARTER_V1 "decision required" items with their state at company level. */
export function checklistItems(values: ValuesResponse | undefined): ChecklistItem[] {
  const starter = SETTINGS_PROFILES.find((p) => p.name === "STARTER_V1");
  const decisions = (starter?.decisions ?? {}) as Record<string, string>;
  const byKey = new Map<string, SettingValueItem>((values?.items ?? []).map((i) => [i.key, i]));
  return Object.entries(decisions).flatMap(([key, question]) => {
    const def = definitionOf(key);
    if (!def) return [];
    const item = byKey.get(key);
    const source = item?.here?.source ?? null;
    const decided = !!item?.here && source !== "STARTER_PROFILE" && source !== "LEGACY_MIGRATION";
    return [{
      key,
      label: def.label,
      question,
      sectionSlug: def.sectionSlug,
      sectionTitle: sectionBySlug(def.sectionSlug)?.title ?? def.section,
      state: decided ? "decided" : "required",
      value: item?.value,
    }];
  });
}
