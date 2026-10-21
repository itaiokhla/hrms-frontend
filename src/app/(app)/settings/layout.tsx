"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

import { SettingsShell } from "@/components/payroll/settings/SettingsRail";
import { useSession } from "@/store/session";

/**
 * One Settings destination with a left rail (3.8 §3.1) around every settings page: today's
 * /settings tabs, Branding & domains, Legal entities & branches and the payroll sections.
 * Motion follows the user's reduced-motion preference.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const me = useSession((s) => s.me);
  return (
    <MotionConfig reducedMotion="user">
      <SettingsShell me={me}>{children}</SettingsShell>
    </MotionConfig>
  );
}
