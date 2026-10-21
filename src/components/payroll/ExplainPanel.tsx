"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface ExplainInput {
  label: ReactNode;
  value: ReactNode;
  /** Where the value comes from (attendance day, leave request, overtime entry, task, wage input). */
  source?: ExplainSource;
}

export interface ExplainSource {
  label: ReactNode;
  /** Only links the viewer may open are passed in (EC-UX-08). */
  href?: string;
  kind?: string;
}

export interface ExplainPanelProps {
  /** Plain-language explanation from the calculation trace; always shown first. */
  explanation: ReactNode;
  /** The formula with values substituted ("50,000 × 28 ÷ 30"). */
  formula?: ReactNode;
  inputs?: ExplainInput[];
  /** How the value was rounded ("Rounded half up to 0.01: 46,666.666… → 46,666.67"). */
  rounding?: ReactNode;
  sources?: ExplainSource[];
  defaultExpanded?: boolean;
  title?: ReactNode;
  className?: string;
}

function SourceLink({ source }: { source: ExplainSource }) {
  const kind = source.kind ? <span className="text-xs text-muted-foreground">{source.kind} · </span> : null;
  if (!source.href) {
    return (
      <span>
        {kind}
        {source.label}
      </span>
    );
  }
  return (
    <span>
      {kind}
      <Link href={source.href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
        {source.label}
        <ExternalLink className="h-3 w-3 rtl:-scale-x-100" aria-hidden />
      </Link>
    </span>
  );
}

/**
 * "Why this amount?" (3.8 §5.4): the explanation first; expanding shows the formula with values,
 * the inputs, the rounding step and links to the source records.
 */
export function ExplainPanel({ explanation, formula, inputs, rounding, sources, defaultExpanded, title = "Why this amount?", className }: ExplainPanelProps) {
  const id = useId();
  const [open, setOpen] = useState(!!defaultExpanded);
  const reduceMotion = useReducedMotion();
  const hasDetails = !!formula || !!inputs?.length || !!rounding || !!sources?.length;
  return (
    <section className={cn("rounded-2xl border border-border bg-surface-muted/50 p-4 text-sm", className)} aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <div className="mt-1.5 text-foreground">{explanation}</div>
      {hasDetails && (
        <>
          <button
            type="button"
            className="mt-2 inline-flex min-h-[44px] items-center gap-1 rounded-lg text-sm font-medium text-primary hover:underline sm:min-h-[32px]"
            aria-expanded={open}
            aria-controls={`${id}-details`}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform rtl:-scale-x-100", open && "rotate-90 rtl:-rotate-90")} aria-hidden />
            Formula · Inputs · Sources
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                id={`${id}-details`}
                key="details"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.2 }}
                className="overflow-hidden"
              >
                <div className="space-y-3 pt-2">
                  {formula && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Formula</p>
                      <p className="mt-0.5 rounded-lg bg-surface px-3 py-2 font-mono text-[13px]">
                        <bdi dir="ltr">{formula}</bdi>
                      </p>
                    </div>
                  )}
                  {!!inputs?.length && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Inputs</p>
                      <dl className="mt-1 divide-y divide-border/60 rounded-lg bg-surface">
                        {inputs.map((input, i) => (
                          <div key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-1.5">
                            <dt className="text-muted-foreground">{input.label}</dt>
                            <dd className="text-end tabular-nums">
                              {input.value}
                              {input.source && (
                                <span className="ms-2 text-xs">
                                  <SourceLink source={input.source} />
                                </span>
                              )}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                  {rounding && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Rounding</p>
                      <p className="mt-0.5">{rounding}</p>
                    </div>
                  )}
                  {!!sources?.length && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Sources</p>
                      <ul className="mt-1 space-y-1">
                        {sources.map((s, i) => (
                          <li key={i}>
                            <SourceLink source={s} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </section>
  );
}
