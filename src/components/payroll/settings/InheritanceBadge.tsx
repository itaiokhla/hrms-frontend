"use client";

import { InheritanceBadge, type InheritanceBadgeProps } from "@/components/payroll/InheritanceBadge";
import type { InheritanceKind } from "@/lib/payroll/labels";

import type { InheritanceInfo } from "./types";

/** Maps the API's badge (GET /payroll/settings/values `items[].badge`) to the shared InheritanceBadge. */
export function inheritanceProps(badge: InheritanceInfo | null | undefined): Omit<InheritanceBadgeProps, "className"> | null {
  if (!badge) return null;
  const kinds: Record<InheritanceInfo["code"], InheritanceKind> = {
    REQUIRED_BY_LAW: "LEGAL",
    OVERRIDDEN_HERE: "OVERRIDDEN",
    SET_HERE: "OVERRIDDEN",
    LOCKED: "LOCKED",
    INHERITED: "INHERITED",
  };
  const kind = badge.code === "INHERITED" && badge.level === "PLATFORM" ? "DEFAULT" : kinds[badge.code] ?? "INHERITED";
  return { kind, level: badge.level ?? null, legalSource: badge.source ?? null };
}

/** The inheritance badge of one setting at the selected scope. */
export function SettingBadge({ badge, className }: { badge: InheritanceInfo | null | undefined; className?: string }) {
  const props = inheritanceProps(badge);
  return props ? <InheritanceBadge {...props} className={className} /> : null;
}
