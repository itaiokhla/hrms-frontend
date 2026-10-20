/**
 * Brand payload served by GET /api/v1/public/brand and how it becomes CSS.
 *
 * The server derives accessible tokens; this module only maps them onto the CSS
 * variables defined in globals.css. Values are validated again here so that nothing
 * but "H S% L%" triples for known tokens can ever reach a <style> element (white
 * labelling never allows custom CSS).
 */

export type FontChoice = "INTER" | "POPPINS" | "ROBOTO" | "NOTO" | "SYSTEM";
export type SidebarStyle = "DARK" | "LIGHT" | "BRAND";
export type RadiusChoice = "SHARP" | "ROUNDED" | "PILL";

export interface BrandTokens {
  light: Record<string, string>;
  dark: Record<string, string>;
}

export interface Brand {
  version: string;
  host_kind: "PLATFORM" | "TENANT" | "UNKNOWN";
  host_status: "ACTIVE" | "SUSPENDED" | "UNKNOWN";
  product_name: string;
  display_name: string;
  short_name: string;
  tagline: string | null;
  logos: { light: string | null; dark: string | null; mark: string | null; email: string | null; login_image: string | null };
  icons: Partial<Record<"favicon-16" | "favicon-32" | "favicon-48" | "favicon-ico" | "apple-touch-180" | "pwa-192" | "pwa-512" | "maskable-512", string | null>>;
  tokens: BrandTokens | null;
  theme_color: string;
  font: FontChoice;
  sidebar_style: SidebarStyle;
  radius: RadiusChoice;
  support_url: string | null;
  help_center_url: string | null;
  terms_url: string | null;
  privacy_url: string | null;
  status_page_url: string | null;
  show_powered_by: boolean;
  powered_by_label: string;
  default_locale: string;
  dir: "ltr" | "rtl";
  login_scope?: "ANY" | "TENANT" | "NONE";
  is_platform_host?: boolean;
  primary_url?: string | null;
  redirect_to_primary?: boolean;
  preview?: boolean;
}

const TOKEN_NAMES = new Set([
  "primary", "primary-foreground", "primary-soft", "ring", "accent", "accent-foreground",
  "sidebar", "sidebar-foreground", "sidebar-muted", "sidebar-active", "sidebar-active-foreground", "shadow",
]);
const TOKEN_VALUE = /^\d{1,3} \d{1,3}% \d{1,3}%$/;

function declarations(values: Record<string, string> | undefined): string {
  if (!values) return "";
  return Object.entries(values)
    .filter(([name, value]) => TOKEN_NAMES.has(name) && TOKEN_VALUE.test(value))
    .map(([name, value]) => `--${name}:${value};`)
    .join("");
}

const RADII: Record<RadiusChoice, string> = {
  SHARP: "--radius-lg:0.25rem;--radius-xl:0.375rem;--radius-2xl:0.5rem;--radius-3xl:0.625rem;",
  ROUNDED: "",
  PILL: "--radius-lg:0.75rem;--radius-xl:1.125rem;--radius-2xl:1.5rem;--radius-3xl:2rem;",
};

/** CSS for the brand: token overrides for light and dark, plus the corner style. Empty for the platform defaults. */
export function brandCss(brand: Pick<Brand, "tokens" | "radius"> | null | undefined): string {
  if (!brand) return "";
  const radius = RADII[brand.radius] ?? "";
  const light = declarations(brand.tokens?.light) + radius;
  const dark = declarations(brand.tokens?.dark);
  return `${light ? `:root{${light}}` : ""}${dark ? `.dark{${dark}}` : ""}`;
}

/** Same declarations as inline style for an isolated preview container. */
export function previewStyle(tokens: BrandTokens | null, mode: "light" | "dark"): Record<string, string> {
  const values = tokens?.[mode] ?? {};
  const style: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (TOKEN_NAMES.has(name) && TOKEN_VALUE.test(value)) style[`--${name}`] = value;
  }
  return style;
}

export function isSafeAssetUrl(url: string | null | undefined): url is string {
  return !!url && /^\/api\/v1\/public\/brand-assets\/[0-9a-f]{64}\.(png|jpg|webp|ico)$/.test(url);
}

export function isSafeExternalUrl(url: string | null | undefined): url is string {
  return !!url && /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[^\s<>"']*)?$/.test(url);
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
}

/** Platform defaults used when the brand cannot be loaded. Never another tenant's brand. */
export const FALLBACK_BRAND: Brand = {
  version: "fallback",
  host_kind: "PLATFORM",
  host_status: "ACTIVE",
  product_name: "Intertech HRMS",
  display_name: "Intertech HRMS",
  short_name: "HRMS",
  tagline: "People, attendance, leave and payroll in one place.",
  logos: { light: null, dark: null, mark: null, email: null, login_image: null },
  icons: {},
  tokens: null,
  theme_color: "#4F46E5",
  font: "INTER",
  sidebar_style: "DARK",
  radius: "ROUNDED",
  support_url: null,
  help_center_url: null,
  terms_url: null,
  privacy_url: null,
  status_page_url: null,
  show_powered_by: true,
  powered_by_label: "Powered by Intertech HRMS",
  default_locale: "en",
  dir: "ltr",
  login_scope: "ANY",
  is_platform_host: true,
};
