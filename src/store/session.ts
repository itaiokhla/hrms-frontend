"use client";

import { create } from "zustand";

import { api, toApiError } from "@/lib/api";
import type { Me } from "@/lib/types";

/** "expired" = the server ended a live session (revoked, suspended, timed out). */
type Status = "idle" | "loading" | "authenticated" | "anonymous" | "expired";

interface SessionState {
  status: Status;
  me: Me | null;
  /** Load (or reload) the signed-in user's profile and effective permissions. */
  load: (opts?: { silent?: boolean }) => Promise<Me | null>;
  setMe: (me: Me) => void;
  logout: () => Promise<void>;
  clear: () => void;
  /** The server rejected the session mid-use; the login page explains why. */
  expire: () => void;
}

/**
 * Session state lives in memory only. Identity and permissions always come
 * from GET /auth/me (the server's view), never from anything persisted in
 * the browser, so a revoked role disappears on the next refresh.
 */
export const useSession = create<SessionState>((set, get) => ({
  status: "idle",
  me: null,
  load: async ({ silent } = {}) => {
    if (!silent) set({ status: get().me ? "authenticated" : "loading" });
    try {
      const me = await api.get<Me>("/auth/me");
      set({ me, status: "authenticated" });
      return me;
    } catch (error) {
      const err = toApiError(error);
      if (err.status === 401 || err.status === 403) {
        // Keep "expired" if the API client already reported the session as ended.
        set({ me: null, status: get().status === "expired" ? "expired" : "anonymous" });
        return null;
      }
      // Network or server failure: keep whatever we had rather than logging out.
      set({ status: get().me ? "authenticated" : "anonymous" });
      return get().me;
    }
  },
  setMe: (me) => set({ me, status: "authenticated" }),
  logout: async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      set({ me: null, status: "anonymous" });
    }
  },
  clear: () => set({ me: null, status: "anonymous" }),
  expire: () => set({ me: null, status: "expired" }),
}));
