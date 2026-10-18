import api from "./api";


import type {
  TodayAttendance,
  AttendanceResponse,
} from "@/types/attendance";

class AttendanceService {
  async getTodayAttendance(): Promise<TodayAttendance> {
    const response = await api.get("/employee/attendance/today");
    return response.data;
  }

  async checkIn(employeeId: number, score?: number): Promise<AttendanceResponse> {
    const res = await api.post(
      `/attendance/check-in?employee_id=${employeeId}${
        score ? `&face_match_score=${score}` : ""
      }`
    );

    return res.data;
  }

  async checkOut(employeeId: number): Promise<AttendanceResponse>  {
    const res = await api.post(
      `/attendance/check-out?employee_id=${employeeId}`
    );

    return res.data;
  }
}
export default new AttendanceService();