import React, { useState, useEffect } from "react";
import { FormSchemaDefinition, FormOption } from "../types/schema";
import { fetchCurrentForm, publishAdminForm } from "../api/client";
import { SurveyPage } from "./SurveyPage";
import {
  ArrowLeft,
  Eye,
  Save,
  Send,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Layers,
} from "lucide-react";

interface DevelopModePageProps {
  token?: string;
  onNavigate?: (path: string) => void;
}

const DRAFT_KEY = "develop_form_draft";

export const DevelopModePage: React.FC<DevelopModePageProps> = ({ token, onNavigate }) => {
  const [schema, setSchema] = useState<FormSchemaDefinition | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string>("serous_carcinoma_high_grade");
  const [mode, setMode] = useState<"develop" | "preview">("develop");
  const [toastMessage, setToastMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  // Load current form schema or draft
  useEffect(() => {
    const savedDraft = localStorage.getItem(DRAFT_KEY);
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        setSchema(parsed);
        return;
      } catch (e) {
        console.error("Lỗi khi đọc draft từ localStorage:", e);
      }
    }

    fetchCurrentForm()
      .then((res) => {
        setSchema(res.schema_json);
      })
      .catch((err) => {
        console.error("Không thể tải biểu mẫu hiện tại:", err);
      });
  }, []);

  const showToast = (type: "success" | "error", text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  if (!schema) {
    return (
      <div className="form-container" style={{ textAlign: "center", paddingTop: "60px" }}>
        <div>Đang tải trình thiết kế biểu mẫu...</div>
      </div>
    );
  }

  // If in Preview Mode, render the EXACT user survey interface
  if (mode === "preview") {
    return (
      <SurveyPage
        initialSchema={schema}
        isPreview={true}
        onBackToDevelop={() => setMode("develop")}
      />
    );
  }

  // Find pathology field
  const pathologyField = schema.fields.find((f) => f.id === "pathology");
  const options = pathologyField?.options || [];

  // Helper: flatten all options for dropdown selection
  const flattenOptions = (opts: FormOption[], prefix: string = ""): { id: string; label: string }[] => {
    let result: { id: string; label: string }[] = [];
    for (const opt of opts) {
      result.push({ id: opt.id, label: prefix ? `${prefix} → ${opt.label}` : opt.label });
      if (opt.children && opt.children.length > 0) {
        result = result.concat(flattenOptions(opt.children, opt.label));
      }
    }
    return result;
  };

  const allOptionsList = flattenOptions(options);

  // Find currently selected option
  const findOption = (opts: FormOption[], id: string): FormOption | null => {
    for (const opt of opts) {
      if (opt.id === id) return opt;
      if (opt.children && opt.children.length > 0) {
        const found = findOption(opt.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  const currentOption = findOption(options, selectedOptionId) || options[0];
  const hasChildren = Boolean(currentOption?.children && currentOption.children.length > 0);

  // Update an option in the tree immutably
  const updateOptionInTree = (
    opts: FormOption[],
    id: string,
    updater: (target: FormOption) => FormOption
  ): FormOption[] => {
    return opts.map((opt) => {
      if (opt.id === id) {
        return updater(opt);
      }
      if (opt.children && opt.children.length > 0) {
        return {
          ...opt,
          children: updateOptionInTree(opt.children, id, updater),
        };
      }
      return opt;
    });
  };

  // Handler: Change option label
  const handleLabelChange = (newLabel: string) => {
    if (!currentOption) return;
    const updatedOptions = updateOptionInTree(options, currentOption.id, (opt) => ({
      ...opt,
      label: newLabel,
    }));

    setSchema({
      ...schema,
      fields: schema.fields.map((f) => (f.id === "pathology" ? { ...f, options: updatedOptions } : f)),
    });
  };

  // Handler: Toggle "Có câu hỏi con"
  const handleToggleChildren = (checked: boolean) => {
    if (!currentOption) return;

    const updatedOptions = updateOptionInTree(options, currentOption.id, (opt) => {
      if (checked) {
        return {
          ...opt,
          children:
            opt.children && opt.children.length > 0
              ? opt.children
              : [
                  {
                    id: `${opt.id}_child_${Date.now()}`,
                    label: "Câu hỏi con mẫu mới",
                    numericCode: null,
                    children: [],
                  },
                ],
        };
      } else {
        return {
          ...opt,
          children: [],
        };
      }
    });

    setSchema({
      ...schema,
      fields: schema.fields.map((f) => (f.id === "pathology" ? { ...f, options: updatedOptions } : f)),
    });
  };

  // Handler: Change a child option's label
  const handleChildLabelChange = (childIndex: number, newLabel: string) => {
    if (!currentOption || !currentOption.children) return;

    const newChildren = [...currentOption.children];
    newChildren[childIndex] = {
      ...newChildren[childIndex],
      label: newLabel,
    };

    const updatedOptions = updateOptionInTree(options, currentOption.id, (opt) => ({
      ...opt,
      children: newChildren,
    }));

    setSchema({
      ...schema,
      fields: schema.fields.map((f) => (f.id === "pathology" ? { ...f, options: updatedOptions } : f)),
    });
  };

  // Handler: Add a child option
  const handleAddChild = () => {
    if (!currentOption) return;

    const newChild: FormOption = {
      id: `${currentOption.id}_sub_${Date.now()}`,
      label: `Lựa chọn con mới #${(currentOption.children?.length || 0) + 1}`,
      numericCode: null,
      children: [],
    };

    const updatedOptions = updateOptionInTree(options, currentOption.id, (opt) => ({
      ...opt,
      children: [...(opt.children || []), newChild],
    }));

    setSchema({
      ...schema,
      fields: schema.fields.map((f) => (f.id === "pathology" ? { ...f, options: updatedOptions } : f)),
    });
  };

  // Handler: Delete a child option
  const handleDeleteChild = (childIndex: number) => {
    if (!currentOption || !currentOption.children) return;

    const newChildren = currentOption.children.filter((_, idx) => idx !== childIndex);

    const updatedOptions = updateOptionInTree(options, currentOption.id, (opt) => ({
      ...opt,
      children: newChildren,
    }));

    setSchema({
      ...schema,
      fields: schema.fields.map((f) => (f.id === "pathology" ? { ...f, options: updatedOptions } : f)),
    });
  };

  // Handler: Save Draft to localStorage
  const handleSaveDraft = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(schema));
      showToast("success", "Đã lưu bản nháp vào trình duyệt thành công!");
    } catch (e: any) {
      showToast("error", "Không thể lưu nháp: " + e.message);
    }
  };

  // Handler: Publish Form to Backend
  const handlePublish = async () => {
    if (
      !window.confirm(
        "Bạn có chắc chắn muốn XUẤT BẢN phiên bản biểu mẫu này không? Phiên bản mới sẽ được kích hoạt cho toàn bộ người dùng khảo sát."
      )
    ) {
      return;
    }

    setIsPublishing(true);
    try {
      const res = await publishAdminForm(schema, token);
      localStorage.removeItem(DRAFT_KEY);
      setSchema(res.schema_json);
      showToast("success", `Xuất bản thành công phiên bản v${res.version}!`);
    } catch (err: any) {
      showToast("error", err.message || "Lỗi khi xuất bản biểu mẫu.");
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "30px 16px" }}>
      {/* Top Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate("/admin")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "#ffffff",
                border: "1px solid var(--border)",
                padding: "6px 14px",
                borderRadius: "4px",
                fontSize: "14px",
                cursor: "pointer",
                color: "var(--text-primary)",
              }}
            >
              <ArrowLeft size={16} />
              <span>Về Dashboard Admin</span>
            </button>
          )}
          <h1 style={{ fontSize: "22px", fontWeight: "600", margin: 0, color: "var(--text-primary)" }}>
            Chế độ DEVELOP (Thiết kế Form)
          </h1>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: "12px",
              fontSize: "13px",
              backgroundColor: "#e8f0fe",
              color: "#1a73e8",
              fontWeight: "600",
            }}
          >
            Form v{schema.version}
          </span>
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            marginBottom: "16px",
            padding: "10px 16px",
            borderRadius: "6px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: toastMessage.type === "success" ? "var(--success-bg)" : "var(--error-bg)",
            color: toastMessage.type === "success" ? "var(--success)" : "var(--error)",
            fontSize: "15px",
            fontWeight: "500",
            boxShadow: "0 2px 5px rgba(0,0,0,0.08)",
          }}
        >
          {toastMessage.type === "success" ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Option Selector Toolbar */}
      <div
        style={{
          backgroundColor: "#ffffff",
          padding: "14px 18px",
          borderRadius: "8px",
          marginBottom: "20px",
          border: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          boxShadow: "var(--box-shadow-subtle)",
        }}
      >
        <Layers size={18} color="var(--primary)" />
        <label style={{ fontSize: "15px", fontWeight: "600", color: "var(--text-primary)", whiteSpace: "nowrap" }}>
          Chọn câu hỏi / mục để cấu hình:
        </label>
        <select
          value={currentOption?.id || ""}
          onChange={(e) => setSelectedOptionId(e.target.value)}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: "4px",
            border: "1px solid var(--border)",
            fontSize: "15px",
            backgroundColor: "#fff",
            outline: "none",
            cursor: "pointer",
          }}
        >
          {allOptionsList.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* DEVELOP Canvas Card (matching User's ASCII Diagram) */}
      {currentOption && (
        <div
          style={{
            backgroundColor: "#ffffff",
            border: "2px solid #1a73e8",
            borderRadius: "10px",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
            overflow: "hidden",
            marginBottom: "24px",
          }}
        >
          {/* Card Header Bar */}
          <div
            style={{
              backgroundColor: "#1a73e8",
              color: "#ffffff",
              padding: "10px 20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "15px",
              fontWeight: "600",
              letterSpacing: "0.5px",
            }}
          >
            <span>DEVELOP</span>
            <span style={{ fontSize: "13px", opacity: 0.9 }}>ID: {currentOption.id}</span>
          </div>

          <div style={{ padding: "24px 28px" }}>
            {/* Câu hỏi Input */}
            <div style={{ marginBottom: "20px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "var(--text-primary)",
                  marginBottom: "8px",
                }}
              >
                Câu hỏi
              </label>
              <input
                type="text"
                value={currentOption.label}
                onChange={(e) => handleLabelChange(e.target.value)}
                placeholder="Nhập tên câu hỏi / mục giải phẫu bệnh..."
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "10px 14px",
                  fontSize: "16px",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  outline: "none",
                  transition: "border-color 0.2s",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#1a73e8")}
                onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
              />
            </div>

            {/* Type indicator */}
            <div
              style={{
                marginBottom: "18px",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                fontSize: "15px",
              }}
            >
              <span style={{ fontWeight: "600", color: "var(--text-secondary)" }}>Type:</span>
              <span
                style={{
                  backgroundColor: "#f1f3f4",
                  border: "1px solid var(--border)",
                  padding: "3px 10px",
                  borderRadius: "4px",
                  fontSize: "14px",
                  fontWeight: "600",
                }}
              >
                Checkbox
              </span>
            </div>

            {/* Checkbox: Có câu hỏi con */}
            <div style={{ marginBottom: "22px" }}>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={hasChildren}
                  onChange={(e) => handleToggleChildren(e.target.checked)}
                  style={{
                    width: "18px",
                    height: "18px",
                    cursor: "pointer",
                    accentColor: "#1a73e8",
                  }}
                />
                <span>Có câu hỏi con</span>
              </label>
            </div>

            {/* Children Section */}
            {hasChildren && (
              <div
                style={{
                  backgroundColor: "#f8f9fa",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "18px 20px",
                  marginBottom: "26px",
                }}
              >
                <div
                  style={{
                    fontSize: "15px",
                    fontWeight: "600",
                    color: "var(--text-primary)",
                    marginBottom: "12px",
                  }}
                >
                  Children:
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                  {currentOption.children?.map((child, idx) => (
                    <div
                      key={child.id || idx}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        backgroundColor: "#ffffff",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        border: "1px solid #e0e0e0",
                      }}
                    >
                      <span
                        style={{
                          fontWeight: "600",
                          fontSize: "15px",
                          color: "#5f6368",
                          minWidth: "22px",
                        }}
                      >
                        {idx + 1}.
                      </span>
                      <input
                        type="text"
                        value={child.label}
                        onChange={(e) => handleChildLabelChange(idx, e.target.value)}
                        style={{
                          flex: 1,
                          padding: "6px 10px",
                          fontSize: "15px",
                          border: "1px solid #dadce0",
                          borderRadius: "4px",
                          outline: "none",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleDeleteChild(idx)}
                        title="Xóa câu hỏi con này"
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--error)",
                          cursor: "pointer",
                          padding: "4px 6px",
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleAddChild}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    backgroundColor: "#ffffff",
                    border: "1px dashed #1a73e8",
                    color: "#1a73e8",
                    padding: "6px 14px",
                    borderRadius: "4px",
                    fontSize: "14px",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  <Plus size={16} />
                  <span>Thêm câu hỏi con</span>
                </button>
              </div>
            )}

            {/* Actions Bar: [Lưu nháp] [Preview] [Publish] */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "14px",
                paddingTop: "16px",
                borderTop: "1px solid #e0e0e0",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={handleSaveDraft}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  backgroundColor: "#ffffff",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                  padding: "9px 18px",
                  borderRadius: "6px",
                  fontSize: "15px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                <Save size={16} />
                <span>Lưu nháp</span>
              </button>

              <button
                type="button"
                onClick={() => setMode("preview")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  backgroundColor: "#1a73e8",
                  border: "none",
                  color: "#ffffff",
                  padding: "9px 20px",
                  borderRadius: "6px",
                  fontSize: "15px",
                  fontWeight: "600",
                  cursor: "pointer",
                  boxShadow: "0 1px 3px rgba(26,115,232,0.3)",
                }}
              >
                <Eye size={16} />
                <span>Preview</span>
              </button>

              <button
                type="button"
                disabled={isPublishing}
                onClick={handlePublish}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  backgroundColor: isPublishing ? "#709fe0" : "var(--primary)",
                  border: "none",
                  color: "#ffffff",
                  padding: "9px 22px",
                  borderRadius: "6px",
                  fontSize: "15px",
                  fontWeight: "600",
                  cursor: isPublishing ? "not-allowed" : "pointer",
                  marginLeft: "auto",
                }}
              >
                <Send size={16} />
                <span>{isPublishing ? "Đang xuất bản..." : "Publish"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
