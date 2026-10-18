export interface Notification {
  id: number;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

export interface NotificationResponse {
  count: number;
  notifications: Notification[];
}

export interface NotificationActionResponse {
  success?: boolean;
  message: string;
}