export interface TodayAttendance {
  status: string;
  check_in: string | null;
  check_out: string | null;
  working_hours: string;
}

export interface AttendanceResponse {
  success: boolean;
  message: string;
}