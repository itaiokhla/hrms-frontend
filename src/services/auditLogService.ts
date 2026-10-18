import api from "./api";
import type { AuditLog } from "@/types/audit";

interface AuditLogResponse {
  count: number;
  logs: AuditLog[];
}

export const auditLogService = {
  getLogs: async (): Promise<AuditLog[]> => {
    const response = await api.get<AuditLogResponse>("/audit-logs");
    return response.data.logs;
  },
};