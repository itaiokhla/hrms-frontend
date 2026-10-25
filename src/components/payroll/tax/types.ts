/** Wire types of the employee tax profile API (hrms-backend/app/payroll/routes/tax_profiles.py). */

export type TaxFieldType = "ENUM" | "MONEY" | "DECIMAL" | "INTEGER" | "BOOL" | "DATE" | "TEXT" | "IDENTIFIER";

export type TaxProfileStatus = "SUBMITTED" | "APPROVED" | "REJECTED" | "WITHDRAWN";

/** One declaration field the country pack asks for (pack.tax_profile_schema()). Nothing here is invented by the app. */
export interface TaxField {
  code: string;
  label: string;
  type: TaxFieldType;
  required: boolean;
  help: string;
  group: string;
  /** Honesty label of the pack, for example "FIXTURE — not law: illustrative field…". */
  note: string;
  proof_required: boolean;
  choices: { value: string; label: string }[];
  minimum: string | null;
  maximum: string | null;
  min_length: number;
  max_length: number | null;
  sensitive: boolean;
}

export interface TaxPack {
  code: string;
  version: string;
  name: string;
  country: string;
  currency: string;
  status: string;
  is_fixture: boolean;
  usage: string;
  /** "FIXTURE — not law: pack … is test data." or "Compliance not verified: …". */
  label: string;
}

export interface TaxProof {
  id: number;
  field_code: string;
  file_name: string;
  mime: string;
  bytes: number;
  sha256: string;
  uploaded_at: string | null;
}

export interface TaxVersion {
  id: number;
  version_no: number;
  status: TaxProfileStatus;
  country: string;
  pack_code: string;
  effective_from: string;
  /** Flat code → value for every non-identifier field; money and decimals are strings. */
  values: Record<string, string | number | boolean>;
  /** Identifier fields, masked: the full value never leaves the server. */
  identifiers: Record<string, string>;
  proofs: TaxProof[];
  proofs_missing: string[];
  schema_current: boolean;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  withdrawn_at: string | null;
  row_version: number;
}

export interface MyTaxProfile {
  employee_id: number;
  as_of: string;
  can_edit: boolean;
  legal_entity: { id: number; name: string; country_code: string } | null;
  country: string | null;
  available: boolean;
  /** NO_LEGAL_ENTITY | NO_PACK_FIELDS when `available` is false. */
  reason: string | null;
  message: string | null;
  pack: TaxPack | null;
  currency: string | null;
  schema: TaxField[];
  schema_hash: string | null;
  current: TaxVersion | null;
  pending: TaxVersion | null;
  latest: TaxVersion | null;
  versions: TaxVersion[];
}

export interface TaxSubmitResult {
  id: number;
  version_no: number;
  status: TaxProfileStatus;
  row_version: number;
  effective_from: string;
}

export interface StaffTaxVersion extends TaxVersion {
  employee_id: number;
  legal_entity_id: number;
  submitted_by_user_id: number;
  reviewed_by_user_id: number | null;
  employee: { id: number; name: string; employee_code: string } | null;
  schema: TaxField[];
  /** The pack's currency, for money values. */
  currency: string | null;
  is_own: boolean;
}

export interface StaffTaxList {
  total: number;
  counts: Partial<Record<TaxProfileStatus, number>>;
  items: StaffTaxVersion[];
}

export type TaxFormValues = Record<string, string>;
