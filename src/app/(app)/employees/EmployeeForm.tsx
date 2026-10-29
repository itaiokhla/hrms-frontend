"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { api, errorMessage, toApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { Department, Employee, Shift } from "@/lib/types";

type Values = Record<string, string>;

const EMPTY: Values = {
  first_name: "", last_name: "", email: "", employee_code: "", position: "", hire_date: "",
  department_id: "", shift_id: "", location: "", phone: "", date_of_birth: "", gender: "",
  address: "", city: "", state: "", postal_code: "", country: "", base_salary: "",
};

export function EmployeeForm({
  open,
  onOpenChange,
  employee,
  departments,
  initialManager = null,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee | null;
  departments: Department[];
  initialManager?: PickedEmployee | null;
  onSaved: (employee: Employee) => void;
}) {
  const { can } = useCan();
  const [values, setValues] = useState<Values>(EMPTY);
  const [manager, setManager] = useState<PickedEmployee | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const { data: shifts } = useApi(() => api.get<Shift[]>("/shifts"), [], { enabled: open });

  const canSalary = can(P.COMPENSATION_MANAGE);
  const showPersonal = !employee || employee.phone !== undefined;

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (employee) {
      const next: Values = { ...EMPTY };
      Object.keys(EMPTY).forEach((k) => {
        const v = (employee as unknown as Record<string, unknown>)[k];
        next[k] = v === null || v === undefined ? "" : String(v);
      });
      setValues(next);
    } else {
      setValues({ ...EMPTY, hire_date: new Date().toISOString().slice(0, 10) });
      setManager(initialManager);
    }
  }, [open, employee, initialManager]);

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const payload: Record<string, unknown> = {};
    Object.entries(values).forEach(([k, v]) => {
      if (k === "base_salary" && !canSalary) return;
      if (!showPersonal && ["phone", "date_of_birth", "gender", "address", "city", "state", "postal_code", "country"].includes(k)) return;
      if (v === "") {
        if (employee) payload[k] = null;
        return;
      }
      payload[k] = ["department_id", "shift_id"].includes(k) ? Number(v) : v;
    });
    if (employee) {
      ["first_name", "last_name", "email", "employee_code", "hire_date"].forEach((k) => payload[k] === null && delete payload[k]);
    } else if (manager) {
      payload.manager_id = manager.id;
    }
    try {
      const saved = employee
        ? await api.put<Employee>(`/employees/${employee.id}`, payload)
        : await api.post<Employee>("/employees", payload);
      toast.success(employee ? "Employee updated" : "Employee added");
      onSaved(saved);
    } catch (err) {
      const apiErr = toApiError(err);
      if (apiErr.fields) {
        setErrors(Object.fromEntries(apiErr.fields.map((f) => [f.field, f.msg])));
      }
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const text = (key: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={label} htmlFor={`emp-${key}`} error={errors[key]} required={props.required}>
      <Input id={`emp-${key}`} value={values[key]} onChange={set(key)} aria-invalid={!!errors[key]} {...props} />
    </Field>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={employee ? `Edit ${employee.full_name}` : "Add employee"}
      description={employee ? undefined : "The employee is created in your company automatically. You can invite them to sign in afterwards."}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="employee-form" loading={saving}>{employee ? "Save changes" : "Add employee"}</Button>
        </>
      }
    >
      <form id="employee-form" onSubmit={submit} className="space-y-6">
        <section className="grid gap-4 sm:grid-cols-2">
          {text("first_name", "First name", { required: true, autoFocus: true })}
          {text("last_name", "Last name", { required: true })}
          {text("email", "Work email", { required: true, type: "email" })}
          {text("employee_code", "Employee code", { required: true })}
          {text("position", "Job title")}
          {text("hire_date", "Joining date", { required: true, type: "date" })}
          <Field label="Department" htmlFor="emp-dept">
            <Select id="emp-dept" value={values.department_id} onChange={set("department_id")}>
              <option value="">No department</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Shift" htmlFor="emp-shift">
            <Select id="emp-shift" value={values.shift_id} onChange={set("shift_id")}>
              <option value="">No fixed shift</option>
              {shifts?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start_time}–{s.end_time})</option>)}
            </Select>
          </Field>
          {text("location", "Work location", { placeholder: "e.g. Pune" })}
          {!employee && can(P.ORG_MANAGE_HIERARCHY) && (
            <Field label="Reports to" htmlFor="emp-manager" hint="You can change reporting lines later from Organization.">
              <EmployeePicker id="emp-manager" value={manager} onChange={setManager} placeholder="Select a manager" />
            </Field>
          )}
        </section>

        {showPersonal && (
          <section>
            <p className="mb-3 text-sm font-semibold">Personal details <span className="font-normal text-muted-foreground">· confidential</span></p>
            <div className="grid gap-4 sm:grid-cols-2">
              {text("phone", "Phone")}
              {text("date_of_birth", "Date of birth", { type: "date" })}
              <Field label="Gender" htmlFor="emp-gender">
                <Select id="emp-gender" value={values.gender} onChange={set("gender")}>
                  <option value="">Prefer not to say</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="non-binary">Non-binary</option>
                </Select>
              </Field>
              {text("address", "Address")}
              {text("city", "City")}
              {text("country", "Country")}
            </div>
          </section>
        )}

        {canSalary && (
          <section>
            <p className="mb-3 text-sm font-semibold">Compensation <span className="font-normal text-muted-foreground">· restricted</span></p>
            <div className="grid gap-4 sm:grid-cols-2">
              {text("base_salary", "Base monthly salary", { type: "number", min: 0, step: "0.01" })}
            </div>
          </section>
        )}
      </form>
    </Modal>
  );
}
