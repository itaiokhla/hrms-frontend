/**
 * Leave colour tokens (backend LEAVE_COLOR_TOKENS: `leave-1` … `leave-12` and `leave-neutral`). The colours are CSS
 * variables in `src/app/globals.css` (`--leave-N`, light and dark), shared by the employee and admin leave screens.
 * `leave-neutral` is what the API sends for masked (protected / "Away") leave: never map it to a type colour.
 */

export const LEAVE_COLOR_TOKENS = [...Array.from({ length: 12 }, (_, i) => `leave-${i + 1}`), "leave-neutral"] as const;

const KNOWN = new Set<string>(LEAVE_COLOR_TOKENS);

/** The token itself when known, else `leave-neutral` for masked/unknown leave, else `leave-1`. */
export function leaveToken(token: string | null | undefined, fallback = "leave-1"): string {
  return token && KNOWN.has(token) ? token : fallback;
}

/** Solid colour, e.g. for a dot or a bar: `hsl(var(--leave-3))`. */
export function leaveColor(token: string | null | undefined, alpha?: number): string {
  const name = leaveToken(token);
  return alpha === undefined ? `hsl(var(--${name}))` : `hsl(var(--${name}) / ${alpha})`;
}

/**
 * Tinted background and border for chips and calendar bars; the text stays `text-foreground` (contrast holds for every
 * token in both themes) and a solid dot or edge carries the colour. Pending leave is lighter with a dashed border.
 */
export function leaveChipStyle(token: string | null | undefined, { pending = false } = {}) {
  return {
    backgroundColor: leaveColor(token, pending ? 0.07 : 0.16),
    borderColor: leaveColor(token, pending ? 0.6 : 0.4),
    borderStyle: pending ? "dashed" : "solid",
  } as const;
}
