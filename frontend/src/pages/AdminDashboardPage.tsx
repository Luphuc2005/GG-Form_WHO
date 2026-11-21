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
  RefreshCw,
  Users,
  Calendar,
  Trash2,
  AlertTriangle,
  Eye,
  ArrowLeft,
  Copy,
  Check,
  Clock,
  ShieldCheck,
  FileText,
  Search,
  Printer,
  User,
  Activity,
} from "lucide-react";
import { OptionTree } from "../components/OptionTree";
import { useExcelExport, ExcelExportButton, ExcelExportStatus } from "../components/ExcelExport";

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

const AUTO_CLASSIFICATION_MAP: Record<string, string> = {
  serous_benign: "benign",
  endometrioma_benign: "benign",
  seromucinous_benign: "benign",
  fibroma: "benign",
  cellular_fibroma: "benign",
  thecoma: "benign",
  mature_teratoma: "benign",
  serous_borderline: "borderline",
  seromucinous_borderline: "borderline",
  serous_carcinoma_low_grade: "malignant",
  serous_carcinoma_high_grade: "malignant",
  endometrioid_carcinoma: "malignant",
  immature_teratoma: "malignant",
  dysgerminoma: "malignant",
  yolk_sac_tumor: "malignant",
};

function inferClientClassification(selectedIds: Set<string>, currentClassification?: string): string {
  if (currentClassification && currentClassification !== "unspecified") {
    return currentClassification;
  }
  for (const id of selectedIds) {
    if (AUTO_CLASSIFICATION_MAP[id]) return AUTO_CLASSIFICATION_MAP[id];
    if (id.includes("benign") || id.includes("lanh")) return "benign";
    if (id.includes("borderline") || id.includes("giap_bien")) return "borderline";
    if (id.includes("carcinoma") || id.includes("malignant") || id.includes("ac")) return "malignant";
  }
  return currentClassification || "unspecified";
}

