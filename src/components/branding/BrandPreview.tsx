"use client";

import { CalendarCheck2, LayoutDashboard, Moon, Sun, Users, Wallet } from "lucide-react";
import { useState } from "react";

import { initialsOf, isSafeAssetUrl, previewStyle } from "@/lib/brand";
import { cn } from "@/lib/cn";

import type { AdminEffective } from "./types";

const RADIUS_VARS: Record<string, Record<string, string>> = {
  SHARP: { "--radius-lg": "0.25rem", "--radius-xl": "0.375rem", "--radius-2xl": "0.5rem", "--radius-3xl": "0.625rem" },
  ROUNDED: {},
  PILL: { "--radius-lg": "0.75rem", "--radius-xl": "1.125rem", "--radius-2xl": "1.5rem", "--radius-3xl": "2rem" },
};

type Surface = "app" | "login" | "email" | "payslip";

/** What the draft will look like, rendered with the draft's derived tokens (never the live page's). */
export function BrandPreview({ brand }: { brand: AdminEffective }) {
  const [surface, setSurface] = useState<Surface>("app");
  const [mode, setMode] = useState<"light" | "dark">("light");
  const style = { ...previewStyle(brand.tokens, mode), ...(RADIUS_VARS[brand.radius] ?? {}) } as React.CSSProperties;
  const logo = isSafeAssetUrl(brand.logos.light) ? brand.logos.light : null;
  const darkLogo = isSafeAssetUrl(brand.logos.dark) ? brand.logos.dark : null;
  const mark = isSafeAssetUrl(brand.logos.mark) ? brand.logos.mark : null;
  const sidebarDark = brand.sidebar_style !== "LIGHT" || mode === "dark";
  return (
    <div className="space-y-3" data-testid="brand-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Preview surface" className="inline-flex rounded-xl border border-border bg-surface-muted p-0.5 text-xs">
          {(["app", "login", "email", "payslip"] as Surface[]).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={surface === s}
              onClick={() => setSurface(s)}
              className={cn("rounded-lg px-2.5 py-1 font-medium capitalize", surface === s ? "bg-surface shadow-sm" : "text-muted-foreground")}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={() => setMode(mode === "light" ? "dark" : "light")}
          className="inline-flex items-center gap-1 rounded-xl border border-border px-2.5 py-1 text-xs font-medium"
          aria-label={`Preview in ${mode === "light" ? "dark" : "light"} mode`}
        >
          {mode === "light" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
          {mode === "light" ? "Dark" : "Light"}
        </button>
      </div>

      <div className={cn(mode === "dark" && "dark")} style={style} dir={brand.dir}>
        <div className="overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-card">
          {surface === "app" && (
            <div className="flex h-72">
              <div className="flex w-36 flex-col gap-1 bg-sidebar p-2.5 text-sidebar-foreground">
                <div className="mb-2 flex items-center gap-2">
                  {(sidebarDark ? darkLogo ?? logo : logo) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={(sidebarDark ? darkLogo ?? logo : logo)!}
                      alt=""
                      className={cn("max-h-7 max-w-[110px] object-contain", sidebarDark && !darkLogo && "rounded bg-white p-0.5")}
                    />
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-primary to-accent text-[10px] font-bold text-primary-foreground">
                      {mark ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={mark} alt="" className="h-full w-full object-cover" />
                      ) : (
                        initialsOf(brand.display_name)
                      )}
                    </span>
                  )}
                </div>
                <p className="truncate text-[9px] uppercase tracking-widest text-sidebar-muted">{brand.product_name}</p>
                {[
                  { icon: LayoutDashboard, label: "Dashboard", active: true },
                  { icon: CalendarCheck2, label: "Attendance" },
                  { icon: Users, label: "Employees" },
                  { icon: Wallet, label: "Payslips" },
                ].map((item) => (
                  <span
                    key={item.label}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium",
                      item.active ? "bg-sidebar-active text-sidebar-active-foreground" : "text-sidebar-foreground/80",
                    )}
                  >
                    <item.icon className="h-3 w-3" /> {item.label}
                  </span>
                ))}
              </div>
              <div className="flex-1 space-y-3 bg-background p-3">
                <p className="text-[11px] text-muted-foreground">Dashboard · {brand.product_name}</p>
                <div className="rounded-xl border border-border bg-surface p-3 shadow-card">
                  <p className="text-xs font-semibold">Welcome back</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Your team at {brand.display_name}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-xl bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground">Primary button</span>
                    <span className="rounded-xl bg-primary-soft px-3 py-1.5 text-[11px] font-medium text-primary">Soft</span>
                    <span className="rounded-xl bg-danger-soft px-3 py-1.5 text-[11px] font-medium text-danger">Error stays red</span>
                  </div>
                </div>
                <div className="h-2 w-2/3 rounded-full bg-accent/70" />
              </div>
            </div>
          )}

          {surface === "login" && (
            <div className="grid h-72 grid-cols-2">
              <div className="relative overflow-hidden bg-sidebar p-3 text-sidebar-foreground">
                {isSafeAssetUrl(brand.logos.login_image) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brand.logos.login_image!} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
                )}
                <div className="relative">
                  <p className="text-xs font-semibold">{brand.product_name}</p>
                  <p className="mt-10 text-sm font-semibold leading-snug">{brand.tagline || "One HR platform."}</p>
                </div>
              </div>
              <div className="flex flex-col justify-center gap-2 bg-background p-4">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-primary">{brand.product_name}</p>
                <p className="text-sm font-semibold">Welcome back</p>
                <span className="h-6 rounded-lg border border-input bg-surface" />
                <span className="h-6 rounded-lg border border-input bg-surface" />
                <span className="flex h-7 items-center justify-center rounded-lg bg-primary text-[11px] font-medium text-primary-foreground">
                  Sign in
                </span>
                {brand.show_powered_by && <p className="text-center text-[9px] text-muted-foreground">{brand.powered_by_label}</p>}
              </div>
            </div>
          )}

          {surface === "email" && (
            <div className="h-72 bg-[#F3F4F6] p-3 text-[#111827]">
              <div className="overflow-hidden rounded-xl bg-white">
                <div className="flex h-10 items-center px-3" style={{ background: brand.exact.primary }}>
                  {logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={brand.logos.email ?? logo} alt="" className="max-h-6 object-contain" />
                  ) : (
                    <span className="text-xs font-bold text-white">{brand.display_name}</span>
                  )}
                </div>
                <div className="space-y-2 p-3 text-[11px]">
                  <p>Hello Alex, you have been invited to join {brand.display_name} on {brand.product_name}.</p>
                  <span className="inline-block rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground">Accept invitation</span>
                  <p className="text-[#6B7280]">The {brand.display_name} team</p>
                </div>
                <div className="bg-[#F9FAFB] px-3 py-2 text-[9px] text-[#6B7280]">
                  {brand.legal_footer || brand.display_name}
                  {brand.show_powered_by && <span className="block">{brand.powered_by_label}</span>}
                </div>
              </div>
            </div>
          )}

          {surface === "payslip" && (
            <div className="h-72 bg-white p-4 text-[#111827]">
              <div className="flex items-start justify-between">
                {isSafeAssetUrl(brand.document_logo) || logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={(isSafeAssetUrl(brand.document_logo) ? brand.document_logo : logo)!} alt="" className="max-h-8 max-w-[45%] object-contain" />
                ) : (
                  <p className="text-sm font-bold">{brand.display_name}</p>
                )}
                <p className="text-right text-[10px] font-semibold">{brand.display_name}</p>
              </div>
              <div className="mt-2 h-1.5 w-full" style={{ background: brand.exact.primary }} />
              <p className="mt-3 text-xs font-bold">Payslip · October 2026</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                <div className="rounded border border-[#D1D5DB]">
                  <p className="px-2 py-1 font-semibold text-white" style={{ background: brand.exact.primary }}>Earnings</p>
                  <p className="flex justify-between px-2 py-1"><span>Basic salary</span><span>₹50,000.00</span></p>
                </div>
                <div className="rounded border border-[#D1D5DB]">
                  <p className="px-2 py-1 font-semibold text-white" style={{ background: brand.exact.primary }}>Deductions</p>
                  <p className="flex justify-between px-2 py-1"><span>Income tax</span><span>₹4,000.00</span></p>
                </div>
              </div>
              <p className="mt-3 text-[9px] text-[#6B7280]">
                Documents already issued keep their original branding. {brand.legal_footer}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
