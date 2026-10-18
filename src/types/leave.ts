export interface Leave {
  id: number;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
  number_of_days?: number;
  created_at?: string;
}

export interface LeaveBalanceItem {
  total: number;
  used: number;
  remaining: number;
}

export interface LeaveBalance {
  earned: LeaveBalanceItem;
  sick: LeaveBalanceItem;
  casual: LeaveBalanceItem;
  unpaid: LeaveBalanceItem;
  maternity: LeaveBalanceItem;
  paternity: LeaveBalanceItem;
}

export interface ApplyLeaveRequest {
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
}