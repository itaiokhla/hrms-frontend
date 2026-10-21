"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Circle, CircleDot, Info, XCircle } from "lucide-react";

import { MotionSafe } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { statusEntry, type StatusTone, type VocabularyName } from "@/lib/payroll/labels";

import { Hint } from "./Hint";

/* Tone classes use the AA-checked status tokens (globals.css); each tone also has its own icon
   shape, so the state never depends on colour alone. */
const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  // The primary colour is brandable, so its contrast is unknown: foreground text keeps AA.
  primary: "bg-primary-soft text-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

const TONE_ICON: Record<StatusTone, typeof Circle> = {
  neutral: Circle,
  primary: CircleDot,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
};

export interface StatusChipProps {
  vocabulary: VocabularyName;
  code: string | null | undefined;
  /** Also show the exact state code ("REVIEW_REQUIRED") beside the label, e.g. in a run header. */
  showCode?: boolean;
  /** Override the glossary text (default: the vocabulary's). */
  glossary?: string;
  className?: string;
}

/**
 * One chip for every status vocabulary (3.8 §7): tone + label + glossary tooltip, from the
 * vocabularies the backend generates. A change of state cross-fades (no movement), so chips
 * flipping during polling stay calm (3.8 §11).
 */
export function StatusChip({ vocabulary, code, showCode, glossary, className }: StatusChipProps) {
  const entry = statusEntry(vocabulary, code);
  const Icon = TONE_ICON[entry.tone];
  const hint = glossary ?? entry.glossary;
  const chip = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASS[entry.tone],
        className,
      )}
      data-tone={entry.tone}
      data-status={entry.code}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <MotionSafe>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={entry.code}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {entry.label}
          </motion.span>
        </AnimatePresence>
      </MotionSafe>
      {showCode && entry.code && (
        <bdi dir="ltr" className="font-mono text-[10px] uppercase tracking-wide opacity-80">
          {entry.code}
        </bdi>
      )}
    </span>
  );
  return hint ? <Hint content={hint}>{chip}</Hint> : chip;
}
