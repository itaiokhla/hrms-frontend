"use client";

import { useEffect, useRef } from "react";

/**
 * "Leave data changed" signal between the overlays (apply modal, request drawer) and the page underneath (lists,
 * balances, inbox), so a decision taken in a drawer refreshes the list without the two knowing each other.
 */
const EVENT = "hrms:leave-changed";

export function emitLeaveChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function useLeaveChanged(callback: () => void) {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    const handler = () => ref.current();
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);
}
