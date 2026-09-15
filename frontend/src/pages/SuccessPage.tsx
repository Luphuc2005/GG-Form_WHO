import React from "react";
import { CheckCircle2 } from "lucide-react";
import { SubmissionResponse } from "../types/submission";

interface SuccessPageProps {
  response: SubmissionResponse;
  onRestart: () => void;
  isPreview?: boolean;
}

export const SuccessPage: React.FC<SuccessPageProps> = ({ response, onRestart, isPreview }) => {
  return (
    <div className="form-container">
      <div className="form-card success-card" style={{ padding: "36px 28px" }}>
        <div className="success-badge">
          <CheckCircle2 size={32} />
          <span>Đã ghi nhận phiếu</span>
        </div>

        <p className="success-message">
          {isPreview
            ? "Biểu mẫu thử nghiệm đã được gửi và kiểm tra tính hợp lệ thành công (Chế độ xem trước - không lưu vào cơ sở dữ liệu thật)."
            : "Cảm ơn bạn đã hoàn thành biểu mẫu khảo sát giải phẫu bệnh u buồng trứng theo WHO."}
        </p>

        <div style={{ marginBottom: "10px", color: "var(--text-secondary)", fontSize: "15px" }}>
          Mã số phiếu của bạn:
        </div>

        <div className="reference-pill" style={{ fontSize: "18px", fontWeight: "700", marginBottom: "16px" }}>
          MÃ PHIẾU: {response.reference_code}
        </div>

        {response.submission_uuid && (
          <div style={{ marginBottom: "26px", color: "var(--text-secondary)", fontSize: "14px" }}>
            Mã UUID hệ thống: <span style={{ color: "#333", fontWeight: "500" }}>{response.submission_uuid}</span>
          </div>
        )}

        <div>
          <button
            type="button"
            className="btn-submit"
            onClick={onRestart}
            style={{ cursor: "pointer" }}
          >
            Gửi phản hồi khác
          </button>
        </div>
      </div>
    </div>
  );
};