function getSelectedDiagnosisList(pathologyField: any, selectedIds: Set<string>, otherTexts: Record<string, string>): string[] {
  if (!pathologyField || !pathologyField.options) return [];
  const results: string[] = [];
  function recurse(opts: any[]) {
    for (const opt of opts) {
      if (selectedIds.has(opt.id)) {
        let label = opt.label;
        if (otherTexts[opt.id]) {
          label += ` (${otherTexts[opt.id]})`;
        }
        results.push(label);
      }
      if (opt.children && Array.isArray(opt.children)) {
        recurse(opt.children);
      }
    }
  }
  recurse(pathologyField.options);
  if (results.length === 0 && otherTexts["pathology_other"]) {
    results.push(otherTexts["pathology_other"]);
  }
  return results;
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
  if (answers?.pathology?.other_text) {
    otherTexts["pathology_other"] = answers.pathology.other_text;
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
  const excelExport = useExcelExport();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [submissionsPage, setSubmissionsPage] = useState<AdminSubmissionsPage | null>(null);
  const [page, setPage] = useState(1);
    const [searchTerm, setSearchTerm] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
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
  const [showFullWhoTree, setShowFullWhoTree] = useState(false);

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
        "Yêu cầu cập nhật các phiếu đã gửi lên Google Sheet?\nTiến độ và lỗi đồng bộ được theo dõi riêng cho từng phiếu."
      )
    ) {
      return;
    }
    setIsResyncing(true);
    try {
      const res = await resyncGoogleSheets(token);
      alert(res.warning || (res.count ? `Đã xếp ${res.count} phiếu vào hàng đợi đồng bộ. Xem trạng thái từng phiếu tại trang quản lý; đây chưa phải xác nhận dữ liệu đã có trên Sheet.` : "Không có phiếu nào trong hệ thống cần gửi lên Sheet."));
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
        fetchAdminSubmissions(page, 50, token, { q: searchTerm }),
      ]);
      setLoadError("");
      setStats(statsData);
      setSubmissionsPage(subsData);
    } catch (err: any) {
      setLoadError(err.message || "Không tải được danh sách. Vui lòng thử lại.");
    } finally {
      if (showLoadingSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    loadData(true);
  }, [page, searchTerm]);

  // Real-time polling effect every 3 seconds
  useEffect(() => {
    if (!isRealtime) return;

    const interval = setInterval(() => {
      loadData(false);
    }, 3000);

    return () => clearInterval(interval);
  }, [isRealtime, page, token, searchTerm]);

  const handleLogoutClick = async () => {
    await adminLogout();
    onLogout();
  };

  const handleConfirmDelete = async () => {
    if (!deletingItem) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const reason = window.prompt("Ghi lý do hủy phiếu (ít nhất 3 ký tự). Dữ liệu và lịch sử vẫn được giữ lại:");
      if (!reason || reason.trim().length < 3) { setDeleteError("Cần ghi lý do hủy ít nhất 3 ký tự."); return; }
      await deleteAdminSubmission(deletingItem.id, token, reason.trim());
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
      case "unspecified":
      default:
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
              backgroundColor: "#f1f5f9",
              color: "#64748b",
              border: "1px solid #cbd5e1",
            }}
          >
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: "#94a3b8" }} />
            Chưa phân loại
          </span>
        );
    }
  };

  // Helper function to render a report field
  const renderField = (label: string, value: any, unit: string = "") => {
    const displayVal =
      value !== undefined && value !== null && String(value).trim() !== "" ? String(value) : "--";
    const isEmpty = displayVal === "--";
    return (
      <div
        style={{
          padding: "10px 14px",
          backgroundColor: "#f8fafc",
          borderRadius: "8px",
          border: "1px solid #e2e8f0",
        }}
      >
        <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "600", marginBottom: "4px" }}>
          {label}
        </div>
        <div style={{ fontSize: "14px", fontWeight: "700", color: isEmpty ? "#94a3b8" : "#0f172a" }}>
          {displayVal}
          {!isEmpty && unit ? ` ${unit}` : ""}
        </div>
      </div>
    );
  };

  // Helper function to render section title
  const renderSectionHeader = (roman: string, title: string) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 16px",
        backgroundColor: "#f1f5f9",
        borderRadius: "8px",
        marginBottom: "12px",
        borderLeft: "4px solid #0f766e",
      }}
    >
      <span
        style={{
          width: "24px",
          height: "24px",
          borderRadius: "6px",
          backgroundColor: "#0f766e",
          color: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: "800",
          fontSize: "12px",
        }}
      >
        {roman}
      </span>
      <span style={{ fontSize: "15px", fontWeight: "700", color: "#1e293b" }}>
        {title}
      </span>
    </div>
  );

  // =========================================================================
  // 1. CHẾ ĐỘ XEM CHI TIẾT ĐẦY ĐỦ BỆNH ÁN DÀNH CHO ADMIN
  // =========================================================================
  if (previewData && formSchema) {
    const c = previewData.detail.answers?.clinical_data || {};
    const { selectedIds, otherTexts } = extractAnswersTree(previewData.detail.answers);
    const pathologyField = formSchema.fields.find((f) => f.id === "pathology");
    const effectiveClassification = inferClientClassification(selectedIds, previewData.detail.classification);
    const selectedDiagnoses = getSelectedDiagnosisList(pathologyField, selectedIds, otherTexts);

    return (
      <div style={{ minHeight: "100vh", backgroundColor: "#f8fafc", color: "#1e293b" }}>
      {loadError && <p className="workflow-error" role="alert">{loadError}</p>}
        {/* Top Sticky Bar */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 9999,
            backgroundColor: "#115e59",
            color: "#ffffff",
            padding: "12px 24px",
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
                width: "38px",
                height: "38px",
                borderRadius: "8px",
                backgroundColor: "rgba(255,255,255,0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <FileText size={20} color="#ffffff" />
            </div>
            <div>
              <div style={{ fontSize: "17px", fontWeight: "700", letterSpacing: "0.3px" }}>
                HỒ SƠ BỆNH ÁN & GIẢI PHẪU BỆNH
              </div>
              <div style={{ fontSize: "13px", opacity: 0.9 }}>
                BN: <strong>{c.ho_ten || "Chưa rõ tên"}</strong> | Số HS:{" "}
                <strong>{c.so_hs || "--"}</strong> | Mã phiếu: <strong>{previewData.refCode}</strong> | Gửi lúc:{" "}
                {formatLocalDateTime(previewData.detail.created_at)}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              onClick={() => window.print()}
              style={{
                backgroundColor: "rgba(255,255,255,0.15)",
                color: "#ffffff",
                border: "1px solid rgba(255,255,255,0.3)",
                borderRadius: "8px",
                padding: "8px 16px",
                fontSize: "14px",
                fontWeight: "600",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <Printer size={16} />
              <span>In hồ sơ</span>
            </button>

            <button
              type="button"
              onClick={() => setPreviewData(null)}
              style={{
                backgroundColor: "#ffffff",
                color: "#115e59",
                border: "none",
                borderRadius: "8px",
                padding: "8px 18px",
                fontSize: "14px",
                fontWeight: "700",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
              }}
            >
              <ArrowLeft size={16} />
              <span>Quay lại Bảng điều khiển</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "24px 20px 60px" }}>
          {/* Hero Patient Summary Card */}
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              padding: "24px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
              marginBottom: "20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "14px",
                  background: "linear-gradient(135deg, #0f766e 0%, #115e59 100%)",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "22px",
                  fontWeight: "700",
                }}
              >
                <User size={30} />
              </div>
              <div>
                <div style={{ fontSize: "22px", fontWeight: "800", color: "#0f172a" }}>
                  {c.ho_ten ? c.ho_ten.toUpperCase() : "CHƯA CÓ HỌ TÊN"}
                </div>
                <div style={{ fontSize: "14px", color: "#64748b", marginTop: "2px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span>Số hồ sơ: <strong style={{ color: "#0284c7" }}>{c.so_hs || "--"}</strong></span>
                  <span>|</span>
                  <span>Năm sinh: <strong>{c.nam_sinh || "--"}</strong> {c.tuoi_phau_thuat ? `(${c.tuoi_phau_thuat} tuổi)` : ""}</span>
                  <span>|</span>
                  <span>Năm khám: <strong>{c.nam_kham || "--"}</strong></span>
                  <span>|</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    UUID: <code>{previewData.detail.submission_uuid.slice(0, 8)}...</code>
                    <button
                      type="button"
                      onClick={() => handleCopyUuid(previewData.detail.submission_uuid)}
                      title="Sao chép toàn bộ mã UUID"
                      style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", color: copiedUuid === previewData.detail.submission_uuid ? "#16a34a" : "#64748b" }}
                    >
                      {copiedUuid === previewData.detail.submission_uuid ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "600" }}>Phân loại u buồng trứng:</div>
                <div style={{ marginTop: "4px" }}>{getClassificationBadge(effectiveClassification)}</div>
              </div>
            </div>
          </div>

          {/* Section 1: Hành chính */}
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              padding: "20px",
              border: "1px solid #e2e8f0",
              marginBottom: "20px",
            }}
          >
            {renderSectionHeader("I", "THÔNG TIN HÀNH CHÍNH & NHÂN KHẨU HỌC")}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
              {renderField("Số hồ sơ (Số HS)", c.so_hs)}
              {renderField("Họ và tên bệnh nhân", c.ho_ten)}
              {renderField("Năm sinh", c.nam_sinh)}
              {renderField("Năm khám", c.nam_kham)}
              {renderField("Tuổi khi phẫu thuật", c.tuoi_phau_thuat, "tuổi")}
              {renderField("Địa chỉ", c.dia_chi)}
              {renderField("Nghề nghiệp", c.nghe_nghiep)}
            </div>
          </div>

          {/* Section 2: Tiền căn */}
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              padding: "20px",
              border: "1px solid #e2e8f0",
              marginBottom: "20px",
            }}
          >
            {renderSectionHeader("II", "TIỀN CĂN & ĐẶC ĐIỂM LÂM SÀNG")}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
              {renderField("PARA", c.para)}
              {renderField("Tình trạng kinh nguyệt", c.kinh_nguyet)}
              {renderField("Thời điểm phát hiện UBT", c.thoi_diem_phat_hien)}
              {renderField(
                "Tiền căn phẫu thuật UBT",
                c.tien_can_phau_thuat_ubt + (c.tien_can_phau_thuat_ubt_ghi_chu ? ` (${c.tien_can_phau_thuat_ubt_ghi_chu})` : "")
              )}
              {renderField(
                "Tiền căn ung thư khác",
                c.tien_can_ung_thu_khac + (c.tien_can_ung_thu_khac_ghi_chu ? ` (${c.tien_can_ung_thu_khac_ghi_chu})` : "")
              )}
              {renderField("Lạc nội mạc tử cung", c.tien_can_lac_nmtc)}
              {renderField("Tình trạng có thai", c.co_thai)}
              {renderField("UBT nhiễm trùng", c.ubt_nhiem_trung)}
            </div>
          </div>

          {/* Section 3: Xét nghiệm */}
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              padding: "20px",
              border: "1px solid #e2e8f0",
              marginBottom: "20px",
            }}
          >
            {renderSectionHeader("III", "XÉT NGHIỆM HUYẾT THANH (DẤU ẤN KHỐI U)")}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
              {renderField("CA 125", c.ca_125, "U/mL")}
              {renderField("HE4", c.he4, "pmol/L")}
              {renderField("ROMA", c.roma, "%")}
              {renderField("AFP", c.afp, "ng/mL")}
              {renderField("beta hCG", c.beta_hcg, "mUI/mL")}
            </div>
          </div>

          {/* Section 4: Siêu âm */}
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              padding: "20px",
              border: "1px solid #e2e8f0",
              marginBottom: "20px",
            }}
          >
            {renderSectionHeader("IV", "ĐẶC ĐIỂM HÌNH ẢNH HỌC SIÊU ÂM")}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "12px",
                marginBottom: "16px",
              }}
            >
              {renderField("Số lượng u", c.sa_so_luong_u)}
              {renderField("Mô buồng trứng", c.sa_mo_buong_trung)}
              {renderField("Phân loại u", c.sa_phan_loai_u)}
              {renderField("Phản âm", Array.isArray(c.sa_phan_am) ? c.sa_phan_am.join(", ") : c.sa_phan_am)}
              {renderField("Kích thước u", c.sa_kich_thuoc_u, "mm")}
              {renderField("Bờ ngoài", c.sa_bo_ngoai)}
              {renderField("Bờ trong", c.sa_bo_trong)}
              {renderField("Số lượng thùy", c.sa_so_luong_thuy)}
              {renderField("Kích thước phần đặc", c.sa_kich_thuoc_phan_dac, "mm")}
              {renderField("Bóng lưng", c.sa_bong_lung)}
              {renderField("Nang trong phần đặc", c.sa_nang_trong_phan_dac)}
              {renderField("Chồi", c.sa_choi)}
              {renderField("Tăng sinh mạch máu", c.sa_tang_sinh_mach_mau)}
              {renderField("Dịch ổ bụng", c.sa_dich_o_bung)}
              {renderField(
                "Tổn thương NMTC",
                c.sa_ton_thuong_nmtc + (c.sa_ton_thuong_nmtc_ghi_chu ? ` (${c.sa_ton_thuong_nmtc_ghi_chu})` : "")
              )}
              {renderField("O-RADS (Siêu âm)", c.sa_orads)}
            </div>

            {/* Khung IOTA ADNEX 6 mục con */}
            <div
              style={{
                backgroundColor: "#f5f3ff",
                border: "1.5px solid #ddd6fe",
                borderRadius: "10px",
                padding: "16px",
              }}
            >
              <div style={{ fontSize: "14px", fontWeight: "700", color: "#0f766e", marginBottom: "12px" }}>
                IOTA ADNEX — TỶ LỆ NHẬP THEO QUY ƯỚC PHIẾU NGHIÊN CỨU
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px" }}>
                {renderField("Benign tumor", c.iota_benign, "%")}
                {renderField("Malignant", c.iota_malignant, "%")}
                {renderField("Borderline", c.iota_borderline, "%")}
                {renderField("Stage I", c.iota_stage1, "%")}
                {renderField("Stage II-IV", c.iota_stage2_4, "%")}
                {renderField("Metastatic", c.iota_metastatic, "%")}
              </div>
            </div>
          </div>

          {/* Section 5: MRI */}
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              padding: "20px",
              border: "1px solid #e2e8f0",
              marginBottom: "20px",
            }}
          >
            {renderSectionHeader("V", "ĐẶC ĐIỂM CỘNG HƯỞNG TỪ (MRI)")}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "12px",
                marginBottom: "14px",
              }}
            >
              {renderField("Số lượng u", c.mri_so_luong_u)}
              {renderField("Mô buồng trứng", c.mri_mo_buong_trung)}
              {renderField("Dạng tổn thương", c.mri_dang_ton_thuong)}
              {renderField("Kích thước u", c.mri_kich_thuoc_u, "mm")}
              {renderField(
                "Dịch nang (T1w/T2w)",
                c.mri_dich_nang || `T1w: ${c.mri_dich_nang_t1w || "--"}, T2w: ${c.mri_dich_nang_t2w || "--"}`
              )}
              {renderField("Thành phần mỡ", c.mri_thanh_phan_mo)}
              {renderField("Phần đặc", c.mri_phan_dac)}
              {renderField("Kích thước phần đặc", c.mri_kich_thuoc_phan_dac, "mm")}
              {renderField("Khuếch tán", c.mri_khuech_tan)}
              {renderField("Tăng sinh mạch máu (MRI)", c.mri_tang_sinh_mach_mau)}
              {renderField("Ngấm thuốc tương phản từ", c.mri_ngam_thuoc)}
              {renderField("Hạch", c.mri_hach)}
              {renderField("Dịch ổ bụng", c.mri_dich_o_bung)}
              {renderField("Tổn thương cơ quan khác", c.mri_ton_thuong_co_quan_khac)}
            </div>
            {renderField("Kết luận hình ảnh học MRI", c.mri_ket_luan)}
          </div>

          {/* Section 6: Phẫu thuật & GPB WHO */}
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              padding: "20px",
              border: "1px solid #e2e8f0",
              marginBottom: "24px",
            }}
          >
            {renderSectionHeader("VI", "PROTOCOL PHẪU THUẬT & GIẢI PHẪU BỆNH THEO WHO")}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "12px",
                marginBottom: "20px",
              }}
            >
              {renderField("Chẩn đoán trước phẫu thuật", c.pt_chan_doan_truoc)}
              {renderField("Chẩn đoán sau phẫu thuật", c.pt_chan_doan_sau)}
              {renderField("Phương pháp phẫu thuật", c.pt_phuong_phap)}
              {renderField("Sinh thiết lạnh", c.pt_sinh_thiet_lanh === "Có" && c.pt_sinh_thiet_lanh_ghi_chu ? `Có (${c.pt_sinh_thiet_lanh_ghi_chu})` : c.pt_sinh_thiet_lanh)}
              {renderField("Mô tả tổn thương phẫu thuật", c.pt_ton_thuong || c.pt_mo_ta)}
              {renderField("UBT xoắn", c.ubt_xoan)}
              {renderField("UBT vỡ", c.ubt_vo)}
              {renderField("Dịch ổ bụng khi phẫu thuật", c.pt_dich_o_bung)}
            </div>

            {/* Thẻ Kết quả Chẩn đoán GPB WHO nổi bật */}
            <div
              style={{
                background: "#f8fafc",
                border: "1.5px solid #cbd5e1",
                borderRadius: "12px",
                padding: "20px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "14px",
                  flexWrap: "wrap",
                  gap: "10px",
                  borderBottom: "1px solid #e2e8f0",
                  paddingBottom: "12px",
                }}
              >
                <div style={{ fontSize: "15px", fontWeight: "700", color: "#0f766e", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>🔬 KẾT QUẢ PHÂN LOẠI GIẢI PHẪU BỆNH (WHO)</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "13px", color: "#64748b", fontWeight: "600" }}>Bản chất u WHO 1:</span>
                  {getClassificationBadge(effectiveClassification)}
                </div>
              </div>

              <div style={{ marginBottom: "14px" }}>
                <div style={{ fontSize: "12.5px", fontWeight: "600", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
                  Chẩn đoán mô bệnh học được chọn:
                </div>
                {selectedDiagnoses.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {selectedDiagnoses.map((diag, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: "#ffffff",
                          border: "1.5px solid #a855f7",
                          borderRadius: "8px",
                          padding: "12px 16px",
                          fontSize: "16px",
                          fontWeight: "700",
                          color: "#1e1b4b",
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                        }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "22px", height: "22px", borderRadius: "50%", background: "#ede9fe", color: "#7c3aed", fontSize: "13px" }}>✓</span>
                        <span>WHO {idx + 1}: {diag}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: "#94a3b8", fontStyle: "italic", fontSize: "14.5px" }}>
                    Chưa chọn kết quả chẩn đoán GPB
                  </div>
                )}
              </div>

              {/* Tùy chọn thu gọn / mở rộng danh mục 15 nhóm bệnh WHO */}
              {pathologyField && (
                <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px dashed #e2e8f0" }}>
                  <button
                    type="button"
                    onClick={() => setShowFullWhoTree(!showFullWhoTree)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#0f766e",
                      fontSize: "13px",
                      fontWeight: "600",
                      cursor: "pointer",
                      padding: "4px 0",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>{showFullWhoTree ? "▲ Thu gọn danh mục 15 mặt bệnh WHO" : "▼ Xem đối chiếu toàn bộ 15 mặt bệnh WHO"}</span>
                  </button>

                  {showFullWhoTree && (
                    <div
                      style={{
                        marginTop: "10px",
                        pointerEvents: "none",
                        opacity: 0.9,
                        background: "#ffffff",
                        padding: "14px",
                        borderRadius: "8px",
                        border: "1px solid #e2e8f0",
                      }}
                    >
                      <OptionTree
                        options={pathologyField.options}
                        selectedIds={selectedIds}
                        otherTexts={otherTexts}
                        onToggle={() => {}}
                        onOtherTextChange={() => {}}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Bottom Back Button */}
          <div style={{ textAlign: "center" }}>
            <button
              type="button"
              onClick={() => setPreviewData(null)}
              style={{
                cursor: "pointer",
                padding: "12px 32px",
                fontSize: "16px",
                fontWeight: "700",
                borderRadius: "8px",
                backgroundColor: "#115e59",
                color: "#ffffff",
                border: "none",
                boxShadow: "0 4px 12px rgba(94, 53, 177, 0.3)",
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

  const filteredSubmissions = submissionsPage?.items || [];

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f8fafc", color: "#1e293b" }}>
      {loadError && <p className="workflow-error" role="alert">{loadError}</p>}
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
                background: "linear-gradient(135deg, #0f766e 0%, #115e59 100%)",
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
                  color: "#0f766e",
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
              <span>[→ Đăng xuất</span>
            </button>
          </div>
        </div>
      </header>

      {/* 2. Main Dashboard Content */}
      <main style={{ maxWidth: "1200px", margin: "0 auto", padding: "28px 24px" }}>
        {/* Page Title & Action Bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: "24px",
            flexWrap: "wrap",
            gap: "16px",
          }}
        >
          <div>
            <h1 style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", margin: 0, letterSpacing: "-0.5px" }}>
              Bảng Điều Khiển Dữ Liệu Nghiên Cứu
            </h1>
            <p style={{ margin: "6px 0 0 0", color: "#64748b", fontSize: "15px" }}>
              Giám sát tiến độ thu thập phiếu, xuất dữ liệu chuẩn thống kê và đồng bộ Google Sheets
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            {/* Open Google Sheet Button */}
            {stats?.google_sheet_url && <a
              href={stats.google_sheet_url}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                backgroundColor: "#16a34a",
                color: "#ffffff",
                padding: "9px 16px",
                borderRadius: "8px",
                textDecoration: "none",
                fontSize: "14px",
                fontWeight: "600",
                boxShadow: "0 2px 6px rgba(22, 163, 74, 0.25)",
                transition: "all 0.15s ease",
              }}
              onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#15803d")}
              onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#16a34a")}
            >
              <FileText size={18} />
              <span>Mở Google Sheet ↗</span>
            </a>}

            {/* Resync Button */}
            <button
              type="button"
              onClick={handleResyncGoogleSheets}
              disabled={isResyncing}
              title="Đồng bộ lại toàn bộ dữ liệu CSDL sang Google Sheets"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                backgroundColor: "#ffffff",
                color: "#16a34a",
                border: "1.5px solid #16a34a",
                padding: "8px 16px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: "600",
                cursor: isResyncing ? "not-allowed" : "pointer",
                transition: "all 0.15s ease",
              }}
              onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#f0fdf4")}
              onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#ffffff")}
            >
              <RefreshCw size={17} className={isResyncing ? "animate-spin" : ""} />
              <span>{isResyncing ? "Đang đồng bộ..." : "Đồng bộ lại Sheet"}</span>
            </button>

            {/* Export CSV / Excel */}
            <a
              href={getExportCsvUrl()}
              download
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                backgroundColor: "#0f766e",
                color: "#ffffff",
                padding: "9px 18px",
                borderRadius: "8px",
                textDecoration: "none",
                fontSize: "14px",
                fontWeight: "600",
                boxShadow: "0 2px 6px rgba(103, 58, 183, 0.25)",
                transition: "all 0.15s ease",
              }}
              onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#115e59")}
              onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#0f766e")}
            >
              <Download size={18} />
              <span>Xuất CSV</span>
            </a>
            <ExcelExportButton control={excelExport}/>
          </div>
        </div>

        <ExcelExportStatus control={excelExport}/>
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
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Tổng số phiếu thu thập
                  </div>
                  <div style={{ fontSize: "36px", fontWeight: "800", color: "#0f766e", marginTop: "4px" }}>
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
                    color: "#0f766e",
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
                <div style={{ width: "32px", height: "32px", borderRadius: "8px", backgroundColor: "#fef3c7", display: "flex", alignItems: "center", justifyContent: "center", color: "#d97706" }}>
                  <Activity size={18} />
                </div>
              </div>

              {/* Badges Count */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "14px" }}>
                <div style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", padding: "8px", borderRadius: "8px", textAlign: "center" }}>
                  <div style={{ fontSize: "12px", color: "#166534", fontWeight: "600" }}>Lành</div>
                  <div style={{ fontSize: "20px", fontWeight: "800", color: "#16a34a" }}>
                    {stats.by_classification["benign"] || 0}
                  </div>
                </div>
                <div style={{ backgroundColor: "#fffbeb", border: "1px solid #fde68a", padding: "8px", borderRadius: "8px", textAlign: "center" }}>
                  <div style={{ fontSize: "12px", color: "#92400e", fontWeight: "600" }}>Giáp biên</div>
                  <div style={{ fontSize: "20px", fontWeight: "800", color: "#d97706" }}>
                    {stats.by_classification["borderline"] || 0}
                  </div>
                </div>
                <div style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca", padding: "8px", borderRadius: "8px", textAlign: "center" }}>
                  <div style={{ fontSize: "12px", color: "#991b1b", fontWeight: "600" }}>Ác tính</div>
                  <div style={{ fontSize: "20px", fontWeight: "800", color: "#dc2626" }}>
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
                    color: "#0f766e",
                    backgroundColor: "#f3e8ff",
                    padding: "3px 10px",
                    borderRadius: "14px",
                  }}
                >
                  {submissionsPage.total} phiếu đã ghi nhận
                </span>
              )}
            </div>

            {/* Search, Filter, and Refresh */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              {/* Search input */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  backgroundColor: "#f8fafc",
                  border: "1px solid #cbd5e1",
                  borderRadius: "8px",
                  padding: "0 10px",
                }}
              >
                <Search size={16} color="#94a3b8" />
                <input
                  type="text"
                  placeholder="Tìm Số HS, Họ tên, Mã phiếu..."
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                  style={{
                    border: "none",
                    outline: "none",
                    backgroundColor: "transparent",
                    padding: "7px 8px",
                    fontSize: "13.5px",
                    width: "210px",
                    color: "#1e293b",
                  }}
                />
              </div>


              {/* Refresh button */}
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
                  <th style={{ padding: "14px 16px", fontWeight: "700" }}>Mã phiếu</th>
                  <th style={{ padding: "14px 16px", fontWeight: "700" }}>Số HS</th>
                  <th style={{ padding: "14px 16px", fontWeight: "700" }}>Họ và tên bệnh nhân</th>
                  <th style={{ padding: "14px 16px", fontWeight: "700" }}>Năm sinh (Tuổi)</th>
                  <th style={{ padding: "14px 16px", fontWeight: "700" }}>Thời gian gửi</th>
                  <th style={{ padding: "14px 16px", fontWeight: "700", textAlign: "center" }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                      <RefreshCw className="animate-spin" size={24} style={{ margin: "0 auto 8px", color: "#0f766e" }} />
                      <div>Đang tải dữ liệu khảo sát...</div>
                    </td>
                  </tr>
                ) : filteredSubmissions.length > 0 ? (
                  filteredSubmissions.map((sub, index) => (
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
                      <td style={{ padding: "14px 16px" }}>
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

                      {/* Số HS */}
                      <td style={{ padding: "14px 16px" }}>
                        {sub.so_hs ? (
                          <span
                            style={{
                              padding: "4px 10px",
                              borderRadius: "6px",
                              backgroundColor: "#e0f2fe",
                              color: "#0369a1",
                              fontWeight: "700",
                              fontSize: "13.5px",
                            }}
                          >
                            {sub.so_hs}
                          </span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>--</span>
                        )}
                      </td>

                      {/* Họ và tên BN */}
                      <td style={{ padding: "14px 16px" }}>
                        {sub.ho_ten ? (
                          <div style={{ fontWeight: "700", color: "#0f172a", fontSize: "14.5px" }}>
                            {sub.ho_ten.toUpperCase()}
                          </div>
                        ) : (
                          <span style={{ color: "#94a3b8", fontStyle: "italic" }}>Chưa có tên</span>
                        )}
                      </td>

                      {/* Năm sinh / Tuổi */}
                      <td style={{ padding: "14px 16px", color: "#334155" }}>
                        {sub.nam_sinh ? (
                          <span style={{ fontWeight: "600" }}>
                            {sub.nam_sinh} {sub.tuoi ? `(${sub.tuoi} tuổi)` : ""}
                          </span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>--</span>
                        )}
                      </td>


                      {/* Thời gian gửi */}
                      <td style={{ padding: "14px 16px", color: "#475569", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <Clock size={14} color="#94a3b8" />
                          <span>{formatLocalDateTime(sub.created_at)}</span>
                        </div>
                      </td>

                      {/* Thao tác */}
                      <td style={{ padding: "14px 16px", textAlign: "center", whiteSpace: "nowrap" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          {/* Xem chi tiết Button */}
                          <button
                            type="button"
                            onClick={() => handleOpenPreview(sub.id, sub.reference_code)}
                            title="Xem lại toàn bộ hồ sơ bệnh án & GPB"
                            disabled={previewLoading}
                            style={{
                              backgroundColor: "#0f766e",
                              border: "none",
                              color: "#ffffff",
                              cursor: previewLoading ? "not-allowed" : "pointer",
                              padding: "6px 14px",
                              borderRadius: "6px",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              fontSize: "13px",
                              fontWeight: "600",
                              boxShadow: "0 2px 4px rgba(103, 58, 183, 0.2)",
                              transition: "all 0.15s ease",
                            }}
                            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#115e59")}
                            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#0f766e")}
                          >
                            <Eye size={15} />
                            <span>Xem chi tiết</span>
                          </button>

                          {/* Delete Button */}
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null);
                              setDeletingItem({ id: sub.id, refCode: sub.reference_code });
                            }}
                            title="Hủy phiếu và giữ lịch sử"
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
                        {searchTerm ? "Không tìm thấy phiếu nào phù hợp" : "Chưa có phiếu khảo sát nào"}
                      </div>
                      <div style={{ fontSize: "14px" }}>
                        {searchTerm
                          ? `Không có kết quả nào khớp với "${searchTerm}". Vui lòng thử từ khóa khác.`
                          : "Dữ liệu sẽ tự động xuất hiện ngay khi có người dùng hoàn thành khảo sát."}
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
                  Phiếu sẽ được hủy, giữ lại dữ liệu và lịch sử. Tác vụ gỡ khỏi Google Sheet được theo dõi và thử lại nếu lỗi.
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
