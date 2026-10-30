/** AS-M1 §3.6 (EC AS-SHF-18): the version preview lists the single-instance compliance results per working-time pack,
 * labelled "compliance not verified" for a draft pack; nothing renders when the block is empty. */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import type { VersionPreview } from "@/components/shifts/api";
import { VersionImpact } from "@/components/shifts/ShiftVersionModal";

const base: VersionPreview = {
  dry_run: true, versions: [], affected_employees: { count: 0, sample: [] },
  dates_by_payroll_state: {} as VersionPreview["dates_by_payroll_state"],
  scheduled_minutes: { old: 480, new: 720 }, warnings: [],
};

test("lists each compliance result with its population and the not-verified note", () => {
  render(<VersionImpact name={(id) => `#${id}`} preview={{ ...base, compliance: [
    { rule_key: "DAILY_HOURS_EXCEEDED", severity: "WARN", country: "AE", zone: "Asia/Dubai", employees: 3,
      measured: "12.00", limit: "10", unit: "h", message_key: "roster.rule.daily_hours_exceeded.not_verified" },
    { rule_key: "OUTDOOR_MIDDAY_BAN", severity: "WARN", country: "AE", zone: "Asia/Dubai", employees: 1,
      measured: "2.50", limit: "12:30-15:00", unit: "h in window", message_key: "roster.rule.outdoor_midday_ban" },
  ] }} />);
  const block = screen.getByTestId("version-compliance");
  expect(block).toHaveTextContent("Longer than the daily limit — 3 employees (AE): 12.00 vs 10 h · compliance not verified");
  expect(block).toHaveTextContent("Outdoor work in the midday ban — 1 employee (AE): 2.50 vs 12:30-15:00 h in window");
  expect(block).not.toHaveTextContent("midday ban — 1 employee (AE): 2.50 vs 12:30-15:00 h in window · compliance not verified");
});

test("renders no compliance block when nothing applies", () => {
  render(<VersionImpact name={(id) => `#${id}`} preview={{ ...base, compliance: [] }} />);
  expect(screen.queryByTestId("version-compliance")).not.toBeInTheDocument();
});
