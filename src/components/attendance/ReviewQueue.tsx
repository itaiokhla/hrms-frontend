"use client";

import { motion } from "framer-motion";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { FilterBar, type FilterChip } from "@/components/shared/FilterBar";
import { Field, Input, Select } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, PageHeader, Pagination, type Column } from "@/components/ui/layout";
import { Card, MotionSafe, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";

import { captureApi, findReviewItem, type ReviewItem } from "./captureApi";
import { REVIEW_KIND_LABEL, SEVERITY, ageText } from "./captureModel";
import { ReviewItemSheet, ReviewItemView, ReviewStatusBadge, SeverityBadge } from "./ReviewItemSheet";

type View = "high" | "open" | "decided";
const VIEWS: { value: View; label: string }[] = [
  { value: "high", label: "Open — high severity" }, { value: "open", label: "Open" }, { value: "decided", label: "Decided" },
];
const DECIDED = ["ACKNOWLEDGED", "APPROVED", "REJECTED", "RESOLVED"];

function ViewTabs({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  const id = useId();
  return (
    <MotionSafe>
      <div role="tablist" aria-label="Views" className="inline-flex flex-wrap gap-1 rounded-2xl border border-border bg-surface-muted p-1">
        {VIEWS.map((v) => (
          <button key={v.value} type="button" role="tab" aria-selected={value === v.value} data-testid={`review-view-${v.value}`}
            onClick={() => onChange(v.value)}
            className={cn("relative rounded-xl px-3.5 py-1.5 text-sm font-medium transition-colors",
              value === v.value ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {value === v.value && (
              <motion.span layoutId={`review-view-${id}`} className="absolute inset-0 rounded-xl bg-surface shadow-sm"
                transition={{ type: "spring", stiffness: 420, damping: 34 }} />
            )}
            <span className="relative">{v.label}</span>
          </button>
        ))}
      </div>
    </MotionSafe>
  );
}

/**
 * Review queue (09-ui-ux/02 §4.7; list key `attendance.review`): "Which flagged punches, devices or mappings need a
 * human decision?" Location kinds are visible with `location:review`, the others with `attendance:review`; the
 * viewer's own records never appear. A row opens the `review-item` Sheet; the page twin is `/attendance/review/{id}`.
 */
export function ReviewQueue() {
  const [view, setView] = useState<View>("open");
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [skip, setSkip] = useState(0);
  const [open, setOpen] = useState<ReviewItem | null>(null);
  const limit = 25;
  useEffect(() => {
    const timer = setTimeout(() => { setQ(search); setSkip(0); }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const filters = {
    kind: kind ? [kind] : [], status: view === "decided" ? "" : "OPEN", severity: view === "high" ? "HIGH" : undefined,
    from: from || undefined, to: to || undefined, q: q || undefined, skip, limit,
  };
  const { data, error, loading, reload } = useApi(() => captureApi.review(filters), [JSON.stringify(filters)]);
  const rows = (data?.items ?? []).filter((i) => view !== "decided" || DECIDED.includes(i.status));
  const chips: FilterChip[] = [
    ...(kind ? [{ key: "kind", label: "Kind", values: [REVIEW_KIND_LABEL[kind] ?? kind] }] : []),
    ...(from || to ? [{ key: "range", label: "Dates", values: [`${from || "…"} – ${to || "…"}`] }] : []),
  ];

  const columns: Column<ReviewItem>[] = [
    { key: "severity", header: "Severity", cell: (i) => <SeverityBadge severity={i.severity} /> },
    { key: "kind", header: "Kind", primary: true, hideable: false,
      cell: (i) => <span className="font-medium" data-testid={`review-row-${i.id}`} data-kind={i.kind} data-employee-id={i.employee_id ?? ""}>
        {REVIEW_KIND_LABEL[i.kind] ?? i.kind}</span> },
    { key: "who", header: "Who / what", cell: (i) => i.employee_name ?? (i.device_user_id ? `User ${i.device_user_id}` : "—") },
    { key: "date", header: "Date", cell: (i) => (i.shift_date ? fmtDate(i.shift_date, "EEE d MMM") : "—") },
    { key: "status", header: "Status", hideOnMobile: true, cell: (i) => <ReviewStatusBadge status={i.status} /> },
    { key: "age", header: "Age", className: "tabular-nums", cell: (i) => ageText(i.created_at) },
  ];

  return (
    <div>
      <PageHeader eyebrow="Attendance" title="Review queue"
        description="Flagged punches waiting for a decision. A decision records the review; it never changes a day's status or pay by itself." />
      <Card>
        <FilterBar resultCount={view === "decided" ? rows.length : data?.total}
          views={<ViewTabs value={view} onChange={(v) => { setView(v); setSkip(0); }} />}
          search={{ value: search, onChange: setSearch, placeholder: "Search name, code or device user…", label: "Search the review queue" }}
          chips={chips} onRemoveChip={(key) => { if (key === "kind") setKind(""); else { setFrom(""); setTo(""); } setSkip(0); }}
          onClearAll={() => { setKind(""); setFrom(""); setTo(""); setSearch(""); setSkip(0); }}>
          <Field label="Kind" className="w-52">
            <Select value={kind} onChange={(e) => { setKind(e.target.value); setSkip(0); }} data-testid="review-filter-kind">
              <option value="">All kinds</option>
              {Object.entries(REVIEW_KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label="From" className="w-40"><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setSkip(0); }} /></Field>
          <Field label="To" className="w-40"><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setSkip(0); }} /></Field>
        </FilterBar>
        {error ? <ErrorState message={error.message} onRetry={() => void reload()} /> : (
          <div data-testid="review-table">
            <DataTable rows={data ? [...rows].sort((a, b) => (SEVERITY[b.severity]?.rank ?? 0) - (SEVERITY[a.severity]?.rank ?? 0)) : undefined}
              loading={loading && !data} busy={loading && !!data} rowKey={(i) => i.id} cardBelowMd caption="Review queue"
              columns={columns} rowHref={(i) => `/attendance/review/${i.id}`} onRowClick={setOpen}
              empty={<EmptyState icon={<ClipboardCheck />} title="Nothing to review." description="Flagged punches show up here when they need a decision." />} />
            {data && view !== "decided" && <Pagination total={data.total} skip={skip} limit={limit} onChange={setSkip} />}
          </div>
        )}
      </Card>
      <ReviewItemSheet item={open} onClose={() => setOpen(null)} onDecided={() => void reload()} />
    </div>
  );
}

/** `/attendance/review/{item_id}` — the page twin of the `review-item` overlay. */
export function ReviewItemPage({ id }: { id: number }) {
  const { data, error, loading, reload } = useApi(() => findReviewItem(id), [id]);
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/attendance/review" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Review queue
      </Link>
      <PageHeader eyebrow="Review queue" title={`Review item #${id}`} />
      <Card className="p-6">
        {error ? <ErrorState message={error.message} onRetry={() => void reload()} />
          : loading ? <Skeleton className="h-64" />
            : data ? <ReviewItemView item={data} />
              : <EmptyState title="This review item doesn't exist or you can't see it."
                  action={<Link href="/attendance/review" className="text-sm font-medium text-primary">Back to the queue</Link>} />}
      </Card>
    </div>
  );
}
