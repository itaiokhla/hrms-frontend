"use client";

import { motion } from "framer-motion";
import { Building2, CalendarCheck2, Network, ShieldCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

const FEATURES = [
  { icon: Building2, title: "Built for many companies", text: "Every workspace is fully isolated." },
  { icon: Network, title: "Real reporting lines", text: "Managers see exactly their teams." },
  { icon: CalendarCheck2, title: "Attendance to payroll", text: "Face check-in, leave and payslips." },
  { icon: ShieldCheck, title: "Access you can trust", text: "Roles, scopes and a full audit trail." },
];

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-sidebar lg:block">
        <div className="bg-grid absolute inset-0 opacity-[0.07]" />
        <div className="absolute -left-24 top-16 h-80 w-80 animate-float-slow rounded-full bg-primary/40 blur-3xl" />
        <div
          className="absolute -right-10 bottom-10 h-96 w-96 animate-float-slow rounded-full bg-accent/30 blur-3xl"
          style={{ animationDelay: "-4s" }}
        />
        <div className="relative flex h-full flex-col justify-between p-12 text-sidebar-foreground">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent shadow-glow">
              <Sparkles className="h-5 w-5 text-white" />
            </span>
            <span className="font-display text-lg font-semibold text-white">Intertech HRMS</span>
          </motion.div>
          <div>
            <motion.h2
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.5 }}
              className="max-w-md font-display text-4xl font-semibold leading-tight text-white text-balance"
            >
              One HR platform. Every company, completely separate.
            </motion.h2>
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
                  <p className="mt-3 text-sm font-semibold text-white">{f.title}</p>
                  <p className="mt-1 text-xs text-sidebar-muted">{f.text}</p>
                </motion.div>
              ))}
            </div>
          </div>
          <p className="text-xs text-sidebar-muted">© {new Date().getFullYear()} Intertech. All rights reserved.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-5 py-10 sm:px-10">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[420px]"
        >
          <div className="mb-8 lg:hidden">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent shadow-glow">
              <Sparkles className="h-5 w-5 text-white" />
            </span>
          </div>
          <h1 className="text-[28px] font-semibold">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </motion.div>
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
