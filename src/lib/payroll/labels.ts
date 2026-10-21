/**
 * Status vocabularies, run stages and honest payment labels for payroll v2 (3.8 §7, §9, §12).
 *
 * Everything here is derived from `catalogues.generated.ts`, which the backend generates from
 * `app/payroll/state_machines.py`, so labels and tones can never drift from the real states.
 */

import type { ScopeLevel, SettingLevel } from "@/lib/settings.generated";

import {
  EMPLOYEE_PAYMENT_LABELS,
  RUN_SIDE_STATES,
  RUN_STATE_STAGE,
  RUN_UI_STAGE_LABELS,
  VOCABULARIES,
  type StatusEntry,
  type StatusTone,
  type VocabularyName,
} from "./catalogues.generated";

export { VOCABULARIES, type StatusEntry, type StatusTone, type VocabularyName };

export interface ResolvedStatus extends StatusEntry {
  code: string;
  /** False when the code is not in the vocabulary (shown neutrally with its raw code). */
  known: boolean;
}

function humanize(code: string): string {
  const text = code.replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : "—";
}

/** Label, tone and glossary of a status; an unknown code is shown neutrally, never as success. */
export function statusEntry(vocabulary: VocabularyName, code: string | null | undefined): ResolvedStatus {
  const value = code ?? "";
  const entry = VOCABULARIES[vocabulary]?.states[value];
  if (entry) return { ...entry, code: value, known: true };
  return { label: humanize(value), tone: "neutral", glossary: "", code: value, known: false };
}

export function isSideState(vocabulary: VocabularyName, code: string): boolean {
  return VOCABULARIES[vocabulary]?.side.includes(code) ?? false;
}

export function isTerminalState(vocabulary: VocabularyName, code: string): boolean {
  return VOCABULARIES[vocabulary]?.terminal.includes(code) ?? false;
}

/* ------------------------------------------------------------------ run stages */

export interface RunStage {
  stage: number;
  label: string;
}

/** ① Prepare … ⑥ Close. */
export const RUN_STAGES: RunStage[] = Object.keys(RUN_UI_STAGE_LABELS)
  .map(Number)
  .sort((a, b) => a - b)
  .map((stage) => ({ stage, label: RUN_UI_STAGE_LABELS[stage] }));

/** The stage 1–6 of a run state; `null` for side states (CANCELLED, REOPENED_FOR_CORRECTION) and unknown states. */
export function runStage(state: string | null | undefined): number | null {
  if (!state || RUN_SIDE_STATES.includes(state)) return null;
  return RUN_STATE_STAGE[state] ?? null;
}

/* ------------------------------------------------------------------ employee payment labels */

export interface EmployeePaymentLabel {
  key: string;
  label: string;
  /** Full sentence with {date} and {amount} filled in when given. */
  text: string;
  tone: StatusTone;
  glossary: string;
  /** "SANDBOX" for sandbox instructions, which are labelled as such everywhere. */
  badge: string | null;
}

/**
 * What an employee sees for an instruction (3.7 §8.1, decision I-17). Never "Paid" without
 * verified settlement evidence: an unknown or invalid combination fails closed to "Processing"
 * for in-flight and settled statuses.
 */
export function employeePaymentLabel(
  status: string,
  channel: string | null | undefined,
  evidence: string | null | undefined = "UNVERIFIED",
  values: { date?: string; amount?: string } = {},
): EmployeePaymentLabel {
  const row = EMPLOYEE_PAYMENT_LABELS[status]?.[channel || "NONE"]?.[evidence || "UNVERIFIED"];
  const key = row?.key ?? (EMPLOYEE_PAYMENT_LABELS[status]?.NONE?.UNVERIFIED?.key ?? "PROCESSING");
  const entry = statusEntry("employee_payment", key);
  const text = (entry.text ?? entry.label)
    .replace("{date}", values.date ?? "")
    .replace("{amount}", values.amount ?? "")
    .replace(/\s+—\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { key, label: entry.label, text, tone: entry.tone, glossary: entry.glossary, badge: row?.badge ?? null };
}

/* ------------------------------------------------------------------ inheritance (3.8 §5.16) */

export type InheritanceKind = "INHERITED" | "OVERRIDDEN" | "LOCKED" | "LEGAL" | "DEFAULT";

const LEVEL_NAMES: Record<SettingLevel, string> = {
  EMPLOYEE: "employee",
  PAY_GROUP: "pay group",
  BRANCH: "branch",
  LEGAL_ENTITY: "legal entity",
  TENANT: "tenant",
  PARTNER: "partner",
  COUNTRY_PACK: "country pack",
  PLATFORM: "platform default",
};

export function levelName(level: SettingLevel | ScopeLevel | string): string {
  return LEVEL_NAMES[level as SettingLevel] ?? humanize(level).toLowerCase();
}

/** "Inherited from tenant", "Overridden here", "Locked by tenant", "Required by law", "Platform default". */
export function inheritanceLabel(kind: InheritanceKind, level?: SettingLevel | ScopeLevel | string | null): string {
  switch (kind) {
    case "OVERRIDDEN":
      return "Overridden here";
    case "LOCKED":
      return `Locked by ${level ? levelName(level) : "an administrator"}`;
    case "LEGAL":
      return "Required by law";
    case "DEFAULT":
      return "Platform default";
    default:
      return level ? `Inherited from ${levelName(level)}` : "Inherited";
  }
}

/* ------------------------------------------------------------------ small formatters (3.8 §9) */

/** "▲ 31.0%" / "▼ 2.5%" / "0.0%": one decimal, an arrow and words for screen readers (colour never alone). */
export function percentChange(value: string | number | null | undefined): { text: string; direction: "up" | "down" | "flat"; spoken: string } {
  if (value === null || value === undefined || value === "") return { text: "—", direction: "flat", spoken: "no change data" };
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return { text: "—", direction: "flat", spoken: "no change data" };
  const abs = Math.abs(n).toFixed(1);
  if (Number(abs) === 0) return { text: "0.0%", direction: "flat", spoken: "no change" };
  return n > 0
    ? { text: `▲ ${abs}%`, direction: "up", spoken: `up ${abs} percent` }
    : { text: `▼ ${abs}%`, direction: "down", spoken: `down ${abs} percent` };
}

/** Days with up to 2 decimals ("26.5 days"). Input is a decimal string or number from the API. */
export function formatDays(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const text = n.toFixed(2).replace(/\.?0+$/, "");
  return `${text} ${n === 1 ? "day" : "days"}`;
}

/** Payroll hours as decimals ("7.75 h") with the clock reading for a tooltip ("7 h 45 m"). */
export function formatDecimalHours(value: string | number | null | undefined): { text: string; title: string } {
  if (value === null || value === undefined || value === "") return { text: "—", title: "" };
  const n = Number(value);
  if (!Number.isFinite(n)) return { text: String(value), title: "" };
  const minutes = Math.round(Math.abs(n) * 60);
  const sign = n < 0 ? "−" : "";
  return { text: `${sign}${Math.abs(n).toFixed(2).replace(/\.?0+$/, "") || "0"} h`, title: `${sign}${Math.floor(minutes / 60)} h ${minutes % 60} m` };
}
