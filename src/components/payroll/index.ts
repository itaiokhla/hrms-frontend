/**
 * Shared payroll v2 UI (3.8 §7). Built on the framer-motion design system in `@/components/ui`;
 * every animation respects prefers-reduced-motion.
 */
export { ChecklistEmptyState, type ChecklistStep } from "./ChecklistEmptyState";
export { CurrencyBadge } from "./CurrencyBadge";
export { DAY_CLASSES, DayLedgerCalendar, type DayClass, type DayLedgerCalendarProps, type LedgerDay, type LedgerSource } from "./DayLedgerCalendar";
export { DiffView, type DiffKind, type DiffRow } from "./DiffView";
export { ExceptionList, type ExceptionListProps, type ExceptionSeverity, type PayrollExceptionItem } from "./ExceptionList";
export { ExplainPanel, type ExplainInput, type ExplainPanelProps, type ExplainSource } from "./ExplainPanel";
export { FileDropzone, validateFile, type FileDropzoneProps, type UploadState } from "./FileDropzone";
export { Hint } from "./Hint";
export { InheritanceBadge, type InheritanceBadgeProps } from "./InheritanceBadge";
export { JobProgress, useJob, type JobProgressProps, type UseJobOptions } from "./JobProgress";
export { KpiCard, type KpiCardProps, type KpiState } from "./KpiCard";
export { MaskedValue, REVEAL_SECONDS, type MaskedValueProps } from "./MaskedValue";
export { HideAmountsToggle, MoneyText, useMoneyLocale, type MoneyTextProps } from "./MoneyText";
export { PolicyCard, type PolicyAction, type PolicyCardProps } from "./PolicyCard";
export { ScopeBar, type ScopeBarProps, type ScopeSelection, type ScopeTarget } from "./ScopeBar";
export { StatusChip, type StatusChipProps } from "./StatusChip";
export { StepUpAuthModal, StepUpProvider, useStepUp, type StepUpAuthModalProps } from "./StepUpAuthModal";
export { Stepper } from "./Stepper";
export { SwitchCard, type SwitchCardProps, type SwitchLock } from "./SwitchCard";
export { Timeline, type TimelineItem } from "./Timeline";
export { TypedConfirmModal, useTypedConfirm, type TypedConfirmModalProps, type TypedConfirmOptions } from "./TypedConfirmModal";
export { useHideAmounts } from "./useHideAmounts";
export { useModalRoute, type ModalRoute, type UseModalRouteOptions } from "./useModalRoute";
