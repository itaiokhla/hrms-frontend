export interface Payroll {
  id: number;

  employee_id: number;

  salary_month: string;

  basic_salary: number;

  gross_salary: number;

  net_salary: number;

  present_days: number;

  absent_days: number;

  status: string;

  created_at: string;
}

export interface PayrollSummary {
  total_payroll: number;
  total_employees: number;
  processed: number;
  pending: number;
}

export interface SalarySlip {
  payroll: Payroll;
  company_name: string;
  generated_at: string;
}

export interface PayrollActionResponse {
  success: boolean;
  message: string;
}