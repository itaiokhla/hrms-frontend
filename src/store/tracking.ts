"use client";

import { create } from "zustand";

import type { TrackingStatus } from "@/lib/types";

type Phase = "idle" | "capturing" | "uploading";

interface TrackingStore {
  status: TrackingStatus | null;
  phase: Phase;
  leader: boolean;
  error: { code?: string; status?: number; message: string } | null;
  revoked: boolean;
  /** Set by the mounted LocationTracker; pages call these instead of talking to the controller. */
  bridge: { requestSync: () => void; ingest: (s: TrackingStatus) => void; captureNow: () => Promise<void> } | null;
  set: (patch: Partial<Omit<TrackingStore, "set" | "reset">>) => void;
  reset: () => void;
}

/** Live tracking status for the UI (memory only; the server is the source of truth). */
export const useTracking = create<TrackingStore>((set) => ({
  status: null,
  phase: "idle",
  leader: false,
  error: null,
  revoked: false,
  bridge: null,
  set: (patch) => set(patch),
  reset: () => set({ status: null, phase: "idle", leader: false, error: null, revoked: false, bridge: null }),
}));
