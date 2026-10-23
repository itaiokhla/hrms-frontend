"use client";

import { MessageCircleQuestion, MessageSquareReply, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { payrollErrorCode } from "@/components/payroll/inputs/shared";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, Pagination } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card, Skeleton } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { newIdempotencyKey } from "@/lib/payroll/api";

import { meApi } from "./api";
import { ConflictBanner, DetailGate, ErrorSummary, fieldErrors, MeChip, Notice } from "./shared";
import { QUESTION_MAX, type MyPayslipQuestion } from "./types";

/* ------------------------------------------------------------------ refusal wording */

/**
 * The payslip-question refusals (routes/payslip_queries.py), worded for people. Each keeps the server's
 * message when no text is given here; anything else falls back to the shared conflict / error banners.
 */
export const QUESTION_ERRORS: Record<string, { title: string; text?: string; tone?: "warning" | "danger" }> = {
  QUERIES_DISABLED: { title: "Payslip questions are turned off", text: "Your company doesn't take payslip questions here. Contact your HR or payroll team directly." },
  CONFIG_INVALID: { title: "Payslip questions can't be checked right now", text: "Your employer's payslip settings are incomplete. Contact your HR or payroll team directly." },
  TOO_MANY_OPEN_QUESTIONS: { title: "Too many open questions on this payslip" },
  QUESTION_CLOSED: { title: "This question is already closed" },
  QUESTION_NOT_OPEN: { title: "This question was already answered or closed", text: "Reload it to see the current answer." },
  SELF_ANSWER: { title: "You can't answer a question about your own payslip", text: "Another member of the payroll team has to answer it.", tone: "danger" },
};

/** A question refusal with its own wording, or the shared conflict banner and error summary. */
export function QuestionError({ error, onReload }: { error: unknown; onReload?: () => void }) {
  if (!error) return null;
  const code = payrollErrorCode(error);
  const wording = code && Object.prototype.hasOwnProperty.call(QUESTION_ERRORS, code) ? QUESTION_ERRORS[code] : null;
  if (wording) {
    return (
      <Notice tone={wording.tone ?? "warning"} title={wording.title}>
        {wording.text ?? (error instanceof ApiError ? error.message : null)}
        {onReload && code === "QUESTION_NOT_OPEN" && (
          <Button variant="secondary" size="sm" className="mt-2 min-h-[44px]" onClick={onReload}>
            Reload
          </Button>
        )}
      </Notice>
    );
  }
  return (
    <>
      <ConflictBanner error={error} onReload={onReload} />
      <ErrorSummary error={error} fields={fieldErrors(error)} />
    </>
  );
}

/* ------------------------------------------------------------------ ask */

