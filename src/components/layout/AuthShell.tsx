"use client";

import { motion } from "framer-motion";
import { Building2, CalendarCheck2, Network, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { BrandMark, BrandWordmark } from "@/components/brand/BrandLogo";
import { useBrand } from "@/components/brand/BrandProvider";
import { isSafeAssetUrl, isSafeExternalUrl } from "@/lib/brand";

const FEATURES = [
  { icon: Building2, title: "Your own workspace", text: "Your company's data stays private." },
  { icon: Network, title: "Real reporting lines", text: "Managers see exactly their teams." },
  { icon: CalendarCheck2, title: "Attendance to payroll", text: "Face check-in, leave and payslips." },
  { icon: ShieldCheck, title: "Access you can trust", text: "Roles, scopes and a full audit trail." },
];

/**
 * Sign-in, invitation, password-reset and MFA pages, in the brand of the host they are
 * served on (01-white-label §5.5). Security texts stay fixed; only names, logos, colours,
 * the tagline, links and the optional platform credit come from the brand.
 */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  const { brand } = useBrand();
  const loginImage = isSafeAssetUrl(brand.logos.login_image) ? brand.logos.login_image : null;
  const links = [
    { label: "Help", href: brand.help_center_url || brand.support_url },
    { label: "Terms", href: brand.terms_url },
    { label: "Privacy", href: brand.privacy_url },
    { label: "Status", href: brand.status_page_url },
  ].filter((l): l is { label: string; href: string } => isSafeExternalUrl(l.href));
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-sidebar lg:block">
        {loginImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={loginImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90" />
        ) : (
          <>
            <div className="bg-grid absolute inset-0 opacity-[0.07]" />
            <div className="absolute -left-24 top-16 h-80 w-80 animate-float-slow rounded-full bg-primary/40 blur-3xl" />
            <div
              className="absolute -right-10 bottom-10 h-96 w-96 animate-float-slow rounded-full bg-accent/30 blur-3xl"
              style={{ animationDelay: "-4s" }}
            />
          </>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-sidebar/90 via-sidebar/30 to-transparent" />
        <div className="relative flex h-full flex-col justify-between p-12 text-sidebar-foreground">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
            {brand.logos.dark || brand.logos.light ? (
              <BrandWordmark brand={brand} surface="dark" height={44} />
            ) : (
              <>
                <BrandMark brand={brand} size={44} />
                <span className="font-display text-lg font-semibold text-sidebar-foreground">{brand.product_name}</span>
              </>
            )}
          </motion.div>
          <div>
            <motion.h2
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.5 }}
              className="max-w-md font-display text-4xl font-semibold leading-tight text-sidebar-foreground text-balance"
              data-testid="brand-tagline"
            >
              {brand.tagline || "One HR platform. Every company, completely separate."}
            </motion.h2>
            {!loginImage && (
              <div className="mt-10 grid max-w-lg grid-cols-2 gap-4">
                {FEATURES.map((f, i) => (
                  <motion.div
                    key={f.title}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + i * 0.08, duration: 0.45 }}
                    whileHover={{ y: -4 }}
                    className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur"
                  >
                    <f.icon className="h-5 w-5 text-accent" />
                    <p className="mt-3 text-sm font-semibold text-sidebar-foreground">{f.title}</p>
                    <p className="mt-1 text-xs text-sidebar-muted">{f.text}</p>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-sidebar-muted">
            © {new Date().getFullYear()} {brand.display_name}
          </p>
        </div>
      </div>
      <div className="flex flex-col items-center justify-center px-5 py-10 sm:px-10">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[420px]"
        >
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            {brand.logos.light || brand.logos.dark ? (
              <BrandWordmark brand={brand} surface="light" height={40} />
            ) : (
              <>
                <BrandMark brand={brand} size={44} />
                <span className="font-display text-lg font-semibold">{brand.product_name}</span>
              </>
            )}
          </div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary" data-testid="brand-product-name">
            {brand.product_name}
          </p>
          <h1 className="text-[28px] font-semibold">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </motion.div>
        <footer className="mt-10 flex w-full max-w-[420px] flex-col items-center gap-2 text-xs text-muted-foreground">
          {links.length > 0 && (
            <nav aria-label="Help and policies" className="flex flex-wrap justify-center gap-4">
              {links.map((l) => (
                <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
                  {l.label}
                </a>
              ))}
            </nav>
          )}
          {brand.show_powered_by && <p data-testid="powered-by">{brand.powered_by_label}</p>}
        </footer>
      </div>
    </div>
  );
}

export function FormAlert({ children, tone = "danger" }: { children: ReactNode; tone?: "danger" | "success" | "info" }) {
  const tones = {
    danger: "border-danger/20 bg-danger-soft text-danger",
    success: "border-success/20 bg-success-soft text-success",
    info: "border-info/20 bg-info-soft text-info",
  };
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      className={`mb-5 rounded-xl border px-4 py-3 text-sm font-medium ${tones[tone]}`}
    >
      {children}
    </motion.div>
  );
}
