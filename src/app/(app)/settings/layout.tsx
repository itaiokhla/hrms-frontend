"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

import { SettingsShell } from "@/components/payroll/settings/SettingsRail";
import { StepUpProvider } from "@/components/payroll/StepUpAuthModal";
import { useSession } from "@/store/session";

/**
 * One Settings destination with a left rail (3.8 §3.1) around every settings page: today's
 * /settings tabs, Branding & domains, Legal entities & branches and the payroll sections.
 * Motion follows the user's reduced-motion preference. Settings pages share the "Confirm it's you" step-up prompt
 * (activating a leave or holiday plan can need it, LH-SEC-02).
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const me = useSession((s) => s.me);
  return (
    <MotionConfig reducedMotion="user">
      <StepUpProvider>
        <SettingsShell me={me}>{children}</SettingsShell>
      </StepUpProvider>
    </MotionConfig>
  );
}
