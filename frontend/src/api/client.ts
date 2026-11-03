import { FormSchemaDefinition, FormVersionResponse } from "../types/schema";
import {
  AdminStats,
  AdminSubmissionsPage,
  SubmissionPayload,
  SubmissionResponse,
} from "../types/submission";

const API_BASE = "/api/v1";

export async function fetchCurrentForm(): Promise<FormVersionResponse> {
  const res = await fetch(`${API_BASE}/forms/current`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || "Không thể tải biểu mẫu khảo sát.");
  }
  return res.json();
}

export async function submitSurveyAnswers(payload: SubmissionPayload): Promise<SubmissionResponse> {
  const res = await fetch(`${API_BASE}/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || "Lỗi khi gửi phiếu khảo sát.";
    const details = data?.error?.details?.join(", ");
    throw new Error(details ? `${msg} (${details})` : msg);
  }
  return data;
}

export async function adminLogin(username: string, password: string): Promise<{ access_token: string }> {
  const res = await fetch(`${API_BASE}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || "Đăng nhập thất bại.");
  }
  return data;
}

export async function adminLogout(): Promise<void> {
  await fetch(`${API_BASE}/admin/logout`, { method: "POST" });
}

export async function fetchAdminStats(token?: string): Promise<AdminStats> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/admin/statistics`, { headers });
  if (!res.ok) {
    throw new Error("Không thể tải dữ liệu thống kê.");
  }
  return res.json();
}

export async function fetchAdminSubmissions(
  page: number = 1,
  pageSize: number = 20,
  token?: string,
  filters?: { form_version?: number; classification?: string }
): Promise<AdminSubmissionsPage> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const query = new URLSearchParams({
    page: page.toString(),
    page_size: pageSize.toString(),
  });
  if (filters?.form_version) query.set("form_version", filters.form_version.toString());
  if (filters?.classification) query.set("classification", filters.classification);

  const res = await fetch(`${API_BASE}/admin/submissions?${query.toString()}`, { headers });
  if (!res.ok) {
    throw new Error("Không thể tải danh sách phiếu.");
  }
  return res.json();
}

export function getExportCsvUrl(): string {
  return `${API_BASE}/admin/export.csv`;
}

export async function deleteAdminSubmission(subId: number, token?: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/admin/submissions/${subId}`, {
    method: "DELETE",
    headers,
  });

  if (!res.ok) {
    throw new Error("Không thể xóa phiếu khảo sát.");
  }
}

export interface SubmissionDetail {
  id: number;
  submission_uuid: string;
  form_version: number;
  classification: string;
  answers: {
    pathology?: {
      selected?: any[];
      other_text?: string;
    };
    classification?: string;
    clinical_data?: Record<string, any>;
  };
  created_at: string;
}

export async function fetchAdminSubmissionDetail(
  subId: number,
  token?: string
): Promise<SubmissionDetail> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/admin/submissions/${subId}`, { headers });
  if (!res.ok) {
    throw new Error("Không thể tải chi tiết phiếu khảo sát.");
  }
  return res.json();
}

export async function publishAdminForm(
  schema: FormSchemaDefinition,
  token?: string
): Promise<FormVersionResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/admin/forms/publish`, {
    method: "POST",
    headers,
    body: JSON.stringify(schema),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.detail || "Lỗi khi xuất bản biểu mẫu.");
  }
  return data;
}

export async function resyncGoogleSheets(token?: string): Promise<{ status: string; count: number; added_count?: number; verified: true }> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/admin/google-sheets/resync`, {
    method: "POST",
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.status !== "success" || data?.verified !== true || !Number.isInteger(data?.count)) {
    throw new Error(data?.error?.message || data?.message || data?.detail || "Chưa xác minh được số phiếu thực tế trên Google Sheet.");
  }
  return data;
}
