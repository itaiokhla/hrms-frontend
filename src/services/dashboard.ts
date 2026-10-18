import { Employee } from "@/types/employee";
import api from "./api";
import type {
  DashboardData,
  DashboardNotification,
  UpcomingLeave,
  AttendanceTrend,
  FaceRegisteredCount,
} from "@/types/dashboard";


const dashboardService = {
  async getDashboard(): Promise<DashboardData> {
    const response = await api.get("/dashboard");
    return response.data;
  },

  async getNotifications(): Promise<DashboardNotification[]> {
  const response = await api.get("/dashboard/notifications");
  return response.data;
  },

  async getUpcomingLeaves(): Promise<UpcomingLeave[]> {
    const response = await api.get("/dashboard/upcoming-leaves");
    return response.data;
  },

  async getRecentActivity() {
    const response = await api.get("/attendance/recent-activity");
    return response.data;
  },

  async getStatusSummary() {
  const response = await api.get("/dashboard/status-summary");
  return response.data;
},

  async getAttendanceTrend(): Promise<AttendanceTrend[]> {
    const response = await api.get("/dashboard/attendance-trend");
    return response.data;
  },

  async getEmployees(): Promise<Employee[]> {
    const response = await api.get("/employees");
    return response.data;
  },

  async getFaceRegisteredCount(): Promise<FaceRegisteredCount> {
    const employees = await this.getEmployees();

    let registered = 0;

    await Promise.all(
      employees.map(async (emp: Employee) => {
        try {
          const response = await api.get(
            `/face-recognition/employee/${emp.id}/encodings`
          );

          if (response.data.total_encodings > 0) {
            registered++;
          }
        } catch {
          // Ignore employees without face registration
        }
      })
    );

    return {
      registered,
    };
  },
};

export default dashboardService;