/** The question form: 1–2000 characters, sent once per attempt (Idempotency-Key), never with amounts. */
export function AskQuestionForm({ documentId, onAsked, onCancel }: { documentId: number; onAsked: () => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  const formId = `ask-question-${documentId}`;

  // A different question is a different request.
  useEffect(() => {
    key.current = newIdempotencyKey();
  }, [text]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return setFieldError("Write your question.");
    if (trimmed.length > QUESTION_MAX) return setFieldError(`Keep it to ${QUESTION_MAX.toLocaleString("en")} characters.`);
    setFieldError(undefined);
    setBusy(true);
    setError(null);
    try {
      await meApi.askQuestion(documentId, trimmed, key.current);
      toast.success("Question sent to payroll. You'll be notified when it's answered.");
      setText("");
      onAsked();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id={formId} onSubmit={submit} className="space-y-3 rounded-2xl border border-border p-4" noValidate data-print-hidden>
      <QuestionError error={error} />
      <Field
        label="Your question"
        required
        error={fieldError ?? fieldErrors(error).question}
        hint={`${text.trim().length.toLocaleString("en")} / ${QUESTION_MAX.toLocaleString("en")} characters. Payroll sees your question with this payslip.`}
      >
        <Textarea rows={4} maxLength={QUESTION_MAX} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" className="min-h-[44px]" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="min-h-[44px]" loading={busy}>
          Send question
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ one question */

export function QuestionCard({ question: q, onChanged, showPayslip }: { question: MyPayslipQuestion; onChanged: () => void; showPayslip?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const close = async () => {
    setBusy(true);
    setError(null);
    try {
      await meApi.closeQuestion(q.id, q.row_version);
      toast.success("Question closed.");
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const payslipLabel = q.payslip?.period_label ?? (q.payslip?.number ? `Payslip ${q.payslip.number}` : "Payslip");
  return (
    <article className="space-y-2 rounded-2xl border border-border p-4 text-sm" aria-label={`Question asked ${q.created_at ? fmtDate(q.created_at) : ""}`.trim()}>
      <div className="flex flex-wrap items-center gap-2">
        <MeChip vocabulary="payslip_question" code={q.status} />
        {showPayslip && (
          <Link href={`/me/payslips/${q.document_id}`} className="font-medium text-primary hover:underline">
            {payslipLabel}
          </Link>
        )}
        {q.created_at && <span className="text-xs text-muted-foreground">Asked {fmtDateTime(q.created_at)}</span>}
      </div>
      <p className="whitespace-pre-wrap break-words">{q.question}</p>
      {q.answer ? (
        <div className="rounded-xl bg-primary-soft/50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <MessageSquareReply className="h-3.5 w-3.5" aria-hidden /> Answer from payroll{q.answered_at ? ` · ${fmtDateTime(q.answered_at)}` : ""}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words">{q.answer}</p>
        </div>
      ) : (
        q.status === "OPEN" && <p className="text-xs text-muted-foreground">Payroll hasn&apos;t answered yet. You&apos;ll get a notification when they do.</p>
      )}
      {q.status === "CLOSED" && q.closed_at && <p className="text-xs text-muted-foreground">Closed {fmtDateTime(q.closed_at)}</p>}
      <QuestionError error={error} onReload={onChanged} />
      {q.status !== "CLOSED" && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="min-h-[44px]" loading={busy} onClick={() => void close()} aria-label={`Close question asked ${q.created_at ? fmtDate(q.created_at) : ""}`.trim()}>
            <X className="h-4 w-4" aria-hidden /> {q.status === "ANSWERED" ? "Mark as resolved" : "Withdraw question"}
          </Button>
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ on a payslip */

/**
 * "Ask a question about this payslip" plus the questions already asked about it. Asking is offered only
 * while the employer's `payslip.queries_enabled` is on and the payslip is the current version; earlier
 * questions and their answers stay readable either way.
 */
export function PayslipQuestionsPanel({ documentId, canAsk }: { documentId: number; canAsk: boolean }) {
  const [asking, setAsking] = useState(false);
  const { data, error, loading, reload } = useApi(() => meApi.questions({ document_id: documentId, limit: 50 }), [documentId]);
  const items = data?.items ?? [];
  if (!canAsk && !items.length) return null;
  return (
    <section aria-labelledby={`questions-${documentId}`} className="space-y-3" data-print-hidden>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`questions-${documentId}`} className="text-sm font-semibold">
          Questions about this payslip
        </h3>
        {canAsk && !asking && (
          <Button variant="secondary" className="min-h-[44px]" onClick={() => setAsking(true)}>
            <MessageCircleQuestion className="h-4 w-4" aria-hidden /> Ask a question about this payslip
          </Button>
        )}
      </div>
      {asking && (
        <AskQuestionForm
          documentId={documentId}
          onCancel={() => setAsking(false)}
          onAsked={() => {
            setAsking(false);
            void reload();
          }}
        />
      )}
      {error && !data ? (
        <p className="text-sm text-muted-foreground">Your earlier questions couldn&apos;t be loaded. {error.message}</p>
      ) : loading && !data ? (
        <Skeleton className="h-16 w-full rounded-2xl" />
      ) : (
        items.map((q) => <QuestionCard key={q.id} question={q} onChanged={() => void reload()} />)
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ my questions */

const STATUS_OPTIONS = [
  { value: "", label: "All questions" },
  { value: "OPEN", label: "Waiting for an answer" },
  { value: "ANSWERED", label: "Answered" },
  { value: "CLOSED", label: "Closed" },
];
const LIMIT = 20;

/**
 * "My questions" on My Payslips: every question the employee asked (own only), newest first, with a
 * deep-linkable detail (`?modal=payslip-question&id=`). Shown while questions are enabled, or whenever
 * the employee already has some.
 */
export function MyQuestions({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState("");
  const [skip, setSkip] = useState(0);
  const detail = useModalRoute("payslip-question");
  const { data, error, loading, reload } = useApi(() => meApi.questions({ status: status || null, skip, limit: LIMIT }), [status, skip]);
  const hasAny = !!data && (data.total > 0 || !!status);
  if (!enabled && !hasAny && !detail.open) return null;

  return (
    <section aria-labelledby="my-questions" className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="my-questions" className="text-lg font-semibold">
            My questions
          </h2>
          <p className="text-sm text-muted-foreground">Questions you asked about your payslips and the answers from payroll.</p>
        </div>
        <Field label="Show" className="w-52">
          <Select
            value={status}
            className="min-h-[44px]"
            onChange={(e) => {
              setStatus(e.target.value);
              setSkip(0);
            }}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Card className="p-4">
        {error && !data ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : loading && !data ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading questions">
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !data?.items.length ? (
          <EmptyState
            icon={<MessageCircleQuestion />}
            title={status ? "No questions with this status" : "No questions yet"}
            description="Open a payslip and choose “Ask a question about this payslip” if something doesn't look right."
          />
        ) : (
          <div className="space-y-3">
            {data.items.map((q) => (
              <QuestionCard key={q.id} question={q} onChanged={() => void reload()} showPayslip />
            ))}
          </div>
        )}
        {data && <Pagination total={data.total} skip={skip} limit={LIMIT} onChange={setSkip} />}
      </Card>
      <QuestionModal id={detail.id} open={detail.open} onOpenChange={detail.onOpenChange} onChanged={() => void reload()} />
    </section>
  );
}

/** One own question by id (deep link from a notification or a bookmark); another person's id is "not found". */
export function QuestionModal({ id, open, onOpenChange, onChanged }: { id: string | null; open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const { data, error, loading, reload } = useApi(() => meApi.question(id ?? ""), [id], { enabled: open && !!id });
  const shown = data && String(data.id) === id ? data : undefined;
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="md" title="Payslip question">
      <DetailGate loading={loading} error={error} hasData={!!shown} onRetry={reload} what="Question" backHref="/me/payslips" backLabel="Back to My Payslips">
        {shown && (
          <QuestionCard
            question={shown}
            showPayslip
            onChanged={() => {
              void reload();
              onChanged();
            }}
          />
        )}
      </DetailGate>
    </Modal>
  );
}
