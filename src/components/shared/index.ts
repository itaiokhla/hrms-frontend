/**
 * Shared UI for every module (LH-M0 WI-0.7). New leave, holiday, attendance and cross-module code imports these
 * from `@/components/shared` only; the files still live where payroll v2 built them and are re-exported here, so
 * payroll pages are unchanged (moving the files is a later clean-up; DECISIONS IG-AS-18).
 */
export * from "@/components/payroll";
export {
  ConflictBanner,
  DecisionModal,
  DetailGate,
  ErrorSummary,
  NotFoundState,
  Notice,
  ReasonModal,
} from "@/components/payroll/inputs/shared";
export { Segmented } from "@/components/ui/segmented";
export { useModalRoute, type ModalRoute, type UseModalRouteOptions } from "@/lib/useModalRoute";
export { useTabParam } from "@/lib/useTabParam";
export { EmployeePicker } from "./EmployeePicker";
export { ScopeTargets } from "./ScopeTargets";
// X-M3 list and form foundation (X 04 §2-§5).
export { FilterBar, FiltersButton, type FilterBarProps, type FilterChip } from "./FilterBar";
export { useListQuery, PAGE_SIZES, type ListQuery, type ListQueryOptions } from "@/lib/useListQuery";
