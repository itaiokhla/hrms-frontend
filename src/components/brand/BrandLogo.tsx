"use client";

import { useState } from "react";

import { initialsOf, isSafeAssetUrl, type Brand } from "@/lib/brand";
import { cn } from "@/lib/cn";

/** Square mark (favicon/app icon), falling back to initials on the brand colour. */
export function BrandMark({ brand, size = 40, className }: { brand: Brand; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = isSafeAssetUrl(brand.logos.mark) && !failed ? brand.logos.mark : null;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-accent font-display font-semibold text-primary-foreground shadow-glow",
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        initialsOf(brand.display_name)
      )}
    </span>
  );
}

/**
 * Wide logo for a surface. On dark surfaces the dark logo is used; without one, the
 * light logo sits on a white rounded chip (EC-WL-02). Without any logo: null.
 */
export function BrandWordmark({
  brand,
  surface,
  className,
  height = 36,
}: {
  brand: Brand;
  surface: "light" | "dark";
  className?: string;
  height?: number;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const dark = isSafeAssetUrl(brand.logos.dark) && failed !== brand.logos.dark ? brand.logos.dark : null;
  const light = isSafeAssetUrl(brand.logos.light) && failed !== brand.logos.light ? brand.logos.light : null;
  const src = surface === "dark" ? dark ?? light : light ?? dark;
  if (!src) return null;
  const chip = surface === "dark" && src === light;
  return (
    <span className={cn("inline-flex items-center", chip && "rounded-xl bg-white px-2.5 py-1.5", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={brand.display_name}
        style={{ maxHeight: chip ? height - 12 : height }}
        className="w-auto max-w-[200px] object-contain"
        onError={() => setFailed(src)}
      />
    </span>
  );
}
