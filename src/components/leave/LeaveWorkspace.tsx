"use client";

import { motion } from "framer-motion";
import { CalendarPlus, History } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useId, type ReactNode } from "react";

import { RequireAccess, useCan } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { MotionSafe } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { accessHas } from "@/lib/leave/api";
import { LEAVE_SECTIONS, canApplyLeave, canUseLeave } from "@/lib/leave/routes";
import type { Me } from "@/lib/types";

import { LeaveAccessProvider, useLeaveAccess } from "./LeaveAccessContext";
import { LeaveOverlaysProvider, useLeaveOverlays } from "./LeaveOverlays";

/** Section strip of the leave pages (same gates as the sidebar's Leave group). */
export function LeaveNav() {
  const pathname = usePathname();
  const { me } = useCan();
  const id = useId();
  if (!me) return null;
  const items = LEAVE_SECTIONS.filter((s) => s.visible(me));
  return (
    <MotionSafe>
      <nav
        aria-label="Leave sections"
        className="scrollbar-thin mb-5 flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1 shadow-sm sm:inline-flex"
        data-testid="leave-nav"
      >
        {items.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active && (
                <motion.span layoutId={`leave-nav-${id}`} className="absolute inset-0 rounded-xl bg-primary-soft" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
              )}
              <Icon className="relative h-4 w-4" aria-hidden />
              <span className="relative">{item.label}</span>
            </Link>
          );
        })}
        <Link
          href="/leaves"
          className="flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <History className="h-4 w-4" aria-hidden /> Classic view
        </Link>
      </nav>
    </MotionSafe>
  );
}

/** "Apply leave": opens the `?modal=apply-leave` dialog of the current page. */
export function ApplyLeaveButton({
  variant = "primary",
  label = "Apply leave",
  type,
  testId = "apply-leave-open",
}: {
  variant?: "primary" | "secondary" | "subtle";
  label?: string;
  type?: string;
  testId?: string;
}) {
  const { openApply } = useLeaveOverlays();
  return (
    <Button variant={variant} onClick={() => openApply(type ? { type } : {})} data-testid={testId}>
      <CalendarPlus className="h-4 w-4" aria-hidden /> {label}
    </Button>
  );
}

/** Apply for oneself (`leave:apply` + an employee profile) or for others (`leave:apply_on_behalf`, setting on). */
function HeaderApply({ me }: { me: Me | null }) {
  const { access } = useLeaveAccess();
  const onBehalf = !!access?.on_behalf_enabled && accessHas(access, "leave:apply_on_behalf");
  if (!me || !(canApplyLeave(me) || onBehalf)) return null;
  return <ApplyLeaveButton />;
}

/**
 * Shell of every leave v2 page: access guard, the `GET /leaves/access` facts, header with "Apply leave", the section
 * strip, and the two deep-linkable overlays every page hosts — `?modal=apply-leave` and `?modal=leave&id=`.
 */
export function LeaveWorkspace({
  title,
  description,
  actions,
  check = canUseLeave,
  children,
  applyModal = true,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  check?: (me: Me) => boolean;
  children: ReactNode;
  /** The full-page apply form hosts no modal twin of itself. */
  applyModal?: boolean;
}) {
  const { me } = useCan();
  return (
    <RequireAccess check={check}>
      <Suspense>
        <LeaveAccessProvider>
          <LeaveOverlaysProvider apply={applyModal}>
            <div data-testid="leave-workspace">
              <PageHeader
                eyebrow="Leave"
                title={title}
                description={description}
                actions={
                  <>
                    {actions}
                    {applyModal && <HeaderApply me={me} />}
                  </>
                }
              />
              <LeaveNav />
              {children}
            </div>
          </LeaveOverlaysProvider>
        </LeaveAccessProvider>
      </Suspense>
    </RequireAccess>
  );
}
