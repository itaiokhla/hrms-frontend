"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatMoney, isDecimalString, isNegative, type FormatMoneyOptions, type Money } from "@/lib/money";

import { useHideAmounts } from "./useHideAmounts";

/* ------------------------------------------------------------------ locale */

function subscribeLang(listener: () => void) {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return () => {};
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  return () => observer.disconnect();
}

/** The brand's locale from `<html lang>` (BrandProvider keeps it current); "en" while server rendering. */
export function useMoneyLocale(): string {
  return useSyncExternalStore(
    subscribeLang,
    () => document.documentElement.lang || "en",
    () => "en",
  );
}

/* ------------------------------------------------------------------ MoneyText */

export interface MoneyTextProps extends Omit<FormatMoneyOptions, "locale"> {
  /** A money DTO; or pass `amount` + `currency`. */
  money?: Money | null;
  amount?: string | null;
  currency?: string | null;
  locale?: string;
  /** Visible cue after a negative amount (colour is never the only signal). `false` for none. */
  negativeCue?: string | false;
  /** Obey "Hide amounts" (default true). */
  hideable?: boolean;
  /** Bold, larger figures for totals. */
  emphasis?: boolean;
  className?: string;
}

const MASK = /[0-9٠-٩۰-۹]/g;

/**
 * An exact amount (3.8 §7, §9): the currency's ISO digits, locale grouping, tabular figures,
 * left-to-right inside RTL text, the danger tone plus a text cue when negative, and masked under
 * "Hide amounts" (hover or focus reveals it). Never animated.
 */
export function MoneyText({
  money,
  amount,
  currency,
  locale,
  negativeCue = "(recovery)",
  hideable = true,
  emphasis,
  className,
  ...format
}: MoneyTextProps) {
  const value = money?.amount ?? amount ?? null;
  const code = money?.currency ?? currency ?? "";
  const fallbackLocale = useMoneyLocale();
  const { hidden } = useHideAmounts();
  const [revealed, setRevealed] = useState(false);

  if (value === null || value === undefined || value === "") {
    return (
      <span className={cn("tabular-nums text-muted-foreground", className)} aria-label="No amount">
        —
      </span>
    );
  }
  const text = formatMoney(value, code, { ...format, locale: locale ?? fallbackLocale });
  const negative = isDecimalString(value) && isNegative(value);
  const masked = hideable && hidden && !revealed;

  const figures = (
    <bdi dir="ltr" className="whitespace-nowrap [unicode-bidi:isolate]">
      {masked ? text.replace(MASK, "•") : text}
    </bdi>
  );

  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 tabular-nums",
        negative && "text-danger",
        emphasis && "font-semibold",
        hideable && hidden && "cursor-default rounded-md outline-offset-2",
        className,
      )}
      data-negative={negative || undefined}
      data-masked={masked || undefined}
      tabIndex={hideable && hidden ? 0 : undefined}
      onMouseEnter={hideable && hidden ? () => setRevealed(true) : undefined}
      onMouseLeave={hideable && hidden ? () => setRevealed(false) : undefined}
      onFocus={hideable && hidden ? () => setRevealed(true) : undefined}
      onBlur={hideable && hidden ? () => setRevealed(false) : undefined}
    >
      {masked ? (
        <>
          <span aria-hidden className="select-none blur-[3px]">
            {figures}
          </span>
          <span className="sr-only">Amount hidden. Focus to reveal.</span>
        </>
      ) : (
        figures
      )}
      {negative && negativeCue && !masked && <span className="text-xs font-medium">{negativeCue}</span>}
    </span>
  );
}

/** The workspace header toggle (3.8 §5.1): a pressed "Hide amounts" button; the label stays the same. */
export function HideAmountsToggle({ className }: { className?: string }) {
  const { hidden, toggle } = useHideAmounts();
  return (
    <Button variant={hidden ? "subtle" : "ghost"} className={cn("min-h-[44px]", className)} aria-pressed={hidden} onClick={toggle}>
      {hidden ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      Hide amounts
    </Button>
  );
}
