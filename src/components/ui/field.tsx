"use client";

import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/cn";

const control =
  "w-full rounded-xl border border-input bg-surface px-3.5 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground/70 hover:border-muted-foreground/40 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/10";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(control, "h-10", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(control, "min-h-[88px] py-2.5", className)} {...props} />,
);
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        control,
        "h-10 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%2394a3b8%22><path d=%22M5.5 7.5l4.5 4.5 4.5-4.5%22/></svg>')] bg-[length:18px] bg-[right_0.6rem_center] bg-no-repeat pr-9",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";

interface FieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

type ControlProps = { id?: string; "aria-describedby"?: string; "aria-invalid"?: unknown };

export function Field({ label, htmlFor, error, hint, required, className, children }: FieldProps) {
  const autoId = useId();
  const messageId = `${autoId}-msg`;
  // The error (or else the hint) describes the control, so screen readers read it with the field.
  const describedBy = error || hint ? messageId : undefined;
  // Link the label to its control even when no explicit id was given, so
  // every field has an accessible name (and can be found by its label).
  let controlId = htmlFor;
  let control = children;
  if (isValidElement<ControlProps>(children) && children.type !== "div") {
    const extra: ControlProps = {};
    if (!controlId) {
      controlId = children.props.id ?? autoId;
      extra.id = controlId;
    }
    if (describedBy) extra["aria-describedby"] = [children.props["aria-describedby"], describedBy].filter(Boolean).join(" ");
    if (error && children.props["aria-invalid"] === undefined) extra["aria-invalid"] = true;
    control = cloneElement(children, extra);
  }
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={controlId} className="flex items-center gap-1 text-[13px] font-medium text-foreground/90">
        {label}
        {required && <span className="text-danger">*</span>}
      </label>
      {control}
      {error ? (
        <p id={messageId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
  /** Lets `Field htmlFor` or a visible label target the switch. */
  id?: string;
  "aria-describedby"?: string;
  "aria-labelledby"?: string;
}

export function Switch({ checked, onChange, label, disabled, id, ...aria }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={aria["aria-labelledby"] ? undefined : label}
      aria-describedby={aria["aria-describedby"]}
      aria-labelledby={aria["aria-labelledby"]}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300 disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      {/* The knob starts at the inline start and travels toward the inline end, mirrored in RTL. */}
      <span
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-300 ease-[cubic-bezier(.34,1.56,.64,1)]",
          checked ? "translate-x-[22px] rtl:-translate-x-[22px]" : "translate-x-0.5 rtl:-translate-x-0.5",
        )}
      />
    </button>
  );
}
