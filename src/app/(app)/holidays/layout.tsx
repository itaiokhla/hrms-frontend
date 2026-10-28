"use client";

import type { ReactNode } from "react";

import { StepUpProvider } from "@/components/payroll/StepUpAuthModal";

/** Holiday pages share the "Confirm it's you" step-up prompt: publishing a holiday year needs it (LH-SEC-02). */
export default function HolidaysLayout({ children }: { children: ReactNode }) {
  return <StepUpProvider>{children}</StepUpProvider>;
}
