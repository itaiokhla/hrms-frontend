import api from "./api";



export interface IdentifyResponse {
  identified: boolean;
  employee_id?: number;
  employee_name?: string;
  confidence?: number;
  email?: string;
  message?: string;
}

export interface CheckInResponse {
  success: boolean;
  message: string;
  employee_id?: number;
  employee_name?: string;
  confidence?: number;
  check_in_time?: string;
}

export interface CheckOutResponse {
  success: boolean;
  message: string;
  employee_id?: number;
  employee_name?: string;
  check_out_time?: string;
  working_hours?: string;
}

export interface SmartScanResponse {
  success: boolean;
  action: "check_in" | "check_out" | "completed" | "wait";
  employee_id?: number;
  employee_name?: string;
  message: string;
  time?: string;
  working_hours?: string;
}



class FaceRecognitionService {

  async registerFace(
    employeeId: number,
    file: File
  ) {

    const formData = new FormData();

    formData.append("file", file);

    const response = await api.post(
      `/face-recognition/register?employee_id=${employeeId}&is_primary=true`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }
    );

    console.log("SERVICE RESPONSE:", response);
console.log("SERVICE DATA:", response.data);

return response.data;
  }

  async identifyFace(
    file: File
  ): Promise<IdentifyResponse> {

    const formData = new FormData();

    formData.append("file", file);

    const response = await api.post(
      "/face-recognition/identify",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }
    );

    return response.data;
  }

  async checkIn(
    file: File
  ): Promise<CheckInResponse> {

    const formData = new FormData();

    formData.append("file", file);

    const response = await api.post(
      "/face-recognition/check-in-face",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }
    );

    return response.data;
  }

  async checkOut(
  file: File
): Promise<CheckOutResponse> {

  const formData = new FormData();

  formData.append("file", file);

  const response = await api.post(
    "/face-recognition/check-out-face",
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    }
  );

  return response.data;
}

async scan(
  file: File
): Promise<SmartScanResponse> {

  const formData = new FormData();

  formData.append("file", file);

  const response = await api.post(
    "/face-recognition/scan",
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    }
  );

  return response.data;
}

  async getEmployeeEncodings(
    employeeId: number
  ) {

    const response = await api.get(
      `/face-recognition/employee/${employeeId}/encodings`
    );

    return response.data;
  }

}

export default new FaceRecognitionService();