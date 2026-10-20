"use client";

import { Download, Printer } from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Divider, StatusBadge } from "@/components/ui/primitives";
import { downloadFile, errorMessage } from "@/lib/api";
import { fmtMoney, titleCase } from "@/lib/format";
import type { Payslip } from "@/lib/types";

/**
 * Payslip rendered with React (escaped by default). Printing uses the
 * browser's print of this element instead of writing raw HTML strings.
 */
export function PayslipView({ slip, currency: fallbackCurrency = "INR", companyName }: { slip: Payslip; currency?: string; companyName?: string }) {
  const currency = slip.currency ?? fallbackCurrency;
  const print = () => {
    document.body.classList.add("printing-payslip");
    window.print();
    document.body.classList.remove("printing-payslip");
  };
  return (
    <div>
      <div id="payslip" className="rounded-2xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{slip.employer?.legal_name ?? companyName ?? "Payslip"}</p>
            <h3 className="mt-1 text-xl font-semibold">{slip.salary_month}</h3>
          </div>
          <StatusBadge status={slip.status} />
        </div>
        <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <Info label="Employee" value={slip.employee.name} />
          <Info label="Employee code" value={slip.employee.employee_code} />
          <Info label="Department" value={slip.employee.department} />
          <Info label="Designation" value={slip.employee.designation} />
        </div>
        <Divider className="my-5" />
        <div className="grid gap-6 sm:grid-cols-2">
          <Lines title="Earnings" rows={slip.salary_components} currency={currency} />
          <Lines title="Deductions" rows={slip.deductions} currency={currency} />
        </div>
        <Divider className="my-5" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Total label="Gross" value={fmtMoney(slip.gross_salary, currency)} />
          <Total label="Deductions" value={fmtMoney(slip.total_deductions, currency)} />
          <Total label="Net pay" value={fmtMoney(slip.net_salary, currency)} highlight />
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Working days {slip.attendance.working_days} · Present {slip.attendance.present_days} · Absent {slip.attendance.absent_days}
        </p>
      </div>
      <div className="mt-4 flex justify-end gap-2 print:hidden">
        <Button variant="secondary" onClick={print}>
          <Printer className="h-4 w-4" /> Print
        </Button>
        <Button
          onClick={() =>
            downloadFile(`/payroll/${slip.payroll_id}/slip.pdf`, "payslip.pdf").catch((e) => toast.error(errorMessage(e)))
          }
        >
          <Download className="h-4 w-4" /> Download PDF
        </Button>
      </div>
    </div>
  );
}

const Info = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="font-medium">{value}</p>
  </div>
);

function Lines({ title, rows, currency }: { title: string; rows: Record<string, number>; currency: string }) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <dl className="space-y-1.5 text-sm">
        {Object.entries(rows).map(([key, value]) => (
          <div key={key} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{titleCase(key)}</dt>
            <dd className="tabular-nums">{fmtMoney(value, currency)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const Total = ({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) => (
  <div className={highlight ? "rounded-xl bg-primary-soft p-3" : "rounded-xl bg-muted p-3"}>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={highlight ? "text-lg font-semibold text-primary" : "text-lg font-semibold"}>{value}</p>
  </div>
);
