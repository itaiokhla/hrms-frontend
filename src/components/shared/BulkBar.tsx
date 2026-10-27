"use client";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import type { ReactNode } from "react";

export const BULK_MAX_ITEMS = 100;

/**
 * Sticky bulk-action bar (X 04 §2.10 rule 4): shown only while something is selected; "12 selected · Clear" at the
 * start, the actions (one primary at most) at the end. In filter mode it names the matching total instead.
 */
export function BulkBar({ count, filterTotal, onClear, children }: {
  count: number;
  /** Set when "Select all matching" switched to filter mode. */
  filterTotal?: number;
  onClear: () => void;
  children: ReactNode;
}) {
  const shown = count > 0 || filterTotal !== undefined;
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {shown && (
          <motion.div role="region" aria-label="Bulk actions" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }} transition={{ duration: 0.18 }}
            className="sticky bottom-0 z-20 flex flex-wrap items-center gap-3 border-t border-border bg-surface/95 px-4 py-3 shadow-lift backdrop-blur">
            <span className="text-sm font-medium" aria-live="polite">
              {filterTotal !== undefined ? `All ${filterTotal} matching selected` : `${count} selected`}
            </span>
            <button type="button" onClick={onClear} className="text-sm text-primary hover:underline">Clear</button>
            <div className="ms-auto flex flex-wrap items-center gap-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

/** "All 25 on this page are selected. Select all 312 matching" (rule 3), above the table. */
export function SelectAllMatching({ pageCount, total, onSelectAll }: { pageCount: number; total: number; onSelectAll: () => void }) {
  if (total <= pageCount) return null;
  return (
    <div className="border-b border-border bg-primary-soft/40 px-4 py-2 text-sm" role="status">
      All {pageCount} on this page are selected.{" "}
      <button type="button" onClick={onSelectAll} className="font-medium text-primary hover:underline">Select all {total} matching</button>
    </div>
  );
}
