"use client";

import { useEffect, useState } from "react";
import  employeeService  from "@/services/employeeService";
import  salaryStructureService  from "@/services/salaryStructureService";
import { toast } from "react-hot-toast";

export default function SalaryStructurePage() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [salaryStructures, setSalaryStructures] = useState<any[]>([]);

  const [form, setForm] = useState({
    employee_id: "",
    basic_salary: "",
    house_rent_allowance: "0",
    dearness_allowance: "0",
    conveyance_allowance: "0",
    other_allowances: "0",
    effective_from: new Date().toISOString().split("T")[0],
  });

  useEffect(() => {
    loadEmployees();
    loadSalaryStructures();
  }, []);

  const loadEmployees = async () => {
    try {
      const res = await employeeService.getEmployees();
      setEmployees(res);
    } catch (err) {
      console.error(err);
    }
  };

  const loadSalaryStructures = async () => {
    try {
      const res = await salaryStructureService.getAll();
      setSalaryStructures(res);
    } catch (err) {
      console.error(err);
    }
  };

  const saveSalary = async () => {
    try {
      await salaryStructureService.create({
        employee_id: Number(form.employee_id),
        basic_salary: Number(form.basic_salary),
        house_rent_allowance: Number(form.house_rent_allowance),
        dearness_allowance: Number(form.dearness_allowance),
        conveyance_allowance: Number(form.conveyance_allowance),
        other_allowances: Number(form.other_allowances),
        effective_from: form.effective_from,
      });

      toast.success("Salary Structure Saved");

      loadSalaryStructures();

      setForm({
        employee_id: "",
        basic_salary: "",
        house_rent_allowance: "0",
        dearness_allowance: "0",
        conveyance_allowance: "0",
        other_allowances: "0",
        effective_from: new Date().toISOString().split("T")[0],
      });
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Error");
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">
        Salary Structure
      </h1>

      <div className="bg-white rounded-xl shadow p-6 grid grid-cols-2 gap-4">

        <select
          className="border rounded-lg p-3"
          value={form.employee_id}
          onChange={(e) =>
            setForm({ ...form, employee_id: e.target.value })
          }
        >
          <option value="">Select Employee</option>

          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.first_name} {emp.last_name}
            </option>
          ))}
        </select>

        <input
          type="number"
          placeholder="Basic Salary"
          className="border rounded-lg p-3"
          value={form.basic_salary}
          onChange={(e) =>
            setForm({ ...form, basic_salary: e.target.value })
          }
        />

        <input
          type="number"
          placeholder="HRA"
          className="border rounded-lg p-3"
          value={form.house_rent_allowance}
          onChange={(e) =>
            setForm({
              ...form,
              house_rent_allowance: e.target.value,
            })
          }
        />

        <input
          type="number"
          placeholder="DA"
          className="border rounded-lg p-3"
          value={form.dearness_allowance}
          onChange={(e) =>
            setForm({
              ...form,
              dearness_allowance: e.target.value,
            })
          }
        />

        <input
          type="number"
          placeholder="Conveyance"
          className="border rounded-lg p-3"
          value={form.conveyance_allowance}
          onChange={(e) =>
            setForm({
              ...form,
              conveyance_allowance: e.target.value,
            })
          }
        />

        <input
          type="number"
          placeholder="Other Allowances"
          className="border rounded-lg p-3"
          value={form.other_allowances}
          onChange={(e) =>
            setForm({
              ...form,
              other_allowances: e.target.value,
            })
          }
        />

        <input
          type="date"
          className="border rounded-lg p-3"
          value={form.effective_from}
          onChange={(e) =>
            setForm({
              ...form,
              effective_from: e.target.value,
            })
          }
        />

        <button
          onClick={saveSalary}
          className="bg-blue-600 text-white rounded-lg p-3"
        >
          Save Salary Structure
        </button>

      </div>

      <div className="mt-8 bg-white rounded-xl shadow">

        <table className="w-full">

          <thead>

            <tr className="border-b">

              <th className="p-4 text-left">Employee</th>
              <th>Basic</th>
              <th>HRA</th>
              <th>DA</th>
              <th>Conveyance</th>

            </tr>

          </thead>

          <tbody>

            {salaryStructures.map((item: any) => (
              <tr key={item.id} className="border-b">

                <td className="p-4">
                  {item.employee_id}
                </td>

                <td>{item.basic_salary}</td>
                <td>{item.house_rent_allowance}</td>
                <td>{item.dearness_allowance}</td>
                <td>{item.conveyance_allowance}</td>

              </tr>
            ))}

          </tbody>

        </table>

      </div>

    </div>
  );
}