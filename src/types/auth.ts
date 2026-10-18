export interface User {
  id: number;
  username: string;
  email: string;
  role: "admin" | "hr" | "manager" | "employee";
  is_active: boolean;
  created_at: string;
}

export interface LoginResponse {
  user: User;
  access_token: string;
  refresh_token: string;
}