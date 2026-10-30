"use client";

import { Bot, FileText } from "lucide-react";
import Link from "next/link";

import { AgentPanel } from "@/components/agent/AgentPanel";
import { useAgentStatus } from "@/components/agent/useAgentStatus";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { useSession } from "@/store/session";

/** The assistant (docs/leave_agent.md §21): chat, typed action cards, voice into the editable composer. */
export default function AgentPage() {
  const me = useSession((s) => s.me);
  // Fresh per visit: the page shows the caller's current capabilities (approval suggestions and so on).
  const status = useAgentStatus(me?.user.id, true);

  return (
    <>
      <PageHeader
        eyebrow="Assistant"
        title="HR assistant"
        description="Check balances and requests, or describe the time off you need. Every change waits for your confirmation."
        actions={
          <Link
            href="/leaves/home?modal=apply-leave"
            className="inline-flex h-8 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-xs font-medium shadow-sm transition-colors hover:bg-surface-muted"
          >
            <FileText className="h-4 w-4" aria-hidden />
            Use the form instead
          </Link>
        }
      />
      {status === null ? (
        <Card className="space-y-3 p-6">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </Card>
      ) : status.enabled ? (
        <AgentPanel status={status} />
      ) : (
        <Card>
          <EmptyState
            icon={<Bot />}
            title="The assistant is not available"
            description={
              status.reason
                ? `It is turned off or not configured for this workspace (${status.reason.toLowerCase().replace(/_/g, " ")}).`
                : "It is not turned on for your workspace. The regular pages work as usual."
            }
          />
        </Card>
      )}
    </>
  );
}
