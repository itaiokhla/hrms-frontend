"use client";

import { motion } from "framer-motion";
import { ChevronRight, Wallet } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess, useCan } from "@/components/access/Can";
import { PayslipView } from "@/components/shared/PayslipView";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Modal } from "@/components/ui/overlay";
import { Card, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { can } from "@/lib/access";
import { fmtDate, fmtMoney } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { PayrollRecord, Payslip } from "@/lib/types";

export default function PayslipsPage() {
  return (
    <RequireAccess check={(me) => can(me, P.PAYROLL_READ, "SELF") && !!me.employee}>
      <Payslips />
    </RequireAccess>
  );
}

function Payslips() {
  const { me } = useCan();
  const currency = me?.company.currency ?? "INR";
  const { data, loading } = useApi(() => api.get<PayrollRecord[]>("/payroll/my"), []);
  const [slip, setSlip] = useState<Payslip | null>(null);

  const open = async (id: number) => {
    try {
      setSlip(await api.get<Payslip>(`/payroll/${id}/slip`));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader title="Payslips" description="Approved and paid salary statements. Drafts appear once payroll is approved." />
      {loading && !data && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>}
      {data && data.length === 0 && <Card><EmptyState icon={<Wallet />} title="No payslips yet" /></Card>}
      {data && data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((p, i) => (
            <motion.button key={p.id} onClick={() => open(p.id)} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }} whileHover={{ y: -4 }} className="text-left">
              <Card className="group p-5 transition-shadow hover:shadow-lift">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{fmtDate(p.salary_month, "MMMM yyyy")}</p>
                  <StatusBadge status={p.status} />
                </div>
                <p className="mt-3 font-display text-2xl font-semibold">{fmtMoney(p.net_salary, currency)}</p>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  Gross {fmtMoney(p.gross_salary, currency)} <ChevronRight className="ml-auto h-4 w-4 transition-transform group-hover:translate-x-1" />
                </p>
              </Card>
            </motion.button>
          ))}
        </div>
      )}
      <Modal open={!!slip} onOpenChange={(o) => !o && setSlip(null)} title="Payslip" size="lg">
        {slip && <PayslipView slip={slip} currency={currency} companyName={me?.company.name} />}
      </Modal>
    </div>
  );
}
