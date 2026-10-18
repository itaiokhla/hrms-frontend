export interface SalaryStructure {
  id: number;
  employee_id: number;
  basic_salary: number;
  house_rent_allowance: number;
  dearness_allowance: number;
  conveyance_allowance: number;
  other_allowances: number;
  effective_from: string;
  effective_to?: string;
}

export interface SalaryStructureCreate {
  employee_id: number;
  basic_salary: number;
  house_rent_allowance: number;
  dearness_allowance: number;
  conveyance_allowance: number;
  other_allowances: number;
  effective_from: string;
  effective_to?: string;
}