"use client";

import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useId, useMemo, type ReactNode } from "react";

import { Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { activeSettingsHref, settingsNavFor } from "@/lib/settings-nav";
import type { Me } from "@/lib/types";

/**
 * The Settings shell (3.8 §3.1): a left rail of permitted sections on large screens and a section
 * picker at the top on small ones, around the current settings page.
 */
export function SettingsShell({ me, children }: { me: Me | null; children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const id = useId();
  const groups = useMemo(() => (me ? settingsNavFor(me) : []), [me]);
  const active = activeSettingsHref(groups, pathname);
  const items = groups.flatMap((g) => g.items);
  // With nothing to navigate between (or one entry only), the page renders as before.
  if (items.length < 2) return <>{children}</>;

  return (
    <div className="lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-8">
      <div className="mb-5 lg:hidden">
        <label htmlFor={`${id}-picker`} className="mb-1.5 block text-[13px] font-medium">
          Settings section
        </label>
        <Select id={`${id}-picker`} className="h-11" value={active ?? ""} onChange={(e) => e.target.value && router.push(e.target.value)}>
          {!active && <option value="">Choose a section</option>}
          {groups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.items.map((item) => (
                <option key={item.href} value={item.href}>
                  {item.label}
                  {item.external ? " ↗" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>
      <nav aria-label="Settings" className="hidden lg:block">
        <div className="scrollbar-thin sticky top-24 max-h-[calc(100vh-7rem)] space-y-5 overflow-y-auto pb-6 pe-1">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{group.label}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const current = item.href === active;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={current ? "page" : undefined}
                        className={cn(
                          "relative flex min-h-[36px] items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-sm transition-colors",
                          current ? "font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {current && (
                          <motion.span
                            layoutId="settings-rail-active"
                            className="absolute inset-0 rounded-xl bg-primary-soft"
                            transition={{ type: "spring", stiffness: 420, damping: 36 }}
                          />
                        )}
                        <span className="relative truncate">{item.label}</span>
                        {item.external && (
                          <>
                            <ArrowUpRight className="relative h-3.5 w-3.5 shrink-0 rtl:-scale-x-100" aria-hidden />
                            <span className="sr-only"> (opens another page)</span>
                          </>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
