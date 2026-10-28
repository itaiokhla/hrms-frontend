"use client";

import { motion } from "framer-motion";
import { useId } from "react";

import { MotionSafe } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

import { plotSite } from "./captureModel";

/**
 * A static site drawing (09-ui-ux/02 §9.2; the `LocationPlot` pattern): the circle or polygon in local metres around
 * its centre, range rings and a north arrow. No map tiles and no third-party requests; coordinates are never printed.
 */
export function SiteMap({ site, size = 220, className, label }: {
  site: { geometry_type: string; center_lat?: number | null; center_lng?: number | null; radius_m?: number | null;
    polygon?: number[][] | null; name?: string };
  size?: number;
  className?: string;
  label?: string;
}) {
  const glow = `site-glow-${useId().replace(/:/g, "")}`;
  const shape = plotSite(site, size);
  const mid = size / 2;
  const caption = shape.kind === "circle" ? `Circle, radius ${site.radius_m} m`
    : shape.kind === "polygon" ? `Polygon, ${(site.polygon ?? []).length} points`
      : "No area: this site is checked by network or QR only";
  return (
    <MotionSafe>
      <figure className={cn("rounded-2xl border border-border bg-gradient-to-br from-surface-muted/60 to-surface p-3", className)}
        data-testid="site-map" data-shape={shape.kind}>
        <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-56 w-56" role="img"
          aria-label={label ?? `${site.name ? `${site.name}: ` : ""}${caption}`}>
          <defs>
            <radialGradient id={glow} cx="50%" cy="50%" r="50%">
              <stop offset="0%" style={{ stopColor: "hsl(var(--primary))" }} stopOpacity="0.28" />
              <stop offset="100%" style={{ stopColor: "hsl(var(--primary))" }} stopOpacity="0.05" />
            </radialGradient>
          </defs>
          {[0.33, 0.66, 0.98].map((k) => (
            <circle key={k} cx={mid} cy={mid} r={(mid - 6) * k} className="fill-none stroke-border" strokeDasharray="2 4" />
          ))}
          <line x1={mid} y1={6} x2={mid} y2={size - 6} className="stroke-border" strokeDasharray="3 3" />
          <line x1={6} y1={mid} x2={size - 6} y2={mid} className="stroke-border" strokeDasharray="3 3" />
          {shape.kind === "circle" && (
            <motion.circle cx={shape.cx} cy={shape.cy} r={shape.r} fill={`url(#${glow})`} className="stroke-primary" strokeWidth={2}
              initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.35, ease: "easeOut" }}
              style={{ transformOrigin: `${mid}px ${mid}px` }} />
          )}
          {shape.kind === "polygon" && (
            <motion.polygon points={shape.points} fill={`url(#${glow})`} className="stroke-primary" strokeWidth={2} strokeLinejoin="round"
              initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35, ease: "easeOut" }}
              style={{ transformOrigin: `${mid}px ${mid}px` }} />
          )}
          {shape.kind !== "none" && <circle cx={mid} cy={mid} r={3.5} className="fill-primary" />}
          {shape.kind !== "none" && (
            <motion.circle cx={mid} cy={mid} r={3.5} className="fill-primary/40"
              animate={{ r: [3.5, 12, 3.5], opacity: [0.6, 0, 0.6] }} transition={{ duration: 2.4, repeat: Infinity }} />
          )}
          <g transform={`translate(${size - 22} 22)`} aria-hidden>
            <path d="M0 -12 L5 4 L0 0 L-5 4 Z" className="fill-foreground/70" />
            <text y={16} textAnchor="middle" className="fill-muted-foreground text-[9px]">N</text>
          </g>
        </svg>
        <figcaption className="text-center text-[11px] text-muted-foreground">
          {caption}{shape.extentM ? ` · drawing about ±${shape.extentM} m` : ""}
        </figcaption>
      </figure>
    </MotionSafe>
  );
}
