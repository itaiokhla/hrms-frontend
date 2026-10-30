"use client";

import { CalendarRange, FilterX } from "lucide-react";
import { useState } from "react";

import { useCan } from "@/components/access/Can";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, Pagination, Tabs, type Column } from "@/components/ui/layout";
import { Avatar, Card } from "@/components/ui/primitives";
import { canBeyondSelf } from "@/lib/access";
import { fmtDate, fromNow } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { STATUS_LABEL, leaveApi, units } from "@/lib/leave/api";
import { useLeaveChanged } from "@/lib/leave/events";
import type { LeaveListItem, LeaveStatusV2 } from "@/lib/leave/types";
import { P } from "@/lib/permissions.generated";
import { useTabParam } from "@/lib/useTabParam";

import { DateRangeText, FlagBadges, LeaveStatusChip, LeaveTypeChip } from "./LeaveBits";
import { ApplyLeaveButton } from "./LeaveWorkspace";
import { useLeaveOverlays } from "./LeaveOverlays";

const PAGE = 25;
const STATUSES: LeaveStatusV2[] = ["DRAFT", "PENDING", "RETURNED", "APPROVED", "REJECTED", "WITHDRAWN", "CANCELLED"];
const SCOPES = ["mine", "team"] as const;
type Scope = (typeof SCOPES)[number];

/** `/leaves/requests`: my requests and, with `leave:read` beyond SELF, my team's — filters, paging, the drawer. */
export function LeaveRequestsList() {
  const { me } = useCan();
  const { openLeave } = useLeaveOverlays();
  const hasMine = !!me?.employee;
  const hasTeam = canBeyondSelf(me, P.LEAVE_READ);
  const [rawScope, setScope] = useTabParam<Scope>(SCOPES, hasMine ? "mine" : "team");
  const scope: Scope = rawScope === "team" && !hasTeam ? "mine" : rawScope === "mine" && !hasMine && hasTeam ? "team" : rawScope;
  const [status, setStatus] = useState<LeaveStatusV2 | "">("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [person, setPerson] = useState<PickedEmployee | null>(null);
  const [skip, setSkip] = useState(0);

  const { data, error, loading, reload } = useApi(
    () => leaveApi.list({ scope, status, start: start || undefined, end: end || undefined, employee_id: scope === "team" ? person?.id : undefined, skip, limit: PAGE }),
    [scope, status, start, end, person?.id, skip],
  );
  useLeaveChanged(() => void reload());

  const filtered = !!(status || start || end || person);
  const reset = () => {
    setStatus("");
    setStart("");
    setEnd("");
    setPerson(null);
    setSkip(0);
  };

  const columns: Column<LeaveListItem>[] = [
    ...(scope === "team"
      ? [{
          key: "employee",
          header: "Employee",
          primary: true,
          cell: (l: LeaveListItem) => (
            <span className="flex items-center gap-2.5"><Avatar name={l.employee_name} size={28} /><span className="font-medium">{l.employee_name}</span></span>
          ),
        }]
      : []),
    { key: "type", header: "Type", primary: scope === "mine", cell: (l) => <LeaveTypeChip name={l.leave_type_name} token={l.color_token} pending={l.status === "PENDING"} /> },
    { key: "dates", header: "Dates", cell: (l) => <DateRangeText start={l.start_date} end={l.end_date} startPortion={l.start_portion} endPortion={l.end_portion} /> },
    { key: "days", header: "Days", cell: (l) => units(l.number_of_days), hideOnMobile: true },
    {
      key: "status",
      header: "Status",
      cell: (l) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <LeaveStatusChip status={l.status} />
          <FlagBadges flags={l.flags} source={l.source} />
        </span>
      ),
    },
    { key: "created", header: "Requested", cell: (l) => (l.created_at ? fromNow(l.created_at) : "—"), hideOnMobile: true },
  ];

  return (
    <div className="space-y-4" data-testid="leave-requests">
      {hasMine && hasTeam && (
        <Tabs
          value={scope}
          onValueChange={(v) => { setScope(v as Scope); setSkip(0); setPerson(null); }}
          tabs={[{ value: "mine", label: "Mine" }, { value: "team", label: "Team" }]}
        >
          {null}
        </Tabs>
      )}
      <Card>
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-[12rem_10rem_10rem_minmax(0,1fr)_auto] lg:items-end">
          <Field label="Status">
            <Select value={status} onChange={(e) => { setStatus(e.target.value as LeaveStatusV2 | ""); setSkip(0); }} data-testid="requests-status-filter">
              <option value="">All statuses</option>
              {STATUSES.filter((s) => scope === "mine" || s !== "DRAFT").map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={start} onChange={(e) => { setStart(e.target.value); setSkip(0); }} data-testid="requests-from" />
          </Field>
          <Field label="To">
            <Input type="date" value={end} min={start || undefined} onChange={(e) => { setEnd(e.target.value); setSkip(0); }} data-testid="requests-to" />
          </Field>
          {scope === "team" ? (
            <Field label="Employee" htmlFor="requests-employee">
              <div><EmployeePicker id="requests-employee" value={person} onChange={(p) => { setPerson(p); setSkip(0); }} placeholder="Anyone" /></div>
            </Field>
          ) : <span className="hidden lg:block" />}
          <Button variant="ghost" size="sm" onClick={reset} disabled={!filtered} className="justify-self-start lg:mb-1">
            <FilterX className="h-4 w-4" aria-hidden /> Clear
          </Button>
        </div>
        {error ? (
          <ErrorState message={error.message} onRetry={() => void reload()} />
        ) : (
          <DataTable
            caption={scope === "mine" ? "My leave requests" : "Team leave requests"}
            rows={data?.items}
            loading={loading}
            busy={loading && !!data}
            rowKey={(l) => l.id}
            cardBelowMd
            onRowClick={(l) => openLeave(l.id)}
            rowHref={(l) => `/leaves/requests?modal=leave&id=${l.id}`}
            columns={columns}
            empty={
              <EmptyState
                icon={<CalendarRange />}
                title={filtered ? "No requests match these filters" : scope === "mine" ? "You have no leave requests yet" : "No requests from your team"}
                action={!filtered && scope === "mine" ? <ApplyLeaveButton variant="subtle" testId="requests-empty-apply" /> : undefined}
              />
            }
          />
        )}
        {data && <Pagination total={data.total} skip={skip} limit={PAGE} onChange={setSkip} />}
      </Card>
      {data && data.total > 0 && (
        <p className="text-xs text-muted-foreground">
          {data.total} request{data.total === 1 ? "" : "s"}{start || end ? ` overlapping ${start ? fmtDate(start) : "…"} – ${end ? fmtDate(end) : "…"}` : ""}
        </p>
      )}
    </div>
  );
}
