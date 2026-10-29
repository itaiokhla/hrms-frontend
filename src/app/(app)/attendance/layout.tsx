"use client";

import type { ReactNode } from "react";

import { StepUpProvider } from "@/components/payroll/StepUpAuthModal";

/** Attendance pages share the "Confirm it's you" step-up prompt: device activation and secret rotation, evidence
 * reveal, the v2 cut-over and rejected-line reveal answer STEP_UP_REQUIRED (G-17; AS 07 §10). */
export default function AttendanceLayout({ children }: { children: ReactNode }) {
  return <StepUpProvider>{children}</StepUpProvider>;
}
