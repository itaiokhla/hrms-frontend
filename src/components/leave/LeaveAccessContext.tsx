"use client";

import { createContext, useContext, type ReactNode } from "react";

import { useApi } from "@/lib/hooks";
import { leaveApi } from "@/lib/leave/api";
import type { LeaveAccess } from "@/lib/leave/types";

interface AccessState {
  access: LeaveAccess | undefined;
  error: Error | null;
}

const Ctx = createContext<AccessState | null>(null);

/** Loads `GET /leaves/access` once for a leave page and everything inside it (modals, drawers). */
export function LeaveAccessProvider({ children }: { children: ReactNode }) {
  const { data, error } = useApi(() => leaveApi.access(), []);
  return <Ctx.Provider value={{ access: data, error }}>{children}</Ctx.Provider>;
}

/** The leave access facts; outside a provider the component loads them itself. */
export function useLeaveAccess(): AccessState {
  const ctx = useContext(Ctx);
  const own = useApi(() => leaveApi.access(), [], { enabled: !ctx });
  return ctx ?? { access: own.data, error: own.error };
}
