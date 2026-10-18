import api from "./api";
import type {
  Payroll,
  PayrollSummary,
  SalarySlip,
  PayrollActionResponse,
} from "@/types/payroll";


class PayrollService {
  // Employee
  async getMyPayroll(): Promise<Payroll[]> {
    const response = await api.get("/employee/payroll");
    return response.data;
  }

  async getSalarySlip(payrollId: number): Promise<SalarySlip> {
    const response = await api.get(`/payroll/${payrollId}/slip`);
    return response.data;
  }

  // Admin
  async getPayrollRecords(): Promise<Payroll[]> {
    const response = await api.get("/payroll/records");
    return response.data;
  }

  async calculateSalary(
    employeeId: number,
    year: number,
    month: number,
    overtimeHours = 0,
    bonus = 0
  ): Promise<Payroll> {
    const response = await api.post<Payroll>(
  "/payroll/calculate",
  null,
  {
    params: {
      employee_id: employeeId,
      year,
      month,
      overtime_hours: overtimeHours,
      bonus,
    },
  }
);

return response.data;
  }

  async generatePayroll(
    employeeId: number,
    year: number,
    month: number,
    overtimeHours = 0,
    bonus = 0
  ): Promise<Payroll> {
    const response = await api.post(
      `/payroll/generate?employee_id=${employeeId}&year=${year}&month=${month}&overtime_hours=${overtimeHours}&bonus=${bonus}`
    );

    return response.data;
  }

  async generateMonthPayroll(year: number, month: number): Promise<PayrollActionResponse> {
    const response = await api.post(
      `/payroll/generate-month?year=${year}&month=${month}`
    );

    return response.data;
  }

  async approvePayroll(id: number): Promise<PayrollActionResponse> {
    const response = await api.post(`/payroll/${id}/approve`);
    return response.data;
  }

  async processPayroll(id: number): Promise<PayrollActionResponse> {
    const response = await api.post(`/payroll/${id}/process`);
    return response.data;
  }

  async getPayrollSummary(year: number, month: number): Promise<PayrollSummary> {
    const response = await api.get(`/payroll/summary/${year}/${month}`);
    return response.data;
  }
}

export default new PayrollService();