import { can, canAny } from "./access";
import { P } from "./permissions.generated";
import { SETTING_SECTIONS } from "./settings.generated";
import type { Me } from "./types";

/**
 * The Settings left rail (3.8 §3.1), built like the main menu: every entry carries its own
 * permission check and empty groups disappear (contract §11.1: no blank menus). Entries outside
 * /settings (Roles & access, Leave policy, Holidays) open those pages.
 */
export interface SettingsNavItem {
  label: string;
  href: string;
  visible: (me: Me) => boolean;
  /** Opens a page outside the settings shell. */
  external?: boolean;
  /** Extra paths that mark this entry active (e.g. the section's sub-pages). */
  match?: string[];
}

export interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

const payrollRead = (me: Me) => can(me, P.PAYROLL_CONFIGURATION_READ);

export const PAYROLL_SETTINGS_BASE = "/settings/payroll";

/** Pseudo-section of the Security group: settings changes waiting for approval. */
export const CHANGE_REQUESTS_SLUG = "change-requests";

export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    label: "Company",
    items: [
      // Today's /settings page: profile, attendance policies, attendance & location, departments & shifts.
      { label: "Profile & policies", href: "/settings", visible: (me) => can(me, P.SETTINGS_MANAGE) },
      {
        label: "Branding & domains",
        href: "/settings/branding",
        visible: (me) => canAny(me, [P.BRANDING_MANAGE, P.DOMAIN_MANAGE, P.EMAIL_TEMPLATE_MANAGE]),
      },
    ],
  },
  {
    label: "Organization",
    items: [
      {
        label: "Legal entities & branches",
        href: "/settings/organization",
        visible: (me) => canAny(me, [P.ORG_READ, P.ORG_MANAGE_ENTITIES, P.ORG_MANAGE_BRANCHES]),
      },
    ],
  },
  {
    label: "People policies",
    items: [
      { label: "Leave types & approvals", href: "/leaves?tab=policy", external: true, visible: (me) => can(me, P.LEAVE_MANAGE_POLICY) },
      { label: "Holiday calendars", href: "/holidays", external: true, visible: (me) => can(me, P.HOLIDAY_MANAGE) },
    ],
  },
  {
    label: "Payroll",
    items: SETTING_SECTIONS.map((section) => ({
      label: section.title,
      href: `${PAYROLL_SETTINGS_BASE}/${section.slug}`,
      visible: payrollRead,
    })),
  },
  {
    label: "Security",
    items: [
      { label: "Roles & access", href: "/roles", external: true, visible: (me) => can(me, P.ROLE_READ) },
      { label: "Partner access", href: "/settings/partner-access", visible: (me) => can(me, P.SETTINGS_PARTNER_ACCESS_MANAGE) },
      {
        label: "Settings change requests",
        href: `${PAYROLL_SETTINGS_BASE}/${CHANGE_REQUESTS_SLUG}`,
        visible: (me) => canAny(me, [P.PAYROLL_CONFIGURATION_READ, P.SETTINGS_APPROVE_CHANGES]),
      },
    ],
  },
];

export function settingsNavFor(me: Me): SettingsNavGroup[] {
  return SETTINGS_NAV.map((group) => ({ ...group, items: group.items.filter((item) => item.visible(me)) })).filter(
    (group) => group.items.length > 0,
  );
}

/** The rail entry for a path: the longest in-shell href that is the path or a parent of it. */
export function activeSettingsHref(groups: SettingsNavGroup[], pathname: string): string | undefined {
  return groups
    .flatMap((g) => g.items)
    .filter((i) => !i.external)
    .flatMap((i) => [i.href, ...(i.match ?? [])].map((path) => ({ href: i.href, path })))
    .filter(({ path }) => pathname === path || pathname.startsWith(`${path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]?.href;
}

/** Whether a payroll settings slug is valid (a generated section or the change-requests page). */
export function isPayrollSettingsSlug(slug: string): boolean {
  return slug === CHANGE_REQUESTS_SLUG || SETTING_SECTIONS.some((s) => s.slug === slug);
}
