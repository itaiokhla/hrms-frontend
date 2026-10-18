import api from "./api";
import type {
  NotificationResponse,
  NotificationActionResponse,
} from "@/types/notification";

class NotificationService {
  async getAll(): Promise<NotificationResponse> {
    const response = await api.get<NotificationResponse>(
      "/notifications/"    // <-- slash add karo
    );

    return response.data;
  }

  async markRead(
    id: number
  ): Promise<NotificationActionResponse> {
    const response =
      await api.put<NotificationActionResponse>(
        `/notifications/read/${id}`
      );

    return response.data;
  }

  async markAllRead(): Promise<NotificationActionResponse> {
    const response =
      await api.put<NotificationActionResponse>(
        "/notifications/read-all"
      );

    return response.data;
  }
}

export default new NotificationService();