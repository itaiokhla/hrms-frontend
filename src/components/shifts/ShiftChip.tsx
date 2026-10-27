import { cn } from "@/lib/cn";

import { colorOf } from "./shiftModel";

/** Colour chip + shift code (§2.3: the colour token is never the only signal, the code text is always shown). */
export function ShiftChip({ code, color, className }: { code: string; color?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-sm font-semibold", className)}>
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(color) }} />
      {code}
    </span>
  );
}
