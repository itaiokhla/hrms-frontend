"use client";

import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { currencyInfo } from "@/lib/money";

/**
 * ISO code chip (3.8 §7), shown whenever more than one currency is visible. Historic, fund and
 * unknown codes say so in words, not only in colour.
 */
export function CurrencyBadge({ code, showName, className }: { code: string; showName?: boolean; className?: string }) {
  const upper = (code || "").toUpperCase();
  const info = currencyInfo(upper);
  const note = !info ? "unknown currency" : info.status === "HISTORIC" ? "historic" : info.is_fund ? "fund" : null;
  const name = info?.name ?? "Unknown currency";
  return (
    <Badge
      tone={note ? "warning" : "neutral"}
      className={cn("font-mono tracking-wide", className)}
      title={note ? `${name} (${note})` : name}
      aria-label={`${upper}, ${name}${note && info ? `, ${note}` : ""}`}
    >
      <bdi dir="ltr">{upper}</bdi>
      {showName && <span className="font-sans tracking-normal">{name}</span>}
      {note && info && <span className="font-sans tracking-normal">· {note}</span>}
    </Badge>
  );
}
