export interface DashboardData {
  total_employees: number;
  present_today: number;
  absent_today: number;
  on_leave: number;
}

export interface DashboardNotification {
  id: number;
  title: string;
  message: string;
  is_read?: boolean;
  created_at?: string;
}

export interface UpcomingLeave {
  id: number;
  employee_name: string;
  leave_type: string;
  start_date: string;
}

export interface AttendanceTrend {
  date: string;
  present: number;
  absent: number;
}

export interface FaceRegisteredCount {
  registered: number;
}

export interface AttendanceTrend {
  date: string;
  present: number;
}