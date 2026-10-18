export interface AuditLog {
  id: number;
  user_id: number;
  username: string;
  action: string;
  entity: string;
  entity_id: number;
  details: string;
  ip_address: string;
  created_at: string;
}