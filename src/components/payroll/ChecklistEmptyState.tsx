"use client";

import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Circle, ListChecks } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";

import { MotionSafe } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

export interface ChecklistStep {
  id: string;
  label: string;
  description?: ReactNode;
  /** Deep link to where the step is done. */
  href?: string;
  done?: boolean;
  /** Why the step can't be done yet (shown instead of the link). */
  blockedReason?: string;
}

/**
 * Onboarding steps with deep links (3.8 §5.1 empty states): "Create a salary structure → Assign
 * salaries → Add bank accounts → Create your first pay run". The first open step is the next action.
 */
export function ChecklistEmptyState({
  title,
  description,
  steps,
  icon,
  className,
}: {
  title: string;
  description?: ReactNode;
  steps: ChecklistStep[];
  icon?: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done && !s.blockedReason);
  return (
    <MotionSafe>
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={cn("mx-auto max-w-xl px-6 py-10", className)}
        aria-labelledby={titleId}
      >
        <div className="mb-5 flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary [&>svg]:h-6 [&>svg]:w-6" aria-hidden>
            {icon ?? <ListChecks />}
          </div>
          <div>
            <h3 id={titleId} className="text-base font-semibold">
              {title}
            </h3>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              {done} of {steps.length} done
            </p>
          </div>
        </div>
        <ol className="space-y-2">
          {steps.map((step, i) => {
            const isNext = step === next;
            return (
              <li
                key={step.id}
                className={cn(
                  "flex items-start gap-3 rounded-2xl border px-4 py-3",
                  isNext ? "border-primary/40 bg-primary-soft/40" : "border-border bg-surface",
                )}
                aria-current={isNext ? "step" : undefined}
              >
                {step.done ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
                ) : (
                  <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium", step.done && "text-muted-foreground line-through decoration-muted-foreground/40")}>
                    <span className="sr-only">{`Step ${i + 1}: `}</span>
                    {step.label}
                    <span className="sr-only">{step.done ? " (done)" : isNext ? " (next)" : ""}</span>
                  </p>
                  {step.description && <p className="mt-0.5 text-sm text-muted-foreground">{step.description}</p>}
                  {!step.done && step.blockedReason && <p className="mt-1 text-xs text-muted-foreground">{step.blockedReason}</p>}
                </div>
                {!step.done && !step.blockedReason && step.href && (
                  <Link
                    href={step.href}
                    aria-label={`${isNext ? "Start" : "Open"}: ${step.label}`}
                    className={cn(
                      "inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-xl px-3 text-sm font-medium sm:min-h-[36px]",
                      isNext ? "bg-primary text-primary-foreground" : "text-primary hover:bg-primary-soft",
                    )}
                  >
                    {isNext ? "Start" : "Open"}
                    <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </motion.section>
    </MotionSafe>
  );
}
