export interface IdentifyResponse {
  identified: boolean;
  employee_id?: number;
  employee_name?: string;
  confidence?: number;
  email?: string;
  message?: string;
}
