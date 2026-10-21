"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/layout";
import { Card } from "@/components/ui/primitives";
import { PayrollApiError } from "@/lib/payroll/api";

import { compensationApi } from "./api";
import { structureTypeLabel } from "./format";
import { BackLink, ErrorSummary, IdChips, useOrgOptions } from "./shared";
import { STRUCTURE_TYPES, type Eligibility } from "./types";

/** Create a salary structure (draft v1 without lines); the builder opens next. */
export function NewStructureForm() {
  const router = useRouter();
  const org = useOrgOptions();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("CTC_BASED");
  const [currency, setCurrency] = useState("");
  const [description, setDescription] = useState("");
  const [eligibility, setEligibility] = useState<Eligibility>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const found: Record<string, string> = {};
    if (!/^[A-Z0-9_-]{1,40}$/.test(code)) found.code = "1-40 capital letters, digits, _ or -.";
    if (!name.trim()) found.name = "Enter a name.";
    if (currency && !/^[A-Z]{3}$/.test(currency)) found.currency = "A 3-letter ISO code, or empty to use the pay group's.";
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const created = await compensationApi.createStructure({ code, name: name.trim(), type, description: description.trim() || null, currency: currency || null, eligibility, lines: [] });
      toast.success("Structure created. Add its lines next.");
      router.replace(`/payroll/structures/${created.id}`);
    } catch (e) {
      const field = e instanceof PayrollApiError && e.detail && typeof e.detail === "object" ? (e.detail as { field?: string }).field : undefined;
      if (field) setErrors({ [field]: (e as Error).message });
      else if (e instanceof PayrollApiError && e.code === "STRUCTURE_CODE_TAKEN") setErrors({ code: e.message });
      else setMessage(e instanceof Error ? e.message : "Could not create the structure.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <BackLink href="/payroll/structures">Salary structures</BackLink>
      <PageHeader title="New salary structure" description="Name it and say who it is for. You add the lines, test it and publish it on the next page." />
      <ErrorSummary errors={[...Object.values(errors), ...(message ? [message] : [])]} className="mb-4" />
      <Card className="p-5">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" required error={errors.code}>
              <Input dir="ltr" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="IN_STAFF_CTC" />
            </Field>
            <Field label="Name" required error={errors.name}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="India staff CTC" />
            </Field>
            <Field label="Pay basis" required>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {STRUCTURE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {structureTypeLabel(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Currency" error={errors.currency} hint="Empty: the eligible pay groups' currency.">
              <Input dir="ltr" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </Field>
          </div>
          <Field label="Description">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <IdChips label="Legal entities" options={org.legalEntities} value={eligibility.legal_entity_ids ?? []} onChange={(ids) => setEligibility((e) => ({ ...e, legal_entity_ids: ids }))} hint="Empty: every entity you can edit." />
          <IdChips label="Pay groups" options={org.payGroups} value={eligibility.pay_group_ids ?? []} onChange={(ids) => setEligibility((e) => ({ ...e, pay_group_ids: ids }))} />
          <IdChips label="Grades" options={org.grades} value={eligibility.grade_ids ?? []} onChange={(ids) => setEligibility((e) => ({ ...e, grade_ids: ids }))} />
          <div className="flex justify-end">
            <Button type="submit" loading={busy} className="min-h-[44px]">
              Create structure
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
