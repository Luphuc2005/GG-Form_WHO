import React, { useEffect, useState } from "react";
import { AdminStats, AdminSubmissionsPage } from "../types/submission";
import { FormSchemaDefinition } from "../types/schema";
import {
  adminLogout,
  fetchAdminStats,
  fetchAdminSubmissions,
  getExportCsvUrl,
  deleteAdminSubmission,
  fetchAdminSubmissionDetail,
  fetchCurrentForm,
  resyncGoogleSheets,
  SubmissionDetail,
} from "../api/client";
import {
  Download,
  LogOut,
  RefreshCw,
  Users,
  Activity,
  Calendar,
  FileSpreadsheet,
  ExternalLink,
  Trash2,
  AlertTriangle,
  Eye,
  ArrowLeft,
  Copy,
  Check,
  Clock,
  ShieldCheck,
  FileText,
} from "lucide-react";
import { FormHeader } from "../components/FormHeader";
import { FormCard } from "../components/FormCard";
import { OptionTree } from "../components/OptionTree";
import { ClassificationRadio } from "../components/ClassificationRadio";

function formatLocalDateTime(dateStr: string): string {
  if (!dateStr) return "";
  let normalized = dateStr;
  if (!normalized.endsWith("Z") && !normalized.includes("+")) {
    normalized = normalized.replace(" ", "T") + "Z";
  }
  const date = new Date(normalized);
  return date.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function extractAnswersTree(answers: any): { selectedIds: Set<string>; otherTexts: Record<string, string> } {
  const selectedIds = new Set<string>();
  const otherTexts: Record<string, string> = {};

  function walk(nodes: any[]) {
    for (const node of nodes) {
      if (node.id) selectedIds.add(node.id);
      if (node.other_text) otherTexts[node.id] = node.other_text;
      if (node.children && Array.isArray(node.children)) {
        walk(node.children);
      }
    }
  }

  if (answers?.pathology?.selected && Array.isArray(answers.pathology.selected)) {
    walk(answers.pathology.selected);
  }

  return { selectedIds, otherTexts };
}

interface AdminDashboardPageProps {
  token?: string;
  onLogout: () => void;
}

export const AdminDashboardPage: React.FC<AdminDashboardPageProps> = ({
  token,
  onLogout,
}) => {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [submissionsPage, setSubmissionsPage] = useState<AdminSubmissionsPage | null>(null);
  const [page, setPage] = useState(1);
  const [classificationFilter, setClassificationFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [isRealtime, setIsRealtime] = useState(true);

  // Custom modal state for delete confirmation
  const [deletingItem, setDeletingItem] = useState<{ id: number; refCode: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Preview state for inspecting user submission in exact survey UI
  const [formSchema, setFormSchema] = useState<FormSchemaDefinition | null>(null);
  const [previewData, setPreviewData] = useState<{ detail: SubmissionDetail; refCode: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Clipboard copy state
  const [copiedUuid, setCopiedUuid] = useState<string | null>(null);

  const handleCopyUuid = (uuid: string) => {
    navigator.clipboard.writeText(uuid);
    setCopiedUuid(uuid);
    setTimeout(() => setCopiedUuid(null), 2000);
  };

  const handleOpenPreview = async (subId: number, refCode: string) => {
    setPreviewLoading(true);
    try {
      const [detail, schemaRes] = await Promise.all([
        fetchAdminSubmissionDetail(subId, token),
        formSchema ? Promise.resolve({ schema_json: formSchema }) : fetchCurrentForm(),
      ]);
      if (!formSchema) {
        setFormSchema(schemaRes.schema_json);
      }
      setPreviewData({ detail, refCode });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: any) {
      alert(err.message || "Không thể tải nội dung xem trước phiếu.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const [isResyncing, setIsResyncing] = useState(false);

  const handleResyncGoogleSheets = async () => {
    if (
      !window.confirm(
        "Bạn có muốn đồng bộ lại toàn bộ dữ liệu hiện tại sang Google Sheet không?\n(Bảng tính Google Sheet sẽ được cập nhật chính xác tuyệt đối theo CSDL)"
      )
    ) {
      return;
    }
    setIsResyncing(true);
    try {
      const res = await resyncGoogleSheets(token);
      alert(`Đồng bộ thành công! Hiện có ${res.count ?? 0} phiếu trên Google Sheet.`);
    } catch (err: any) {
      alert(err.message || "Lỗi khi đồng bộ Google Sheet.");
    } finally {
      setIsResyncing(false);
    }
  };

  const loadData = async (showLoadingSpinner: boolean = true) => {
    if (showLoadingSpinner) setLoading(true);
    try {
      const [statsData, subsData] = await Promise.all([
        fetchAdminStats(token),
        fetchAdminSubmissions(page, 20, token, {
          classification: classificationFilter || undefined,
        }),
      ]);
      setStats(statsData);
      setSubmissionsPage(subsData);
    } catch (err: any) {
      console.error(err);
    } finally {
      if (showLoadingSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    loadData(true);
  }, [page, classificationFilter]);

  // Real-time polling effect every 3 seconds
  useEffect(() => {
    if (!isRealtime) return;

    const interval = setInterval(() => {
      loadData(false);
    }, 3000);

    return () => clearInterval(interval);
  }, [isRealtime, page, classificationFilter, token]);

  const handleLogoutClick = async () => {
    await adminLogout();
    onLogout();
  };

  const handleConfirmDelete = async () => {
    if (!deletingItem) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteAdminSubmission(deletingItem.id, token);
      setDeletingItem(null);
      await loadData(false);
    } catch (err: any) {
      setDeleteError(err.message || "Lỗi khi xóa phiếu.");
    } finally {
      setIsDeleting(false);
    }
  };

  const getClassificationBadge = (cls: string) => {
    switch (cls) {
      case "benign":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              borderRadius: "20px",
              fontSize: "13px",
              fontWeight: "600",
              backgroundColor: "#dcfce7",
              color: "#166534",
              border: "1px solid #bbf7d0",
            }}
          >
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: "#16a34a" }} />
            Lành tính
          </span>
        );
      case "borderline":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              borderRadius: "20px",
              fontSize: "13px",
              fontWeight: "600",
              backgroundColor: "#fef3c7",
              color: "#92400e",
              border: "1px solid #fde68a",
            }}
          >
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: "#d97706" }} />
            Giáp biên ác
          </span>
        );
      case "malignant":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              borderRadius: "20px",
              fontSize: "13px",
              fontWeight: "600",
              backgroundColor: "#fee2e2",
              color: "#991b1b",
              border: "1px solid #fecaca",
            }}
          >
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: "#dc2626" }} />
            Ác tính
          </span>
        );
      default:
        return <span>{cls}</span>;
    }
  };

  // 1. PREVIEW MODE VIEW
  if (previewData && formSchema) {
    const { selectedIds, otherTexts } = extractAnswersTree(previewData.detail.answers);
    const pathologyField = formSchema.fields.find((f) => f.id === "pathology");
    const classificationField = formSchema.fields.find((f) => f.id === "classification");

    return (
      <div style={{ minHeight: "100vh", backgroundColor: "var(--background)" }}>
        {/* Top Sticky Bar */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 9999,
            backgroundColor: "#5e35b1",
            color: "#ffffff",
            padding: "14px 28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "8px",
                backgroundColor: "rgba(255,255,255,0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Eye size={22} color="#ffffff" />
            </div>
            <div>
              <div style={{ fontSize: "19px", fontWeight: "700", letterSpacing: "0.3px" }}>
                XEM TRƯỚC PHIẾU KHẢO SÁT: {previewData.refCode}
              </div>
              <div style={{ fontSize: "14px", opacity: 0.9, marginTop: "2px" }}>
                Thời gian gửi: {formatLocalDateTime(previewData.detail.created_at)} | UUID: {previewData.detail.submission_uuid}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPreviewData(null)}
            style={{
              backgroundColor: "#ffffff",
              color: "#5e35b1",
              border: "none",
              borderRadius: "8px",
              padding: "10px 20px",
              fontSize: "15px",
              fontWeight: "700",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
              transition: "transform 0.15s ease",
            }}
            onMouseOver={(e) => (e.currentTarget.style.transform = "translateY(-1px)")}
            onMouseOut={(e) => (e.currentTarget.style.transform = "none")}
          >
            <ArrowLeft size={18} />
            <span>Quay lại Bảng điều khiển</span>
          </button>
        </div>

        {/* Real User Survey Layout Pre-filled */}
        <div className="form-container" style={{ paddingTop: "28px" }}>
          <FormHeader
            title={formSchema.title}
            description={formSchema.description}
            hasRequiredFields={false}
          />

          {pathologyField && (
            <FormCard
              id={pathologyField.id}
              title={pathologyField.label}
              required={false}
            >
              <OptionTree
                options={pathologyField.options}
                selectedIds={selectedIds}
                otherTexts={otherTexts}
                onToggle={() => {}}
                onOtherTextChange={() => {}}
              />
            </FormCard>
          )}

          {classificationField && (
            <FormCard
              id={classificationField.id}
              title={classificationField.label}
              required={false}
            >
              <ClassificationRadio
                options={classificationField.options}
                selectedValue={previewData.detail.classification}
                onChange={() => {}}
              />
            </FormCard>
          )}

          <div style={{ textAlign: "center", margin: "36px 0" }}>
            <button
              type="button"
              className="btn-submit"
              onClick={() => setPreviewData(null)}
              style={{
                cursor: "pointer",
                padding: "12px 28px",
                fontSize: "16px",
                borderRadius: "8px",
                backgroundColor: "#5e35b1",
              }}
            >
              ← Quay lại Bảng điều khiển
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Calculate percentages for classification distribution bar
  const totalClass =
    (stats?.by_classification["benign"] || 0) +
    (stats?.by_classification["borderline"] || 0) +
    (stats?.by_classification["malignant"] || 0);

  const benignPct = totalClass > 0 ? ((stats?.by_classification["benign"] || 0) / totalClass) * 100 : 0;
  const borderlinePct = totalClass > 0 ? ((stats?.by_classification["borderline"] || 0) / totalClass) * 100 : 0;
  const malignantPct = totalClass > 0 ? ((stats?.by_classification["malignant"] || 0) / totalClass) * 100 : 0;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f8fafc", color: "#1e293b" }}>
      {/* 1. Global Navigation Top Header */}
      <header
        style={{
          backgroundColor: "#ffffff",
          borderBottom: "1px solid #e2e8f0",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "12px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          {/* Logo & System Title */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "10px",
                background: "linear-gradient(135deg, #673ab7 0%, #4527a0 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 2px 6px rgba(103, 58, 183, 0.3)",
                color: "#ffffff",
              }}
            >
              <ShieldCheck size={24} />
            </div>
            <div>
              <div style={{ fontSize: "17px", fontWeight: "700", color: "#1e293b", letterSpacing: "0.2px" }}>
                HỆ THỐNG KHẢO SÁT GIẢI PHẪU BỆNH
              </div>
              <div style={{ fontSize: "13px", color: "#64748b" }}>
                Đề tài Nghiên cứu Phân loại U Buồng Trứng (WHO)
              </div>
            </div>
          </div>

          {/* User Controls & Realtime */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {/* Real-time Status Badge */}
            <button
              type="button"
              onClick={() => setIsRealtime(!isRealtime)}
              title="Bật/Tắt tự động cập nhật số liệu thời gian thực"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 14px",
                borderRadius: "20px",
                border: isRealtime ? "1px solid #bbf7d0" : "1px solid #e2e8f0",
                backgroundColor: isRealtime ? "#f0fdf4" : "#f1f5f9",
                color: isRealtime ? "#166534" : "#64748b",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: isRealtime ? "#22c55e" : "#94a3b8",
                  display: "inline-block",
                  boxShadow: isRealtime ? "0 0 0 3px rgba(34, 197, 94, 0.25)" : "none",
                }}
              />
              <span>{isRealtime ? "Trực tiếp (3s)" : "Tạm dừng cập nhật"}</span>
            </button>

            <div style={{ height: "24px", width: "1px", backgroundColor: "#e2e8f0" }} />

            {/* Admin Profile Info */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "50%",
                  backgroundColor: "#ede9fe",
                  color: "#673ab7",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "14px",
                  fontWeight: "700",
                }}
              >
                AD
              </div>
              <div style={{ fontSize: "14px", fontWeight: "600", color: "#334155" }}>
                Quản trị viên
              </div>
            </div>

            {/* Logout Button */}
            <button
              type="button"
              onClick={handleLogoutClick}
              title="Đăng xuất khỏi hệ thống quản trị"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid #e2e8f0",
                backgroundColor: "#ffffff",
                color: "#64748b",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.color = "#dc2626";
                e.currentTarget.style.borderColor = "#fca5a5";
                e.currentTarget.style.backgroundColor = "#fef2f2";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.color = "#64748b";
                e.currentTarget.style.borderColor = "#e2e8f0";
                e.currentTarget.style.backgroundColor = "#ffffff";
              }}
            >
              <LogOut size={15} />
              <span>Đăng xuất</span>
            </button>
          </div>
        </div>
      </header>

      {/* 2. Main Dashboard Content */}
      <main style={{ maxWidth: "1200px", margin: "0 auto", padding: "28px 24px" }}>
        {/* Title Bar & Unified Action Buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "28px",
            flexWrap: "wrap",
            gap: "20px",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "26px",
                fontWeight: "700",
                color: "#0f172a",
                margin: "0 0 6px 0",
                letterSpacing: "0.2px",
              }}
            >
              Bảng Điều Khiển Dữ Liệu Nghiên Cứu
            </h1>
            <p style={{ fontSize: "15px", color: "#64748b", margin: 0 }}>
              Giám sát tiến độ thu thập phiếu, xuất dữ liệu chuẩn thống kê và đồng bộ Google Sheets
            </p>
          </div>

          {/* Unified Clean Action Toolbar */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            {/* Open Google Sheet Button */}
            <a
              href="https://docs.google.com/spreadsheets/d/1GQRr6Ogq5-mX8WR0RB22k-BlychLrNSXrK4wKPcDxgY/edit"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                backgroundColor: "#0f9d58",
                color: "#ffffff",
                padding: "9px 18px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: "600",
                boxShadow: "0 2px 6px rgba(15, 157, 88, 0.25)",
                transition: "all 0.15s ease",
              }}
              onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#0b8043")}
              onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#0f9d58")}
            >
              <FileSpreadsheet size={18} />
              <span>Mở Google Sheet</span>
              <ExternalLink size={14} style={{ opacity: 0.8 }} />
            </a>

            {/* Resync Button */}
            <button
              type="button"
              onClick={handleResyncGoogleSheets}
              disabled={isResyncing}
              title="Đồng bộ lại toàn bộ dữ liệu hiện tại sang Google Sheet"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                backgroundColor: "#ffffff",
                color: "#15803d",
                border: "1.5px solid #22c55e",
                padding: "8px 16px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: "600",
                cursor: isResyncing ? "not-allowed" : "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                transition: "all 0.15s ease",
              }}
              onMouseOver={(e) => {
                if (!isResyncing) e.currentTarget.style.backgroundColor = "#f0fdf4";
              }}
              onMouseOut={(e) => {
                if (!isResyncing) e.currentTarget.style.backgroundColor = "#ffffff";
              }}
            >
              <RefreshCw size={16} className={isResyncing ? "animate-spin" : ""} />
              <span>{isResyncing ? "Đang đồng bộ..." : "Đồng bộ lại Sheet"}</span>
            </button>

            {/* Export CSV Button */}
            <a
              href={getExportCsvUrl()}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                backgroundColor: "#673ab7",
                color: "#ffffff",
                padding: "9px 18px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: "600",
                boxShadow: "0 2px 6px rgba(103, 58, 183, 0.25)",
                transition: "all 0.15s ease",
              }}
              onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#5e35b1")}
              onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#673ab7")}
            >
              <Download size={18} />
              <span>Xuất CSV / Excel</span>
            </a>
          </div>
        </div>

        {/* 3. Stat Cards Section */}
        {stats && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "20px",
              marginBottom: "28px",
            }}
          >
            {/* Card 1: Total Submissions */}
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "14px",
                padding: "22px 24px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 2px 8px rgba(0,0,0,0.03)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                transition: "transform 0.15s ease, box-shadow 0.15s ease",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Tổng số phiếu thu thập
                  </div>
                  <div style={{ fontSize: "36px", fontWeight: "800", color: "#673ab7", marginTop: "4px" }}>
                    {stats.total_submissions.toLocaleString("vi-VN")}
                  </div>
                </div>
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "12px",
                    backgroundColor: "#f3e8ff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#673ab7",
                  }}
                >
                  <Users size={24} />
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#166534", backgroundColor: "#f0fdf4", padding: "6px 12px", borderRadius: "8px", border: "1px solid #bbf7d0" }}>
                <FileText size={15} />
                <span>Toàn bộ các ca bệnh phẩm khảo sát</span>
              </div>
            </div>

            {/* Card 2: Today Submissions */}
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "14px",
                padding: "22px 24px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 2px 8px rgba(0,0,0,0.03)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                transition: "transform 0.15s ease, box-shadow 0.15s ease",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Ghi nhận hôm nay
                  </div>
                  <div style={{ fontSize: "36px", fontWeight: "800", color: "#0284c7", marginTop: "4px" }}>
                    {stats.today_submissions.toLocaleString("vi-VN")}
                  </div>
                </div>
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "12px",
                    backgroundColor: "#e0f2fe",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#0284c7",
                  }}
                >
                  <Calendar size={24} />
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#0369a1", backgroundColor: "#f0f9ff", padding: "6px 12px", borderRadius: "8px", border: "1px solid #bae6fd" }}>
                <Clock size={15} />
                <span>Cập nhật liên tục theo múi giờ Việt Nam</span>
              </div>
            </div>

            {/* Card 3: Classification Breakdown */}
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "14px",
                padding: "22px 24px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 2px 8px rgba(0,0,0,0.03)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div style={{ fontSize: "13px", fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Phân bố Bệnh học (Lành / Ác)
                </div>
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "10px",
                    backgroundColor: "#fef3c7",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#d97706",
                  }}
                >
                  <Activity size={20} />
                </div>
              </div>

              {/* Badges row */}
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                <div
                  style={{
                    flex: 1,
                    minWidth: "75px",
                    padding: "8px 10px",
                    borderRadius: "8px",
                    backgroundColor: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "12px", color: "#166534", fontWeight: "600" }}>Lành</div>
                  <div style={{ fontSize: "18px", fontWeight: "800", color: "#15803d" }}>
                    {stats.by_classification["benign"] || 0}
                  </div>
                </div>

                <div
                  style={{
                    flex: 1,
                    minWidth: "75px",
                    padding: "8px 10px",
                    borderRadius: "8px",
                    backgroundColor: "#fffbeb",
                    border: "1px solid #fde68a",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "12px", color: "#92400e", fontWeight: "600" }}>Giáp biên</div>
                  <div style={{ fontSize: "18px", fontWeight: "800", color: "#b45309" }}>
                    {stats.by_classification["borderline"] || 0}
                  </div>
                </div>

                <div
                  style={{
                    flex: 1,
                    minWidth: "75px",
                    padding: "8px 10px",
                    borderRadius: "8px",
                    backgroundColor: "#fef2f2",
                    border: "1px solid #fecaca",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "12px", color: "#991b1b", fontWeight: "600" }}>Ác tính</div>
                  <div style={{ fontSize: "18px", fontWeight: "800", color: "#b91c1c" }}>
                    {stats.by_classification["malignant"] || 0}
                  </div>
                </div>
              </div>

              {/* Progress Proportion Bar */}
              <div style={{ width: "100%", height: "8px", borderRadius: "4px", backgroundColor: "#e2e8f0", overflow: "hidden", display: "flex" }}>
                <div style={{ width: `${benignPct}%`, backgroundColor: "#22c55e", height: "100%" }} title={`Lành tính: ${Math.round(benignPct)}%`} />
                <div style={{ width: `${borderlinePct}%`, backgroundColor: "#f59e0b", height: "100%" }} title={`Giáp biên ác: ${Math.round(borderlinePct)}%`} />
                <div style={{ width: `${malignantPct}%`, backgroundColor: "#ef4444", height: "100%" }} title={`Ác tính: ${Math.round(malignantPct)}%`} />
              </div>
            </div>
          </div>
        )}

        {/* 4. Submissions Data Table Section */}
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "14px",
            border: "1px solid #e2e8f0",
            boxShadow: "0 2px 10px rgba(0,0,0,0.03)",
            overflow: "hidden",
          }}
        >
          {/* Table Header Controls */}
          <div
            style={{
              padding: "18px 24px",
              borderBottom: "1px solid #e2e8f0",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "14px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#0f172a", margin: 0 }}>
                Danh sách phiếu khảo sát
              </h2>
              {submissionsPage && (
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: "600",
                    color: "#673ab7",
                    backgroundColor: "#f3e8ff",
                    padding: "3px 10px",
                    borderRadius: "14px",
                  }}
                >
                  {submissionsPage.total} phiếu đã ghi nhận
                </span>
              )}
            </div>

            {/* Filters and Refresh */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "14px", color: "#64748b", fontWeight: "500" }}>Lọc phân loại:</span>
                <select
                  value={classificationFilter}
                  onChange={(e) => {
                    setClassificationFilter(e.target.value);
                    setPage(1);
                  }}
                  style={{
                    padding: "7px 14px",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    fontSize: "14px",
                    fontWeight: "500",
                    color: "#334155",
                    backgroundColor: "#ffffff",
                    cursor: "pointer",
                    outline: "none",
                  }}
                >
                  <option value="">Tất cả phân loại</option>
                  <option value="benign">Lành tính</option>
                  <option value="borderline">Giáp biên ác</option>
                  <option value="malignant">Ác tính</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => loadData(true)}
                title="Làm mới bảng dữ liệu"
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#ffffff",
                  color: "#475569",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#f8fafc")}
                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#ffffff")}
              >
                <RefreshCw size={16} />
              </button>
            </div>
          </div>

          {/* Table Element */}
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
                fontSize: "14px",
              }}
            >
              <thead>
                <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#64748b" }}>
                  <th style={{ padding: "14px 18px", fontWeight: "700" }}>Mã phiếu</th>
                  <th style={{ padding: "14px 18px", fontWeight: "700" }}>Phân loại</th>
                  <th style={{ padding: "14px 18px", fontWeight: "700" }}>Phiên bản</th>
                  <th style={{ padding: "14px 18px", fontWeight: "700" }}>Thời gian gửi</th>
                  <th style={{ padding: "14px 18px", fontWeight: "700" }}>Mã định danh (UUID)</th>
                  <th style={{ padding: "14px 18px", fontWeight: "700", textAlign: "center" }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                      <RefreshCw className="animate-spin" size={24} style={{ margin: "0 auto 8px", color: "#673ab7" }} />
                      <div>Đang tải dữ liệu khảo sát...</div>
                    </td>
                  </tr>
                ) : submissionsPage && submissionsPage.items.length > 0 ? (
                  submissionsPage.items.map((sub, index) => (
                    <tr
                      key={sub.id}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        backgroundColor: index % 2 === 0 ? "#ffffff" : "#fafafa",
                        transition: "background-color 0.15s ease",
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#f1f5f9")}
                      onMouseOut={(e) => (e.currentTarget.style.backgroundColor = index % 2 === 0 ? "#ffffff" : "#fafafa")}
                    >
                      {/* Mã phiếu */}
                      <td style={{ padding: "14px 18px" }}>
                        <span
                          style={{
                            padding: "4px 10px",
                            borderRadius: "6px",
                            backgroundColor: "#f3e8ff",
                            color: "#6b21a8",
                            fontWeight: "800",
                            fontSize: "14px",
                            letterSpacing: "0.5px",
                          }}
                        >
                          {sub.reference_code}
                        </span>
                      </td>

                      {/* Phân loại */}
                      <td style={{ padding: "14px 18px" }}>
                        {getClassificationBadge(sub.classification)}
                      </td>

                      {/* Phiên bản */}
                      <td style={{ padding: "14px 18px", color: "#64748b", fontWeight: "500" }}>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: "4px",
                            backgroundColor: "#f1f5f9",
                            fontSize: "13px",
                          }}
                        >
                          v{sub.form_version}
                        </span>
                      </td>

                      {/* Thời gian */}
                      <td style={{ padding: "14px 18px", color: "#475569", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <Clock size={14} color="#94a3b8" />
                          <span>{formatLocalDateTime(sub.created_at)}</span>
                        </div>
                      </td>

                      {/* UUID với nút Copy gọn gàng */}
                      <td style={{ padding: "14px 18px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <code
                            style={{
                              fontSize: "13px",
                              backgroundColor: "#f1f5f9",
                              padding: "3px 8px",
                              borderRadius: "4px",
                              color: "#475569",
                              maxWidth: "180px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              display: "inline-block",
                            }}
                            title={sub.submission_uuid}
                          >
                            {sub.submission_uuid.slice(0, 13)}...
                          </code>
                          <button
                            type="button"
                            onClick={() => handleCopyUuid(sub.submission_uuid)}
                            title="Sao chép toàn bộ mã UUID"
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              padding: "4px",
                              color: copiedUuid === sub.submission_uuid ? "#16a34a" : "#94a3b8",
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            {copiedUuid === sub.submission_uuid ? <Check size={15} /> : <Copy size={15} />}
                          </button>
                        </div>
                      </td>

                      {/* Hành động */}
                      <td style={{ padding: "14px 18px", textAlign: "center", whiteSpace: "nowrap" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          {/* Preview Button */}
                          <button
                            type="button"
                            onClick={() => handleOpenPreview(sub.id, sub.reference_code)}
                            title="Xem lại toàn bộ phiếu trả lời trực quan"
                            disabled={previewLoading}
                            style={{
                              backgroundColor: "#eff6ff",
                              border: "1px solid #bfdbfe",
                              color: "#1d4ed8",
                              cursor: previewLoading ? "not-allowed" : "pointer",
                              padding: "6px 14px",
                              borderRadius: "6px",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              fontSize: "13px",
                              fontWeight: "600",
                              transition: "all 0.15s ease",
                            }}
                            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#dbeafe")}
                            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#eff6ff")}
                          >
                            <Eye size={15} />
                            <span>Preview</span>
                          </button>

                          {/* Delete Button */}
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null);
                              setDeletingItem({ id: sub.id, refCode: sub.reference_code });
                            }}
                            title="Xóa phiếu này khỏi hệ thống & Google Sheet"
                            style={{
                              backgroundColor: "#fef2f2",
                              border: "1px solid #fecaca",
                              color: "#dc2626",
                              cursor: "pointer",
                              padding: "6px 14px",
                              borderRadius: "6px",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              fontSize: "13px",
                              fontWeight: "600",
                              transition: "all 0.15s ease",
                            }}
                            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#fee2e2")}
                            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#fef2f2")}
                          >
                            <Trash2 size={15} />
                            <span>Xóa</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ padding: "48px 24px", textAlign: "center", color: "#64748b" }}>
                      <FileText size={36} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
                      <div style={{ fontSize: "16px", fontWeight: "600", color: "#334155", marginBottom: "4px" }}>
                        Chưa có phiếu khảo sát nào
                      </div>
                      <div style={{ fontSize: "14px" }}>
                        {classificationFilter ? "Không có phiếu nào thuộc phân loại này." : "Dữ liệu sẽ tự động xuất hiện ngay khi có người dùng hoàn thành khảo sát."}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {submissionsPage && submissionsPage.total_pages > 1 && (
            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "14px",
                color: "#64748b",
              }}
            >
              <div>
                Trang <strong>{submissionsPage.page}</strong> / <strong>{submissionsPage.total_pages}</strong> (Tổng cộng {submissionsPage.total} phiếu)
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    backgroundColor: page <= 1 ? "#f1f5f9" : "#ffffff",
                    color: page <= 1 ? "#94a3b8" : "#334155",
                    cursor: page <= 1 ? "not-allowed" : "pointer",
                    fontWeight: "600",
                    fontSize: "13px",
                  }}
                >
                  ← Trang trước
                </button>
                <button
                  type="button"
                  disabled={page >= submissionsPage.total_pages}
                  onClick={() => setPage((p) => Math.min(submissionsPage.total_pages, p + 1))}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    backgroundColor: page >= submissionsPage.total_pages ? "#f1f5f9" : "#ffffff",
                    color: page >= submissionsPage.total_pages ? "#94a3b8" : "#334155",
                    cursor: page >= submissionsPage.total_pages ? "not-allowed" : "pointer",
                    fontWeight: "600",
                    fontSize: "13px",
                  }}
                >
                  Trang sau →
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 5. Modern Delete Confirmation Modal with Blur Backdrop */}
      {deletingItem && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
            padding: "16px",
          }}
          onClick={() => {
            if (!isDeleting) setDeletingItem(null);
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "16px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              maxWidth: "460px",
              width: "100%",
              padding: "28px",
              position: "relative",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: "16px", marginBottom: "18px" }}>
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "12px",
                  backgroundColor: "#fee2e2",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  color: "#dc2626",
                }}
              >
                <AlertTriangle size={26} />
              </div>
              <div>
                <h3 style={{ margin: "0 0 6px 0", fontSize: "19px", fontWeight: "700", color: "#0f172a" }}>
                  Xác nhận xóa phiếu khảo sát
                </h3>
                <p style={{ margin: 0, fontSize: "15px", color: "#475569", lineHeight: "1.55" }}>
                  Bạn có chắc chắn muốn xóa phiếu khảo sát có mã{" "}
                  <strong style={{ color: "#dc2626", backgroundColor: "#fee2e2", padding: "2px 6px", borderRadius: "4px" }}>
                    {deletingItem.refCode}
                  </strong>
                  ?
                </p>
                <p style={{ margin: "8px 0 0 0", fontSize: "13px", color: "#64748b" }}>
                  Hành động này sẽ xóa dữ liệu khỏi máy chủ đồng thời tự động cập nhật xóa dòng tương ứng trên Google Sheet.
                </p>
              </div>
            </div>

            {deleteError && (
              <div
                style={{
                  marginBottom: "18px",
                  padding: "10px 14px",
                  backgroundColor: "#fee2e2",
                  color: "#dc2626",
                  borderRadius: "8px",
                  fontSize: "14px",
                  border: "1px solid #fca5a5",
                }}
              >
                {deleteError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "24px" }}>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeletingItem(null)}
                style={{
                  padding: "9px 18px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#ffffff",
                  color: "#475569",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: isDeleting ? "not-allowed" : "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#f8fafc")}
                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#ffffff")}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                style={{
                  padding: "9px 20px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: isDeleting ? "#f87171" : "#dc2626",
                  color: "#ffffff",
                  fontSize: "14px",
                  fontWeight: "700",
                  cursor: isDeleting ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  boxShadow: "0 2px 6px rgba(220, 38, 38, 0.3)",
                  transition: "all 0.15s ease",
                }}
                onMouseOver={(e) => {
                  if (!isDeleting) e.currentTarget.style.backgroundColor = "#b91c1c";
                }}
                onMouseOut={(e) => {
                  if (!isDeleting) e.currentTarget.style.backgroundColor = "#dc2626";
                }}
              >
                <Trash2 size={16} />
                <span>{isDeleting ? "Đang xóa..." : "Xác nhận xóa"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
