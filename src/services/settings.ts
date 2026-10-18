import api from "./api";
import type {
  SettingsData,
  LogoUploadResponse,
} from "@/types/settings";

class SettingsService {
  async getSettings(): Promise<SettingsData> {
    const response =
      await api.get<SettingsData>("/settings/");

    return response.data;
  }

  async saveSettings(
    data: SettingsData
  ): Promise<SettingsData> {
    const response =
      await api.put<SettingsData>("/settings/", data);

    return response.data;
  }

  async uploadLogo(
    file: File
  ): Promise<LogoUploadResponse> {
    const formData = new FormData();

    formData.append("file", file);

    const response =
      await api.post<LogoUploadResponse>(
        "/settings/logo",
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

export default new SettingsService();