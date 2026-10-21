"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";

import { compensationApi } from "./api";
import { suggestions as suggest, tokenize, wordAt, type Suggestion, type TokenKind } from "./formulaCatalog";
import type { FormulaCheck, FormulaIssue } from "./types";

const TOKEN_CLASS: Record<TokenKind, string> = {
  string: "text-success",
  number: "text-info",
  function: "text-primary font-semibold",
  keyword: "text-accent font-semibold",
  component: "text-warning font-semibold",
  variable: "text-info",
  operator: "text-muted-foreground",
  space: "",
  text: "text-foreground",
};

export interface FormulaEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Components offered by autocomplete and highlighted (from GET /payroll/components). */
  components: { code: string; name: string }[];
  /** The component being edited: excluded from suggestions and used for cycle checks. */
  componentCode?: string;
  kind?: string;
  currency?: string;
  expect?: "AMOUNT" | "NUMBER" | "BOOLEAN" | "ANY";
  disabled?: boolean;
  /** Called with each server check (valid, errors, references). */
  onCheck?: (check: FormulaCheck | null) => void;
  /** Server-side save errors to show inline (e.g. from a 400 on save). */
  externalErrors?: FormulaIssue[];
  hint?: string;
  /** Debounce before validate-formula (ms). */
  debounceMs?: number;
  rows?: number;
}

/**
 * Formula editor (3.8 §5.9, §7): syntax highlighting, autocomplete for components, variables and
 * functions, and live errors from POST /payroll/components/validate-formula with their position.
 */
export function FormulaEditor({
  label,
  value,
  onChange,
  components,
  componentCode,
  kind,
  currency,
  expect = "AMOUNT",
  disabled,
  onCheck,
  externalErrors,
  hint,
  debounceMs = 450,
  rows = 4,
}: FormulaEditorProps) {
  const id = useId();
  const listId = `${id}-suggestions`;
  const area = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLPreElement>(null);
  const reduceMotion = useReducedMotion();
  const [check, setCheck] = useState<FormulaCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const onCheckRef = useRef(onCheck);
  onCheckRef.current = onCheck;

  const codes = useMemo(() => new Set(components.map((c) => c.code)), [components]);
  const tokens = useMemo(() => tokenize(value, codes), [value, codes]);
  const { word, start } = wordAt(value, caret);
  const items: Suggestion[] = useMemo(() => (open ? suggest(word, components, componentCode) : []), [open, word, components, componentCode]);

  // Live check, debounced; stale responses are dropped.
  useEffect(() => {
    if (!value.trim()) {
      setCheck(null);
      setCheckError(null);
      onCheckRef.current?.(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setChecking(true);
      compensationApi
        .validateFormula({ formula: value, component: componentCode, kind, currency, expect }, controller.signal)
        .then((result) => {
          setCheck(result);
          setCheckError(null);
          onCheckRef.current?.(result);
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          setCheckError(e instanceof Error ? e.message : "The formula could not be checked.");
        })
        .finally(() => !controller.signal.aborted && setChecking(false));
    }, debounceMs);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [value, componentCode, kind, currency, expect, debounceMs]);

  const errors = [...(externalErrors ?? []), ...(check?.errors ?? [])];
  const warnings = check?.warnings ?? [];
  const firstError = errors.find((e) => typeof e.position === "number");

  const accept = (s: Suggestion) => {
    const next = value.slice(0, start) + s.insert + value.slice(caret);
    onChange(next);
    setOpen(false);
    const pos = start + s.insert.length;
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + items.length) % items.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      accept(items[Math.min(active, items.length - 1)]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const describedBy = [`${id}-status`, hint ? `${id}-hint` : null].filter(Boolean).join(" ");

  // Highlighted copy behind the transparent textarea; the error span is underlined.
  const highlighted = tokens.map((t, i) => {
    const inError = firstError && typeof firstError.position === "number" && t.start >= firstError.position && t.start < (firstError.end ?? firstError.position + Math.max(1, t.text.length));
    return (
      <span key={i} className={cn(TOKEN_CLASS[t.kind], inError && "underline decoration-danger decoration-wavy underline-offset-4")}>
        {t.text}
      </span>
    );
  });

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-foreground/90">
        {label}
      </label>
      <div className={cn("relative rounded-xl border bg-surface font-mono text-[13px] leading-6", errors.length ? "border-danger" : "border-border", disabled && "opacity-60")} dir="ltr">
        <pre ref={backdrop} aria-hidden className="pointer-events-none m-0 min-h-full whitespace-pre-wrap break-words px-3 py-2" style={{ minHeight: `${rows * 1.5 + 1}rem` }}>
          {highlighted}
          {"\n"}
        </pre>
        <textarea
          ref={area}
          id={id}
          value={value}
          rows={rows}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={items.length ? `${listId}-${Math.min(active, items.length - 1)}` : undefined}
          aria-invalid={errors.length ? true : undefined}
          aria-describedby={describedBy}
          className="absolute inset-0 h-full w-full resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent px-3 py-2 text-transparent caret-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          onChange={(e) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onScroll={(e) => {
            if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop;
          }}
        />
        <AnimatePresence>
          {items.length > 0 && (
            <motion.ul
              id={listId}
              role="listbox"
              aria-label="Suggestions"
              initial={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="absolute inset-x-2 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface p-1 font-sans shadow-lift"
            >
              {items.map((s, i) => (
                <li
                  key={`${s.kind}-${s.label}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    accept(s);
                  }}
                  className={cn("flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg px-2 text-sm sm:min-h-[36px]", i === active ? "bg-primary-soft" : "hover:bg-surface-muted")}
                >
                  <span className="w-20 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">{s.kind}</span>
                  <bdi dir="ltr" className="font-mono">
                    {s.label}
                  </bdi>
                  <span className="truncate text-xs text-muted-foreground">{s.detail}</span>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
      <div id={`${id}-status`} aria-live="polite" className="space-y-1 text-xs">
        {checking ? (
          <p className="inline-flex items-center gap-1 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Checking…
          </p>
        ) : checkError ? (
          <p className="inline-flex items-center gap-1 text-warning">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {checkError}
          </p>
        ) : check && !errors.length ? (
          <p className="inline-flex items-center gap-1 text-success">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Valid{check.type ? ` · ${check.type}` : ""}
            {check.dependencies.length ? ` · uses ${check.dependencies.join(", ")}` : ""}
          </p>
        ) : null}
        {errors.map((e, i) => (
          <p key={`e${i}`} role="alert" className="flex items-start gap-1 font-medium text-danger">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {e.message}
              {typeof e.position === "number" && <span className="text-muted-foreground"> (at character {e.position + 1})</span>}
              {e.path?.length ? <span className="text-muted-foreground"> · cycle: {e.path.join(" → ")}</span> : null}
            </span>
          </p>
        ))}
        {warnings.map((w, i) => (
          <p key={`w${i}`} className="flex items-start gap-1 text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {w.message}
          </p>
        ))}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
