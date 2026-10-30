"use client";

import { useEffect, useState } from "react";

import { loadAgentStatus } from "@/lib/agent-api";
import type { AgentStatus } from "@/lib/agent-types";

/**
 * GET /agent/status for the signed-in user (cached per page load and user). `null` while loading; a failed call
 * reads as "not enabled", so the sidebar never shows an entry the server would refuse.
 */
export function useAgentStatus(userId: number | null | undefined, force = false): AgentStatus | null {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  useEffect(() => {
    if (!userId) {
      setStatus(null);
      return;
    }
    let alive = true;
    void loadAgentStatus(userId, force).then((value) => {
      if (alive) setStatus(value);
    });
    return () => {
      alive = false;
    };
  }, [userId, force]);
  return status;
}
