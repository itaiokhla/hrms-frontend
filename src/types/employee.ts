export interface Employee {
  id: number;
  employee_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  department?: string;
  designation?: string;
  status: string;
}

export interface TodayAttendance {
  status: string;
  check_in: string | null;
  check_out: string | null;
  working_hours: string;
}

export interface EmployeeProfile {
  id: number;
  employee_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  date_of_birth: string | null;
  gender: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  department: string | null;
  shift: string | null;
  position: string | null;
  hire_date: string;
  photo_url: string | null;
}