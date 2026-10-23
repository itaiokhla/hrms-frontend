"use client";

import { FileText, Inbox, MessageSquareReply } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { QuestionError } from "@/components/payroll/me/PayslipQuestions";
import { useModalRoute } from "@/components/payroll/useModalRoute";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Column, DataTable, EmptyState, ErrorState, Pagination, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card } from "@/components/ui/primitives";
import { can, canBeyondSelf } from "@/lib/access";
import { useApi } from "@/lib/hooks";
import { newIdempotencyKey } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { questionsApi } from "./api";
import { PayslipsList } from "./PayslipsList";
import { DetailGate, LocalStatusChip, LookupField, Notice, WorkspaceHeader, closeAfterSave, formatDate, formatDateTime, useEntities, useReportDirty } from "./shared";
import { PAYSLIP_QUESTION_STATUSES, type StaffPayslipQuestion } from "./types";

const LIMIT = 50;
/** app/models/payslip_queries.py ANSWER_MAX. */
export const ANSWER_MAX = 4000;
export const QUESTION_MODAL = "payslip-question";

function numberParam(value: string | null | undefined): number | null {
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

function excerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const STATUS_LABEL: Record<string, string> = { OPEN: "Open", ANSWERED: "Answered", CLOSED: "Closed" };

/* ------------------------------------------------------------------ workspace (tabs) */

const TABS = ["payslips", "questions"] as const;
type Tab = (typeof TABS)[number];

/** `?tab=` kept in the URL (bookmarkable); replace, not push, so Back leaves the page. */
function useTab(): [Tab, (t: Tab) => void] {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = search?.get("tab");
  const tab: Tab = raw === "questions" ? "questions" : "payslips";
  const setTab = useCallback(
    (t: Tab) => {
      const next = new URLSearchParams(search?.toString() ?? "");
      next.set("tab", t);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [search, router, pathname],
  );
  return [tab, setTab];
}

/**
 * Payroll › Payslips with its two views: the payslips themselves and the questions employees raised about
 * them (`?tab=questions`, with the deep-linkable answer modal `?modal=payslip-question&id=`).
 */
export function PayslipsWorkspace() {
  const [tab, setTab] = useTab();
  const open = useApi(() => questionsApi.list({ status: "OPEN", limit: 1 }), []);
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as Tab)}
      tabs={[
        { value: "payslips", label: "Payslips" },
        { value: "questions", label: "Questions", badge: open.data?.total || undefined },
      ]}
    >
      <TabPanel value="payslips">{tab === "payslips" && <PayslipsList />}</TabPanel>
      <TabPanel value="questions">{tab === "questions" && <PayslipQuestionsInbox onChanged={() => void open.reload()} />}</TabPanel>
    </Tabs>
  );
}

/* ------------------------------------------------------------------ inbox */

interface Filters {
  status: string;
  legal_entity_id: number | null;
  employee: PickedEmployee | null;
  employee_id: number | null;
  run_id: number | null;
}

/**
 * The HR inbox of payslip questions (3.6): only questions about payslips in the viewer's
 * payroll:payslip:read scope are listed (the server filters, counts included). Answering needs
 * payroll:payslip:publish in scope and is never offered on one's own payslip.
 */
