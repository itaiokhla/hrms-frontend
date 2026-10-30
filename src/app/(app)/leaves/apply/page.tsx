"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { ApplyLeaveForm } from "@/components/leave/ApplyLeaveForm";
import { LeaveWorkspace } from "@/components/leave/LeaveWorkspace";
import { Card } from "@/components/ui/primitives";
import { canUseLeave } from "@/lib/leave/routes";

/** Full-page twin of the `?modal=apply-leave` dialog (`?type=` pre-selects a type, `?edit=<id>` edits a draft). */
export default function ApplyLeaveRoute() {
  return (
    <LeaveWorkspace title="Apply for leave" description="The preview shows each day, your balance and anything your plan asks for." check={canUseLeave} applyModal={false}>
      <Suspense>
        <ApplyPage />
      </Suspense>
    </LeaveWorkspace>
  );
}

function ApplyPage() {
  const router = useRouter();
  const search = useSearchParams();
  const edit = search?.get("edit");
  const editId = edit && /^\d+$/.test(edit) ? Number(edit) : null;
  return (
    <Card className="p-5 sm:p-6">
      <ApplyLeaveForm
        editId={editId}
        initialType={search?.get("type")}
        onCancel={() => router.push("/leaves/home")}
        onDone={(leave) => router.push(leave.deleted || !leave.id ? "/leaves/requests" : `/leaves/requests?modal=leave&id=${leave.id}`)}
      />
    </Card>
  );
}
