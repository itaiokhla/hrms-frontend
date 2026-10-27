import { api } from "@/lib/api";

/** Saved list views (X 04 §2.8; GET/POST /saved-views, PATCH/DELETE /saved-views/{id}). */
export interface SavedViewRow {
  id: number;
  list_key: string;
  name: string;
  query: Record<string, unknown>;
  is_shared: boolean;
  is_default: boolean;
  position: number;
  own: boolean;
  owner_name: string | null;
  row_version: number;
  allowed_actions: string[];
}

export interface SystemViewRow {
  id: string; // "sys:<key>"
  key: string;
  name: string;
  query: Record<string, unknown>;
  is_hidden: boolean;
  position: number;
}

export interface SavedViewList {
  list_key: string;
  default_sort: string;
  sort_keys: string[];
  columns: string[];
  page_sizes: number[];
  limit: number;
  system_views: SystemViewRow[];
  views: SavedViewRow[];
}

export interface SavedViewInput {
  name: string;
  query: Record<string, unknown>;
  is_shared: boolean;
  is_default: boolean;
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export const savedViewsApi = {
  list: (listKey: string) => api.get<SavedViewList>("/saved-views", { params: { list_key: listKey } }),
  create: (listKey: string, body: SavedViewInput) =>
    api.post<SavedViewRow>("/saved-views", { list_key: listKey, ...body }, { headers: { "Idempotency-Key": newKey() } }),
  update: (view: SavedViewRow, body: Partial<SavedViewInput> & { position?: number }) =>
    api.patch<SavedViewRow>(`/saved-views/${view.id}`, body, { headers: { "If-Match": String(view.row_version) } }),
  remove: (view: SavedViewRow) =>
    api.delete(`/saved-views/${view.id}`, { headers: { "If-Match": String(view.row_version) } }),
  setSystemState: (listKey: string, systemKey: string, state: { is_hidden?: boolean; position?: number }) =>
    api.put("/saved-views/system-state", { list_key: listKey, system_key: systemKey, ...state }),
};
