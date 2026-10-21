/**
 * Response shapes of the payroll settings and policies API
 * (hrms-backend/app/payroll/routes/settings.py, policies.py; services/settings.py, policies.py).
 */

import type { ScopeLevel, SettingLevel } from "@/lib/settings.generated";

/** Levels the settings scope bar edits (3.8 §5.16). EMPLOYEE overrides are edited from the employee. */
export type EditableScope = Exclude<ScopeLevel, "EMPLOYEE">;

export interface ScopeRef {
  scope_type: EditableScope;
  scope_id: number | null;
  name?: string;
}

/** A cross-setting or value issue (V-01…V-16, legal limits). */
export interface SettingIssue {
  rule: string;
  severity: "ERROR" | "WARNING";
  keys: string[];
  message: string;
  details?: Record<string, unknown>;
  blocks_save?: boolean;
}

export type BadgeCode = "REQUIRED_BY_LAW" | "OVERRIDDEN_HERE" | "SET_HERE" | "LOCKED" | "INHERITED";

export interface InheritanceInfo {
  code: BadgeCode;
  label: string;
  level?: SettingLevel;
  /** Legal source for REQUIRED_BY_LAW ("IN pack 2026-09-17"). */
  source?: string | null;
}

export interface LegalLimit {
  target?: string;
  source?: string;
  required_value?: unknown;
  [key: string]: unknown;
}

export interface SettingValueItem {
  key: string;
  value: unknown;
  level: SettingLevel | null;
  badge: InheritanceInfo;
  locked_by: SettingLevel | null;
  legal_limit: LegalLimit[];
  effective_from: string | null;
  effective_to: string | null;
  /** False when this setting can't be set at the selected scope. */
  editable: boolean;
  /** Concurrency token for this key at this scope (0 when nothing is saved here). */
  row_version: number;
  here: {
    row_id: number;
    value: unknown;
    locked: boolean;
    effective_from: string;
    effective_to: string | null;
    source: string | null;
    profile_version: string | null;
    reason: string | null;
  } | null;
  shadowed: { level: string; reason: string }[];
  valid: boolean;
  issues: SettingIssue[];
  pending: {
    change_request_id: number;
    value: unknown;
    locked: boolean;
    effective_from: string;
    requested_by_user_id: number | null;
  } | null;
  derived?: { source: string; description: string };
}

export interface ValuesResponse {
  scope: { scope_type: string; scope_id: number | null; name: string };
  as_of: string;
  registry_version: string;
  profile_version: string | null;
  items: SettingValueItem[];
  issues: SettingIssue[];
}

export interface SettingChangeIn {
  key: string;
  scope_type: EditableScope;
  scope_id: number | null;
  value: unknown;
  effective_from?: string;
  locked?: boolean;
  reason?: string;
  row_version: number;
}

export interface SaveChangeResult {
  key: string;
  scope: { scope_type: string; scope_id: number | null; name: string };
  effective_from: string;
  resolution_grain: "PERIOD" | "DAY";
  status: "ACTIVE" | "PENDING_APPROVAL" | "UNCHANGED";
  row_id: number | null;
  row_version: number;
  change_request_id?: number;
  message: string;
}

export interface SaveResponse {
  changes: SaveChangeResult[];
  warnings: SettingIssue[];
}

export interface ExplainLevel {
  level: SettingLevel;
  allowed: boolean;
  scope_id: number | null;
  value: unknown;
  locked: boolean;
  row_id: number | null;
  source: string | null;
  effective_from: string | null;
  effective_to: string | null;
  reason: string | null;
  set_by: { id: number; name: string; email: string } | string | null;
  set_at: string | null;
  status: string;
  derived?: { source: string; description: string };
  pending?: { row_id: number; value: unknown; effective_from: string };
  country_code?: string | null;
  constraints?: LegalLimit[];
}

export interface ExplainResponse {
  key: string;
  label: string;
  module: string;
  resolution_grain: "PERIOD" | "DAY";
  context: Record<string, unknown>;
  value: unknown;
  level: SettingLevel | null;
  locked_by: SettingLevel | null;
  legal_limit: LegalLimit[];
  valid: boolean;
  issues: SettingIssue[];
  levels: ExplainLevel[];
}

export interface Person {
  id: number;
  name: string;
  email: string;
}

export interface ChangeRequest {
  id: number;
  key: string;
  label: string;
  scope: { scope_type: string; scope_id: number | null };
  value: unknown;
  current_value: unknown;
  locked: boolean;
  effective_from: string;
  reason: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requested_by: Person | null;
  requested_at: string | null;
  decided_by: Person | null;
  decided_at: string | null;
  comment: string | null;
}

/* ------------------------------------------------------------------ policies */

export interface PolicyVersion {
  id: number;
  version: number;
  status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | string;
  effective_from: string;
  effective_to: string | null;
  fields: Record<string, unknown>;
  policy_hash: string | null;
  activated_at: string | null;
  activated_by_user_id: number | null;
}

export interface AssignmentCriteria {
  everyone?: boolean;
  legal_entity_ids?: number[];
  branch_ids?: number[];
  pay_group_ids?: number[];
  department_ids?: number[];
  grade_ids?: number[];
  employment_types?: string[];
  designation_ids?: number[];
  employee_ids?: number[];
}

export interface AssignmentRule {
  id?: number;
  criteria: AssignmentCriteria;
  priority: number;
  effective_from: string | null;
  effective_to: string | null;
  status?: string;
}

export interface PolicyRow {
  id: number;
  type: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "ARCHIVED" | string;
  active_version: PolicyVersion | null;
  latest_version: number | null;
  draft_versions: number[];
  rule_count: number;
  created_at: string | null;
}

export interface PolicyDetail extends PolicyRow {
  versions: PolicyVersion[];
  assignments: AssignmentRule[];
  rule_history?: AssignmentRule[];
}

/* ------------------------------------------------------------------ scope options */

export interface ScopeOption {
  id: number;
  name: string;
  legal_entity_id?: number | null;
}

export interface ScopeOptions {
  /** Whether the company level may be viewed (any configuration reader) and edited (company-wide writers). */
  tenantEditable: boolean;
  entities: ScopeOption[];
  branches: ScopeOption[];
  payGroups: ScopeOption[];
  loading: boolean;
}
