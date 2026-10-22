"use client";

import { Landmark } from "lucide-react";

import { EmptyState } from "@/components/ui/layout";
import { Card } from "@/components/ui/primitives";

import { LinkButton, MeHeader } from "./shared";

/**
 * My Tax (3.8 §5.18). No tax-profile, declaration or proof endpoint exists for employees in this
 * release (no country pack requires one), so the page says so plainly instead of showing an empty
 * form. When the API provides a tax profile this page renders it; until then nothing is invented.
 */
export function MyTax() {
  return (
    <div className="mx-auto max-w-3xl">
      <MeHeader title="My Tax" description="Your tax profile, declarations and proofs." hideAmounts={false} />
      <Card>
        <EmptyState
          icon={<Landmark />}
          title="Not available for your country yet"
          description="Tax declarations and proofs will appear here once your employer's payroll supports them for your country. Until then, tax shown on your payslip is calculated from the details HR holds."
          action={<LinkButton href="/me/payslips">See my payslips</LinkButton>}
        />
      </Card>
    </div>
  );
}
