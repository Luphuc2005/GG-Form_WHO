import React, { useEffect, useState } from "react";
import { FormSchemaDefinition } from "../types/schema";
import { fetchCurrentForm } from "../api/client";
import { FormHeader } from "../components/FormHeader";
import { FormCard } from "../components/FormCard";
import { OptionTree } from "../components/OptionTree";
import { ClassificationRadio } from "../components/ClassificationRadio";
import { useSurveyForm } from "../hooks/useSurveyForm";
import { SuccessPage } from "./SuccessPage";
import { AlertTriangle, Loader2, Eye, ArrowLeft } from "lucide-react";

interface SurveyPageProps {
  initialSchema?: FormSchemaDefinition;
  isPreview?: boolean;
  onBackToDevelop?: () => void;
}

export const SurveyPage: React.FC<SurveyPageProps> = ({
  initialSchema,
  isPreview = false,
  onBackToDevelop,
}) => {
  const [schema, setSchema] = useState<FormSchemaDefinition | null>(initialSchema || null);
  const [loading, setLoading] = useState(!initialSchema);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (initialSchema) {
      setSchema(initialSchema);
      setLoading(false);
      return;
    }

    fetchCurrentForm()
      .then((res) => {
        setSchema(res.schema_json);
        setLoading(false);
      })
      .catch((err) => {
        setLoadError(err.message || "Không thể kết nối đến máy chủ.");
        setLoading(false);
      });
  }, [initialSchema]);

  const {
    selectedIds,
    otherTexts,
    classification,
    errors,
    isSubmitting,
    submissionResponse,
    handleToggle,
    handleOtherTextChange,
    handleClassificationChange,
    handleSubmit,
    handleRestart,
    clearDraft,
  } = useSurveyForm(schema, isPreview);

  if (loading) {
    return (
      <div className="form-container" style={{ textAlign: "center", paddingTop: "60px" }}>
        <Loader2 className="animate-spin" size={36} color="var(--primary)" style={{ margin: "0 auto 12px" }} />
        <div style={{ color: "var(--text-secondary)" }}>Đang tải biểu mẫu khảo sát...</div>
      </div>
    );
  }

  if (loadError || !schema) {
    return (
      <div className="form-container">
        <div className="form-card has-error" style={{ textAlign: "center", padding: "36px 20px" }}>
          <AlertTriangle size={36} color="var(--error)" style={{ margin: "0 auto 12px" }} />
          <h2 style={{ fontSize: "18px", marginBottom: "8px" }}>Không thể tải khảo sát</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: "16px" }}>{loadError}</p>
          <button
            type="button"
            className="btn-submit"
            onClick={() => window.location.reload()}
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  if (submissionResponse) {
    return (
      <div>
        {isPreview && (
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 9999,
              backgroundColor: "#1a73e8",
              color: "#ffffff",
              padding: "10px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", fontWeight: "600", fontSize: "16px" }}>
              <Eye size={20} />
              <span>CHẾ ĐỘ XEM TRƯỚC (PREVIEW MODE) — GIAO DIỆN THỰC TẾ NGƯỜI DÙNG</span>
            </div>
            {onBackToDevelop && (
              <button
                type="button"
                onClick={onBackToDevelop}
                style={{
                  backgroundColor: "#ffffff",
                  color: "#1a73e8",
                  border: "none",
                  borderRadius: "4px",
                  padding: "8px 16px",
                  fontSize: "15px",
                  fontWeight: "600",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <ArrowLeft size={16} />
                <span>Quay lại DEVELOP</span>
              </button>
            )}
          </div>
        )}
        <SuccessPage response={submissionResponse} onRestart={handleRestart} isPreview={isPreview} />
      </div>
    );
  }

  const pathologyField = schema.fields.find((f) => f.id === "pathology");
  const classificationField = schema.fields.find((f) => f.id === "classification");

  return (
    <div>
      {isPreview && (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 9999,
            backgroundColor: "#1a73e8",
            color: "#ffffff",
            padding: "10px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", fontWeight: "600", fontSize: "16px" }}>
            <Eye size={20} />
            <span>CHẾ ĐỘ XEM TRƯỚC (PREVIEW MODE) — GIAO DIỆN THỰC TẾ NGƯỜI DÙNG</span>
          </div>
          {onBackToDevelop && (
            <button
              type="button"
              onClick={onBackToDevelop}
              style={{
                backgroundColor: "#ffffff",
                color: "#1a73e8",
                border: "none",
                borderRadius: "4px",
                padding: "8px 16px",
                fontSize: "15px",
                fontWeight: "600",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <ArrowLeft size={16} />
              <span>Quay lại DEVELOP</span>
            </button>
          )}
        </div>
      )}
      <div className="form-container">
        <form onSubmit={handleSubmit} noValidate>
          {/* Header Section */}
          <FormHeader
            title={schema.title}
            description={schema.description}
            hasRequiredFields={true}
          />

        {/* Section 1: Giải phẫu bệnh */}
        {pathologyField && (
          <FormCard
            id={pathologyField.id}
            title={pathologyField.label}
            required={pathologyField.required}
            error={errors.pathology}
          >
            <OptionTree
              options={pathologyField.options}
              selectedIds={selectedIds}
              otherTexts={otherTexts}
              onToggle={handleToggle}
              onOtherTextChange={handleOtherTextChange}
            />
          </FormCard>
        )}

        {/* Section 2: Lành/Ác */}
        {classificationField && (
          <FormCard
            id={classificationField.id}
            title={classificationField.label}
            required={classificationField.required}
            error={errors.classification}
          >
            <ClassificationRadio
              options={classificationField.options}
              selectedValue={classification}
              onChange={handleClassificationChange}
            />
          </FormCard>
        )}

        {/* General Submission Error Alert */}
        {errors.submit && (
          <div
            className="form-card has-error"
            style={{
              backgroundColor: "var(--error-bg)",
              color: "var(--error)",
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <AlertTriangle size={18} />
            <span>{errors.submit}</span>
          </div>
        )}

        {/* Bottom Actions */}
        <div className="form-actions">
          <button
            type="submit"
            className="btn-submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? "Đang gửi..." : "Gửi"}
          </button>

          <button
            type="button"
            className="btn-clear"
            onClick={clearDraft}
            disabled={isSubmitting}
          >
            Xóa hết câu trả lời
          </button>
        </div>
      </form>
    </div>
    </div>
  );
};

