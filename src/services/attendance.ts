import api from "./api";

export interface DashboardEmployee {
  employee_id: number;
  employee_name: string;
  department: string;
  check_in: string | null;
  check_out: string | null;
  working_hours: string | null;
  status: string;
}

export interface DashboardActivity {

  time: string;

  message: string;

  type: string;

}

export interface DashboardResponse {
  total_employees: number;
  present_today: number;
  absent_today: number;
  working_now: number;
  completed_today: number;
  employees: DashboardEmployee[];
  activities: DashboardActivity[];
}

class AttendanceService {

  async getDashboard(): Promise<DashboardResponse> {

    const response = await api.get(
      "/dashboard"
    );

    return response.data;

  }

}

export default new AttendanceService();