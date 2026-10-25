"use client";

import { Gavel, Scale } from "lucide-react";
import Link from "next/link";

import { useCan } from "@/components/access/Can";
import { canBeyondSelf } from "@/lib/access";
import { cn } from "@/lib/cn";
import { P } from "@/lib/permissions.generated";

/** Who may open the legal-holds page: managers of holds, and auditors (read only). */
export const HOLD_READ_CODES = [P.PAYROLL_LEGAL_HOLD_MANAGE, P.PAYROLL_AUDIT_READ];

/**
 * The tabs of the Compliance area: statutory filings and legal holds & retention. The legal-holds tab is
 * shown only to people who can open it (the API enforces access independently). This is the only entry to
 * the page; the main navigation is unchanged.
 */
export function ComplianceNav({ active }: { active: "statutory" | "holds" }) {
  const { me } = useCan();
  const holds = HOLD_READ_CODES.some((code) => canBeyondSelf(me, code));
  if (!holds) return null;
  const tabs = [
    { key: "statutory", href: "/payroll/compliance", label: "Statutory", Icon: Scale },
    { key: "holds", href: "/payroll/legal-holds", label: "Legal holds & retention", Icon: Gavel },
  ] as const;
  return (
    <nav aria-label="Compliance sections" className="flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1 shadow-sm sm:inline-flex">
      {tabs.map(({ key, href, label, Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={active === key ? "page" : undefined}
          className={cn(
            "inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors",
            active === key ? "bg-primary-soft text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}
