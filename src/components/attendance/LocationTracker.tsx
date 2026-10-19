"use client";

import { useEffect } from "react";

import { can } from "@/lib/access";
import { api } from "@/lib/api";
import { newKey } from "@/lib/attendance";
import { captureLocation } from "@/lib/geolocation";
import { P } from "@/lib/permissions.generated";
import { TrackingController } from "@/lib/tracking/controller";
import type { TrackingStatus } from "@/lib/types";
import { useSession } from "@/store/session";
import { useTracking } from "@/store/tracking";

/**
 * The one location-tracking controller of this tab. Mounted once in the app
 * shell, so it survives every in-app route change; unmounted on sign-out.
 * Effects are fully torn down on cleanup, so React Strict Mode's double
 * mount in development leaves exactly one running controller.
 */
export function LocationTracker() {
  const me = useSession((s) => s.me);
  const enabled = !!me?.employee && can(me, P.ATTENDANCE_MARK);
  const userId = me?.user.id;
  const companyId = me?.company.id;

  useEffect(() => {
    const store = useTracking.getState();
    if (!enabled || !userId || !companyId) {
      store.reset();
      return;
    }
    const lockName = `hrms-location-${companyId}-${userId}`;
    const controller = new TrackingController({
      fetchStatus: () => api.get<TrackingStatus>("/attendance/me/tracking"),
      submit: (body) => api.post<TrackingStatus>("/attendance/me/location-samples", body),
      capture: (options) => captureLocation(options),
      newKey,
      now: () => Date.now(),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (handle) => window.clearTimeout(handle as number),
      events: window,
      document,
      isOnline: () => navigator.onLine,
      locks: typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : undefined,
      channel: typeof BroadcastChannel !== "undefined" ? () => new BroadcastChannel(lockName) : undefined,
      lockName,
      onStatus: (status) => useTracking.getState().set({ status }),
      onPhase: (phase) => useTracking.getState().set({ phase }),
      onLeader: (leader) => useTracking.getState().set({ leader }),
      onError: (error) => useTracking.getState().set({ error }),
      onRevoked: () => useTracking.getState().set({ revoked: true, status: null }),
    });
    store.set({
      revoked: false,
      bridge: {
        requestSync: () => controller.requestSync(),
        ingest: (status) => controller.ingest(status),
        captureNow: () => controller.captureNow(),
      },
    });
    controller.start();
    return () => {
      controller.stop();
      useTracking.getState().reset();
    };
  }, [enabled, userId, companyId]);

  return null;
}