export function PayslipQuestionsInbox({ onChanged }: { onChanged?: () => void }) {
  const { me } = useCan();
  const search = useSearchParams();
  const entities = useEntities();
  const canPickEmployee = can(me, P.EMPLOYEE_READ);
  const canAnswer = canBeyondSelf(me, P.PAYROLL_PAYSLIP_PUBLISH);
  const [filters, setFilters] = useState<Filters>(() => ({
    status: search?.get("status") ?? "OPEN",
    legal_entity_id: null,
    employee: null,
    employee_id: numberParam(search?.get("employee_id")),
    run_id: numberParam(search?.get("run_id")),
  }));
  const [skip, setSkip] = useState(0);
  const [dirty, setDirty] = useState(false);
  const route = useModalRoute(QUESTION_MODAL, { dirty });

  const query = useMemo(
    () => ({
      status: filters.status || null,
      legal_entity_id: filters.legal_entity_id,
      employee_id: filters.employee?.id ?? filters.employee_id,
      run_id: filters.run_id,
      skip,
      limit: LIMIT,
    }),
    [filters, skip],
  );
  const { data, error, loading, reload } = useApi(() => questionsApi.list(query), [JSON.stringify(query)]);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setSkip(0);
  };
  const filtered = !!(query.legal_entity_id || query.employee_id || query.run_id || (query.status && query.status !== "OPEN"));
  const own = (q: StaffPayslipQuestion) => !!me?.employee && q.employee_id === me.employee.id;

  const columns: Column<StaffPayslipQuestion>[] = [
    {
      key: "employee",
      header: "Employee",
      primary: true,
      cell: (q) => (
        <span>
          <span className="font-medium">{q.employee?.name ?? `Employee #${q.employee_id}`}</span>
          {q.employee?.employee_code && (
            <span className="ms-2 text-xs text-muted-foreground">
              <bdi dir="ltr">{q.employee.employee_code}</bdi>
            </span>
          )}
        </span>
      ),
    },
    { key: "payslip", header: "Payslip", cell: (q) => <span>{q.payslip?.period_label ?? (q.payslip?.period_end ? formatDate(q.payslip.period_end) : `#${q.document_id}`)}</span> },
    { key: "question", header: "Question", cell: (q) => <span className="text-sm">{excerpt(q.question)}</span> },
    { key: "status", header: "Status", cell: (q) => <LocalStatusChip vocabulary="payslip_question" code={q.status} /> },
    { key: "asked", header: "Asked", hideOnMobile: true, cell: (q) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(q.created_at)}</span> },
    {
      key: "action",
      header: <span className="sr-only">Answer</span>,
      className: "text-end",
      cell: (q) =>
        canAnswer && q.status === "OPEN" && !own(q) ? (
          <Button
            variant="secondary"
            size="sm"
            className="min-h-[44px]"
            aria-label={`Answer ${q.employee?.name ?? `employee #${q.employee_id}`}`}
            onClick={(e) => {
              e.stopPropagation();
              route.openModal({ id: q.id });
            }}
          >
            <MessageSquareReply className="h-4 w-4" aria-hidden /> Answer
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        title="Payslip questions"
        description="Questions employees asked about their published payslips. Answers go to the employee in the app; the question and the answer are kept with the payslip."
        showHideAmounts={false}
      />
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Status">
            <Select className="min-h-[44px]" value={filters.status} onChange={(e) => set("status", e.target.value)}>
              <option value="">All statuses</option>
              {PAYSLIP_QUESTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <LookupField label="Legal entity" lookup={entities} value={filters.legal_entity_id} onChange={(v) => set("legal_entity_id", v)} />
          {canPickEmployee ? (
            <Field label="Employee">
              <EmployeePicker value={filters.employee} onChange={(v) => set("employee", v)} />
            </Field>
          ) : (
            <Field label="Employee id">
              <Input
                className="min-h-[44px]"
                inputMode="numeric"
                value={filters.employee_id ?? ""}
                onChange={(e) => {
                  const d = e.target.value.replace(/\D/g, "");
                  set("employee_id", d ? Number(d) : null);
                }}
              />
            </Field>
          )}
          <Field label="Pay run id">
            <Input
              className="min-h-[44px]"
              inputMode="numeric"
              value={filters.run_id ?? ""}
              onChange={(e) => {
                const d = e.target.value.replace(/\D/g, "");
                set("run_id", d ? Number(d) : null);
              }}
            />
          </Field>
        </div>
      </Card>
      <Card className="p-0">
        {error && !data ? (
          <ErrorState message={error.message} onRetry={() => void reload()} />
        ) : (
          <DataTable
            caption="Payslip questions"
            columns={columns}
            rows={data?.items}
            loading={loading && !data}
            rowKey={(q) => q.id}
            onRowClick={(q) => route.openModal({ id: q.id })}
            cardBelowMd
            empty={
              <EmptyState
                icon={<Inbox />}
                title={filters.status === "OPEN" && !filtered ? "No open questions" : "No questions match these filters"}
                description={
                  filters.status === "OPEN" && !filtered
                    ? "When an employee asks about a payslip you can see, the question appears here."
                    : "Clear a filter to see more questions."
                }
              />
            }
          />
        )}
        {data && <Pagination total={data.total} skip={skip} limit={LIMIT} onChange={setSkip} />}
      </Card>
      <AnswerQuestionModal
        id={route.id}
        open={route.open}
        onOpenChange={route.onOpenChange}
        close={() => void route.close()}
        canAnswer={canAnswer}
        onDirtyChange={setDirty}
        onAnswered={() => {
          void reload();
          onChanged?.();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ answer modal */

/**
 * One question with the answer form (`?modal=payslip-question&id=`). A question outside the viewer's
 * scope (or another company's) is "not found"; the form appears only for open questions, with
 * payroll:payslip:publish, and never on the viewer's own payslip (the server refuses that too).
 */
export function AnswerQuestionModal({
  id,
  open,
  onOpenChange,
  close,
  canAnswer,
  onAnswered,
  onDirtyChange,
}: {
  id: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  close: () => void;
  canAnswer: boolean;
  onAnswered: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { me } = useCan();
  const { data, error, loading, reload } = useApi(() => questionsApi.get(id ?? ""), [id], { enabled: open && !!id });
  const q = data && String(data.id) === id ? data : undefined;
  const [answer, setAnswer] = useState("");
  const [closeIt, setCloseIt] = useState(false);
  const [fieldError, setFieldError] = useState<string>();
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  useReportDirty(open && !!answer.trim(), onDirtyChange);

  useEffect(() => {
    if (open) {
      setAnswer("");
      setCloseIt(false);
      setFieldError(undefined);
      setSubmitError(null);
      key.current = newIdempotencyKey();
    }
  }, [open, id]);
  useEffect(() => {
    key.current = newIdempotencyKey();
  }, [answer, closeIt]);

  const own = !!q && !!me?.employee && q.employee_id === me.employee.id;
  const answerable = !!q && q.status === "OPEN" && canAnswer && !own;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!q) return;
    const text = answer.trim();
    if (!text) return setFieldError("Write the answer.");
    if (text.length > ANSWER_MAX) return setFieldError(`Keep it to ${ANSWER_MAX.toLocaleString("en")} characters.`);
    setFieldError(undefined);
    setBusy(true);
    setSubmitError(null);
    try {
      await questionsApi.answer(q.id, { answer: text, close: closeIt, row_version: q.row_version }, key.current);
      toast.success("Answer sent. The employee gets an in-app notification.");
      onAnswered();
      closeAfterSave(onDirtyChange, close);
    } catch (err) {
      setSubmitError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={q ? `Question from ${q.employee?.name ?? `employee #${q.employee_id}`}` : "Payslip question"}
      description={
        q ? (
          <Link href={`/payroll/payslips/${q.document_id}`} className="inline-flex min-h-[44px] items-center gap-1 font-medium text-primary hover:underline sm:min-h-0">
            <FileText className="h-3.5 w-3.5" aria-hidden /> Open the payslip{q.payslip?.period_label ? ` · ${q.payslip.period_label}` : ""}
            {q.payslip && q.payslip.version > 1 ? ` (version ${q.payslip.version})` : ""}
          </Link>
        ) : undefined
      }
      footer={
        answerable ? (
          <>
            <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form="answer-question" className="min-h-[44px]" loading={busy}>
              Send answer
            </Button>
          </>
        ) : undefined
      }
    >
      <DetailGate loading={loading} error={error} hasData={!!q} onRetry={() => void reload()} what="Question" backHref="/payroll/payslips?tab=questions" backLabel="Back to questions">
        {q && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <LocalStatusChip vocabulary="payslip_question" code={q.status} />
              {q.employee?.employee_code && (
                <span className="text-muted-foreground">
                  <bdi dir="ltr">{q.employee.employee_code}</bdi>
                </span>
              )}
              <span className="text-muted-foreground">Asked {formatDateTime(q.created_at)}</span>
            </div>
            <blockquote className="whitespace-pre-wrap break-words rounded-2xl border border-border bg-surface-muted/50 p-4">{q.question}</blockquote>
            {q.answer && (
              <div className="rounded-2xl bg-primary-soft/50 p-4">
                <p className="text-xs font-semibold text-muted-foreground">Answer{q.answered_at ? ` · ${formatDateTime(q.answered_at)}` : ""}</p>
                <p className="mt-1 whitespace-pre-wrap break-words">{q.answer}</p>
              </div>
            )}
            {q.status === "CLOSED" && q.closed_at && <p className="text-xs text-muted-foreground">Closed {formatDateTime(q.closed_at)}</p>}
            {own && q.status === "OPEN" && (
              <Notice tone="warning" title="This is your own payslip">
                Another member of the payroll team has to answer it.
              </Notice>
            )}
            {!own && q.status === "OPEN" && !canAnswer && (
              <Notice tone="info" title="Answering needs payslip publishing access">
                You can read this question; a colleague who publishes payslips answers it.
              </Notice>
            )}
            {answerable && (
              <form id="answer-question" onSubmit={submit} className="space-y-3" noValidate>
                <QuestionError error={submitError} onReload={() => void reload()} />
                <Field
                  label="Answer"
                  required
                  error={fieldError}
                  hint={`${answer.trim().length.toLocaleString("en")} / ${ANSWER_MAX.toLocaleString("en")} characters. The employee reads this in the app.`}
                >
                  <Textarea rows={6} maxLength={ANSWER_MAX} value={answer} onChange={(e) => setAnswer(e.target.value)} />
                </Field>
                <label className="flex min-h-[44px] items-center gap-2">
                  <input type="checkbox" className="h-4 w-4" checked={closeIt} onChange={(e) => setCloseIt(e.target.checked)} />
                  Close the question with this answer
                </label>
              </form>
            )}
          </div>
        )}
      </DetailGate>
    </Modal>
  );
}
