/** Shapes of /api/v1/partner-access (hrms-backend/app/routes/partner_delegation.py). */

export type DelegationStatus = "ACTIVE" | "PENDING" | "EXPIRED" | "REVOKED";
export type NarrowKind = "LEGAL_ENTITY" | "PAY_GROUP";

export interface CatalogueItem {
  code: string;
  module: string;
  label: string;
  description: string;
  sensitivity: "standard" | "confidential" | "restricted";
  /** Targeted scopes the permission supports; empty means it can only be delegated company-wide. */
  narrowable_by: NarrowKind[];
}

export interface EntityOption {
  id: number;
  code: string;
  name: string;
}

export interface PayGroupOption extends EntityOption {
  legal_entity_id: number;
}

export interface Delegation {
  id: number;
  partner_id: number;
  partner_name: string | null;
  status: DelegationStatus;
  permission_codes: string[];
  permissions: { code: string; label: string }[];
  legal_entities: { id: number; name: string | null }[];
  pay_groups: { id: number; name: string | null }[];
  narrowed: boolean;
  read_only: true;
  starts_at: string;
  expires_at: string;
  reason: string;
  granted_by: { id: number; name: string | null };
  granted_at: string;
  revoked_at: string | null;
  revoked_by: { id: number; name: string | null } | null;
  revoke_reason: string | null;
}

export interface Overview {
  partner: { id: number; name: string; status: string } | null;
  max_days: number;
  reason_min: number;
  catalogue: CatalogueItem[];
  targets: { legal_entities: EntityOption[]; pay_groups: PayGroupOption[] };
  items: Delegation[];
}

export interface ActivityItem {
  id: number;
  at: string;
  action: string;
  description: string;
  operator_email: string | null;
  method: string | null;
  path: string | null;
}

export interface GrantInput {
  permission_codes: string[];
  legal_entity_ids: number[];
  pay_group_ids: number[];
  expires_at: string;
  reason: string;
}
