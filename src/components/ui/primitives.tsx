"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { MotionConfig, motion, type HTMLMotionProps } from "framer-motion";
import { useEffect, useState, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-border/80 bg-surface shadow-card", className)} {...props} />;
}

/** Respects prefers-reduced-motion: transforms are skipped and only opacity animates. */
export function MotionSafe({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

export function MotionCard({ className, ...props }: HTMLMotionProps<"div">) {
  return (
    <MotionSafe>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className={cn("rounded-2xl border border-border/80 bg-surface shadow-card", className)}
        {...props}
      />
    </MotionSafe>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4", className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-muted text-muted-foreground",
      primary: "bg-primary-soft text-primary",
      success: "bg-success-soft text-success",
      warning: "bg-warning-soft text-warning",
      danger: "bg-danger-soft text-danger",
      info: "bg-info-soft text-info",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({
  className,
  tone,
  dot,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {props.children}
    </span>
  );
}

const STATUS_TONES: Record<string, VariantProps<typeof badgeVariants>["tone"]> = {
  active: "success",
  approved: "success",
  processed: "success",
  present: "success",
  completed: "success",
  in_stock: "success",
  pending: "warning",
  invited: "info",
  draft: "neutral",
  late: "warning",
  "half-day": "warning",
  working: "info",
  on_lunch: "primary",
  incomplete: "danger",
  assigned: "primary",
  maintenance: "warning",
  rejected: "danger",
  suspended: "danger",
  deactivated: "neutral",
  absent: "danger",
  cancelled: "neutral",
  retired: "neutral",
  skipped: "neutral",
  waiting: "neutral",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? "neutral"} dot>
      {label ?? status.replace(/[_-]/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
    </Badge>
  );
}

const AVATAR_COLORS = [
  "from-indigo-500 to-violet-500",
  "from-cyan-500 to-blue-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-rose-500 to-pink-500",
  "from-fuchsia-500 to-purple-500",
];

export function Avatar({
  name,
  src,
  size = 36,
  className,
}: {
  name?: string | null;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const color = AVATAR_COLORS[(name ?? "").split("").reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br font-semibold text-white ring-2 ring-surface",
        color,
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.38) }}
      aria-hidden
    >
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-muted", className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/5" />
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-border", className)} />;
}
