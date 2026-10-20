import type { Brand } from "@/lib/brand";

export type AssetKind = "logo_light" | "logo_dark" | "mark" | "email_logo" | "document_logo" | "login_image";

export interface BrandAsset {
  id: number;
  kind: AssetKind;
  sha256: string;
  ext: string;
  width: number;
  height: number;
  url?: string;
  derivatives?: Record<string, { sha256: string; ext: string; width: number; height: number }>;
}

export type FieldValue = string | boolean | number | null | BrandAsset;

export interface ProfileSnapshot {
  id: number;
  version: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  fields: Record<string, FieldValue>;
  row_version: number;
  published_at: string | null;
  published_by: string | null;
  contrast_report: ContrastCheck[] | null;
  change_summary: Change[] | null;
  restored_from_version: number | null;
  locked_fields?: string[];
}

export interface ContrastCheck {
  check: string;
  ratio: number;
  required: number;
  pass: boolean;
  adjusted: boolean;
}

export interface Change {
  field: string;
  label: string;
  from: unknown;
  to: unknown;
}

export interface Source {
  level: "PLATFORM" | "PARTNER" | "TENANT";
  reason: "SET" | "DEFAULT" | "LOCKED" | "NOT_ENTITLED" | "COMPANY_NAME";
  by?: string;
  entitlement?: string;
}

export interface Entitlement {
  key: string;
  label: string;
  enabled: boolean;
  available_on: string | null;
  decided_by_partner: boolean;
}

export type AdminEffective = Brand & {
  contrast_report: ContrastCheck[];
  warnings: string[];
  exact: { primary: string; accent: string | null };
  values: Record<string, FieldValue>;
  legal_footer: string | null;
  support_email: string | null;
  support_phone: string | null;
  email_sender_name: string | null;
  document_logo: string | null;
};

export interface BrandingAdmin {
  draft: ProfileSnapshot | null;
  published: ProfileSnapshot | null;
  effective: AdminEffective;
  preview: AdminEffective;
  sources: Record<string, Source>;
  preview_sources: Record<string, Source>;
  locked_fields: string[];
  partner: { id: number; name: string; status: string } | null;
  plan: string;
  entitlements: Entitlement[];
  field_entitlements: Record<string, string>;
  unpublished_changes: number;
  brand_disabled: boolean;
  inherited: Record<string, FieldValue>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  changes: Change[];
  contrast_report: ContrastCheck[];
  row_version?: number;
}

export interface VersionRow {
  id: number;
  version: number;
  status: "PUBLISHED" | "ARCHIVED";
  published_at: string | null;
  published_by: string | null;
  changes: Change[];
  restored_from_version: number | null;
  primary_color: string | null;
}

export interface DomainRow {
  id: number;
  hostname: string;
  unicode_hostname: string;
  kind: "PLATFORM_SUBDOMAIN" | "CUSTOM";
  status: "PENDING_DNS" | "VERIFYING" | "ACTIVE" | "DNS_BROKEN" | "DISABLED" | "FAILED" | "REMOVED";
  is_primary: boolean;
  redirect_to_primary: boolean;
  enforce_custom_domain: boolean;
  verified_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  dns_broken_since: string | null;
  tls_status: "NONE" | "PENDING" | "ISSUED" | "FAILED" | "RENEWING";
  tls_mode: "PROBE" | "SIMULATED";
  tls_expires_at: string | null;
  records: { type: string; name: string; value: string; purpose: string }[];
  history: { at: string; from: string | null; to: string; note?: string }[];
  apex: boolean;
}

export const FIELD_LABELS: Record<string, string> = {
  display_name: "Company name",
  product_name: "Product name",
  short_name: "Short name (app icon label)",
  tagline: "Tagline",
  legal_footer: "Legal footer",
  email_sender_name: "Email sender name",
  support_email: "Support email",
  support_phone: "Support phone",
  support_url: "Support page",
  help_center_url: "Help center",
  terms_url: "Terms of service",
  privacy_url: "Privacy policy",
  status_page_url: "Status page",
  primary_color: "Primary colour",
  accent_color: "Accent colour",
  sidebar_style: "Sidebar style",
  radius: "Corner style",
  font: "Font",
  default_locale: "Default language",
  show_powered_by: "Show 'Powered by'",
  logo_light: "Logo (light backgrounds)",
  logo_dark: "Logo (dark backgrounds)",
  mark: "Square mark",
  email_logo: "Email logo",
  document_logo: "Document logo",
  login_image: "Login image",
};

export const PLAN_LABELS: Record<string, string> = {
  trial: "Trial",
  standard: "Standard",
  professional: "Professional",
  enterprise: "Enterprise",
};

export const LOCALES: { value: string; label: string }[] = [
  { value: "en", label: "English" },
  { value: "en-IN", label: "English (India)" },
  { value: "en-US", label: "English (United States)" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "en-AE", label: "English (UAE)" },
  { value: "ar", label: "العربية (Arabic, right-to-left)" },
  { value: "ar-AE", label: "العربية – الإمارات (Arabic, UAE)" },
  { value: "hi", label: "हिन्दी (Hindi)" },
  { value: "hi-IN", label: "हिन्दी – भारत (Hindi, India)" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "he", label: "עברית (Hebrew, right-to-left)" },
  { value: "ur", label: "اردو (Urdu, right-to-left)" },
];
