import api from "./api";
import type { Employee, TodayAttendance,  EmployeeProfile, } from "@/types/employee";


export const exportEmployees = async () => {
  const response = await api.get("/employees/export", {
    responseType: "blob",
  });

  return response.data;
};
export const importEmployees = async (file: File) => {
  const formData = new FormData();

  formData.append("file", file);

  const response = await api.post(
    "/employees/import",
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    }
  );

  return response.data;
};

class EmployeeService {

  async getEmployees(): Promise<Employee[]> {
  const response = await api.get<Employee[]>("/employees");

  return response.data;
}

  async getTodayAttendance(): Promise<TodayAttendance> {
    const response =
      await api.get<TodayAttendance>("/employee/attendance/today");

    return response.data;
  }

  async getProfile(): Promise<EmployeeProfile> {
  const response = await api.get<EmployeeProfile>(
    "/employees/profile"
  );

  return response.data;
}

async updateProfile(data: {
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}) {
  const response = await api.put(
    "/employees/profile",
    data
  );

  return response.data;
}

async uploadProfilePhoto(file: File) {
  const formData = new FormData();

  formData.append("file", file);

  const response = await api.post(
    "/employees/profile/photo",
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    }
  );

  return response.data;
}

}
export default new EmployeeService();