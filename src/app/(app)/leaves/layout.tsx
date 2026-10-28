"use client";

import type { ReactNode } from "react";

import { StepUpProvider } from "@/components/payroll/StepUpAuthModal";

/** Leave pages share the "Confirm it is you" step-up prompt: a tenant can require it for overrides (LH-SEC-02). */
export default function LeavesLayout({ children }: { children: ReactNode }) {
  return <StepUpProvider>{children}</StepUpProvider>;
}
