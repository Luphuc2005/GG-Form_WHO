export type Role = "admin" | "doctor" | "intern";
export interface Account { id: number; username: string; role: Role; is_active?: boolean }
export interface RecordAnswers {
  pathology: { selected: { id: string; slot?: 1 | 2 | null; children?: unknown[]; other_text?: string | null }[]; other_text?: string | null };
  classification: string;
  clinical_data: Record<string, any>;
}
export interface ClinicalRecord {
  id: number; submission_uuid: string; reference_code: string; form_version: number;
  identity_version: number; study_code: string | null; study_number: number | null;
  workflow_status: string; revision: number; owner_id: number | null; owner_name: string;
  reviewer_name: string | null; review_note: string | null; created_at: string; updated_at: string | null;
  approved_at: string | null; submitted_at: string | null;
  trashed_at: string | null; trashed_from_state: string | null;
  sync_status: string; sync_error: string | null; synced_revision: number | null;
  so_hs: string; ho_ten: string; hospital_code: string; encounter_code: string;
  answers: RecordAnswers;
}
export const STATE_LABELS: Record<string, string> = { draft: "Nháp", submitted: "Đã gửi", changes_requested: "Đã gửi — cần sửa", approved: "Đã duyệt", cancelled: "Đã hủy", trashed: "Trong thùng rác" };
export const SYNC_LABELS: Record<string, string> = { not_requested: "Chưa gửi Sheet", pending: "Đang chờ đồng bộ", syncing: "Đang đồng bộ", synced: "Đã đồng bộ", failed: "Đồng bộ lỗi", removed: "Đã gỡ khỏi Sheet", not_configured: "Chưa kết nối Sheet" };
export class WorkflowApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "WorkflowApiError";
  }
}
export async function workflowApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem("admin_access_token");
  const res = await fetch(`/api/v1${path}`, { ...options, cache: "no-store", credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("session-expired"));
    const details = body?.error?.details;
    throw new WorkflowApiError([body?.error?.message || "Không thể thực hiện thao tác.", ...(Array.isArray(details) ? details : [])].join("\n"), res.status);
  }
  return body;
}
