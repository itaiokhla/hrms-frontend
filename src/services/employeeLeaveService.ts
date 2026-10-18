import api from "@/services/api";

import type {
  Leave,
  LeaveBalance,
  ApplyLeaveRequest,
} from "@/types/leave";

const employeeLeaveService = {
  async getMyLeaves(): Promise<Leave[]> {
    const response = await api.get<Leave[]>("/leaves/my");
    return response.data;
  },

  async getLeaveBalance(): Promise<LeaveBalance> {
  const response = await api.get<LeaveBalance>("/leaves/my/balance");
  return response.data;
},

  async applyLeave(
  data: ApplyLeaveRequest
): Promise<Leave> {
  const response = await api.post<{
    success: boolean;
    leave: Leave;
  }>("/leaves/apply", data);

  return response.data.leave;
},

  async cancelLeave(id: number): Promise<void> {
    await api.delete(`/leaves/${id}`);
  },
};

export default employeeLeaveService;