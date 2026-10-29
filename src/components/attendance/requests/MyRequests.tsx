"use client";

import { motion } from "framer-motion";
import { FileClock, Plus } from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { DataTable, EmptyState } from "@/components/ui/layout";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { toApiError } from "@/lib/api";
import { requestsApi, STATUS_TONE, type AttendanceRequest } from "@/lib/attendanceRequests";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";

/** "My requests" (04-attendance/04 §17.1): own attendance requests with their state and the withdraw action. */
export function MyRequests({ refreshKey, onNew }: { refreshKey?: unknown; onNew?: () => void }) {
  const { data, loading, reload } = useApi(() => requestsApi.list({ mine: true, limit: 20 }), [refreshKey]);
  const withdraw = async (row: AttendanceRequest) => {
    try {
      await requestsApi.withdraw(row.id);
      toast.success("Request withdrawn");
      await reload();
    } catch (e) {
      toast.error(toApiError(e).message);
    }
  };
  const resubmit = async (row: AttendanceRequest) => {
    try {
      await requestsApi.submit(row.id);
      toast.success("Request sent again");
      await reload();
    } catch (e) {
      toast.error(toApiError(e).message);
    }
  };
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="lg:col-span-2">
      <Card data-testid="my-requests">
        <CardHeader title="My requests" description="Corrections and excuses you asked for."
          action={onNew && <Button size="sm" variant="subtle" data-testid="new-request" onClick={onNew}><Plus className="h-4 w-4" /> New request</Button>} />
        <DataTable
          rows={data?.items}
          loading={loading && !data}
          rowKey={(r) => r.id}
          empty={<EmptyState icon={<FileClock />} title="No requests yet" description="Forgot to punch? Ask for a correction here." />}
          columns={[
            { key: "date", header: "Date", cell: (r) => fmtDate(r.shift_date, "EEE, d MMM") },
            { key: "what", header: "Request", cell: (r) => <span data-testid="my-request-summary">{r.summary}</span> },
            { key: "reason", header: "Reason", cell: (r) => r.reason_label, hideOnMobile: true },
            { key: "status", header: "Status", cell: (r) => (
              <span className="flex flex-col gap-0.5">
                <Badge tone={STATUS_TONE[r.status]} dot><span data-testid="my-request-status">{r.status.toLowerCase()}</span></Badge>
                {r.status === "RETURNED" && r.decision_remarks && <span className="text-xs text-muted-foreground">“{r.decision_remarks}”</span>}
              </span>
            ) },
            { key: "act", header: "", cell: (r) => (
              <span className="flex gap-1">
                {r.allowed_actions.includes("SUBMIT") && <Button size="sm" variant="subtle" onClick={() => void resubmit(r)}>Resubmit</Button>}
                {r.allowed_actions.includes("WITHDRAW") && <Button size="sm" variant="ghost" onClick={() => void withdraw(r)}>Withdraw</Button>}
              </span>
            ) },
          ]}
        />
      </Card>
    </motion.div>
  );
}
