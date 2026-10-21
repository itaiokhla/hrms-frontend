"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Check } from "lucide-react";

import { MotionSafe } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { RUN_STAGES, isSideState, isTerminalState, runStage, statusEntry } from "@/lib/payroll/labels";

import { StatusChip } from "./StatusChip";

/**
 * Run stages ① Prepare … ⑥ Close with animated progress and the exact state chip (3.8 §5.3, §7).
 * Side states (CANCELLED, REOPENED_FOR_CORRECTION) have no stage: the stages are muted and the
 * chip says what happened. With reduced motion the progress bar jumps instead of growing.
 */
export function Stepper({ state, className, compact }: { state: string; className?: string; compact?: boolean }) {
  const current = runStage(state);
  const side = isSideState("run", state);
  const tone = statusEntry("run", state).tone;
  const total = RUN_STAGES.length;
  const progress = current ? (current - 1) / (total - 1) : 0;
  // A run in its last stage that is finished (reconciled or closed) shows every stage done.
  const finished = current === total && (tone === "success" || isTerminalState("run", state));
  const done = (stage: number) => current !== null && (stage < current || (stage === current && finished));
  // The track runs from the centre of the first stage to the centre of the last.
  const track = { insetInlineStart: `${50 / total}%`, width: `${((total - 1) / total) * 100}%` };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip vocabulary="run" code={state} showCode />
        {side && <span className="text-xs text-muted-foreground">{statusEntry("run", state).glossary}</span>}
      </div>
      <div className="relative">
        <div className="absolute top-4 h-0.5 rounded-full bg-border" style={track} aria-hidden />
        <MotionSafe>
          <motion.div
            aria-hidden
            className={cn("absolute top-4 h-0.5 origin-left rounded-full rtl:origin-right", side ? "bg-muted-foreground/40" : "bg-primary")}
            style={track}
            initial={false}
            animate={{ scaleX: progress }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          />
        </MotionSafe>
        <ol className="relative flex justify-between gap-1" aria-label="Pay run stages">
          {RUN_STAGES.map(({ stage, label }) => {
            const isDone = done(stage);
            const isCurrent = !side && stage === current && !isDone;
            const problem = isCurrent && (tone === "danger" || tone === "warning");
            return (
              <li key={stage} className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center" aria-current={isCurrent ? "step" : undefined}>
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors",
                    isDone && "border-primary bg-primary text-primary-foreground",
                    isCurrent && !problem && "border-primary bg-surface text-foreground ring-4 ring-primary/15",
                    problem && tone === "danger" && "border-danger bg-danger-soft text-danger",
                    problem && tone === "warning" && "border-warning bg-warning-soft text-warning",
                    !isDone && !isCurrent && "border-border bg-surface text-muted-foreground",
                    side && "opacity-60",
                  )}
                  aria-hidden
                >
                  {isDone ? <Check className="h-4 w-4" /> : problem ? <AlertTriangle className="h-4 w-4" /> : stage}
                </span>
                <span className={cn("truncate text-xs", isCurrent ? "font-semibold text-foreground" : "text-muted-foreground", compact && "sr-only sm:not-sr-only")}>
                  {label}
                </span>
                <span className="sr-only">
                  {`Stage ${stage} of ${total}, `}
                  {isDone ? "completed" : isCurrent ? (problem ? "current, needs attention" : "current") : "not started"}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
