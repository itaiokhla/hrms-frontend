"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A small glossary tooltip (WCAG 1.4.13): shown on hover and keyboard focus, dismissed with Escape,
 * and always linked to its trigger with aria-describedby so screen readers hear it too.
 */
export function Hint({
  content,
  children,
  className,
  focusable = true,
}: {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  /** Make the trigger reachable by Tab (off when the child is already focusable). */
  focusable?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  if (!content) return <>{children}</>;
  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span tabIndex={focusable ? 0 : undefined} aria-describedby={id} className="inline-flex rounded-full">
        {children}
      </span>
      <span
        id={id}
        role="tooltip"
        className={cn(
          "pointer-events-none absolute bottom-full start-0 z-40 mb-2 w-max max-w-[16rem] rounded-xl border border-border bg-surface px-3 py-2 text-xs font-normal normal-case leading-snug tracking-normal text-foreground shadow-lift",
          open ? "block" : "hidden",
        )}
      >
        {content}
      </span>
    </span>
  );
}
