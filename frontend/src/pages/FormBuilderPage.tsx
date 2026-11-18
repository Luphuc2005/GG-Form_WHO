import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  Copy,
  Eye,
  FileText,
  Info,
  List,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  ClinicalField,
  FormOption,
  FormSchemaDefinition,
} from "../types/schema";
import { workflowApi } from "../api/workflow";
import { ManagedFormPage, SECTION_NAMES } from "./ManagedFormPage";
import "../styles/admin.css";
import "../styles/form-builder.css";

interface BuilderState {
  base_version: number;
  schema: FormSchemaDefinition;
  draft: {
    revision: number;
    base_version: number;
    schema: FormSchemaDefinition;
    updated_by: string;
    updated_at: string;
  } | null;
  sheet: { status: string; error: string | null; target_version?: number };
  versions: { version: number; published_at: string; title: string }[];
}

interface Preview {
  changes: string[];
  columns: { key: string; label: string }[];
  message: string;
}

const TYPE_NAMES: Record<ClinicalField["type"], string> = {
  text: "Văn bản ngắn",
  textarea: "Văn bản dài",
  number: "Số",
  date: "Ngày",
  select: "Chọn một",
  multiselect: "Chọn nhiều",
};

const SHEET_STATUS: Record<string, string> = {
  legacy: "Chưa xuất bản cấu hình mới",
  pending: "Đang chờ cập nhật Sheet",
  syncing: "Đang cập nhật Sheet",
  synced: "Cấu trúc Sheet đã cập nhật",
  failed: "Cập nhật Sheet gặp lỗi",
  not_configured: "Chưa kết nối Sheet",
};

const WHO_CLASS_LABELS: Record<string, { label: string; tone: string }> = {
  benign: { label: "Lành tính", tone: "benign" },
  borderline: { label: "Giáp biên ác", tone: "borderline" },
  malignant: { label: "Ác tính", tone: "malignant" },
  unspecified: { label: "Chưa phân loại", tone: "other" },
};

const SECTION_ORDER = Object.keys(SECTION_NAMES);
const noChange = () => {};
const vietnamTime = (value: string) =>
  new Date(
    value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : value + "Z",
  ).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

export const FormBuilderPage: React.FC<{ onBack: () => void }> = ({
  onBack,
}) => {
  const [state, setState] = useState<BuilderState | null>(null);
  const [schema, setSchema] = useState<FormSchemaDefinition | null>(null);
  const [base, setBase] = useState(0);
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState("");
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [showMetaEditor, setShowMetaEditor] = useState(false);
  const [bulkChoicesMode, setBulkChoicesMode] = useState(false);
  const [tab, setTab] = useState<"fields" | "who" | "preview" | "versions">(
    "fields",
  );
  const [who, setWho] = useState("");
  const [whoQuery, setWhoQuery] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const dirty = Boolean(schema && saved !== JSON.stringify(schema));

  const load = async () => {
    const result = await workflowApi<BuilderState>("/admin/form-builder");
    setState(result);
    const initial = result.draft?.schema || result.schema;
    setSchema(initial);
    setSaved(JSON.stringify(initial));
    setBase(result.draft?.base_version || result.base_version);
    setRevision(result.draft?.revision || 0);
    setSelected(initial.clinical_fields?.[0]?.id || "");
    const firstWho =
      initial.fields.find((f) => f.id === "pathology")?.options?.[0]?.id || "";
    setWho(firstWho);
    setPreview(null);
    setPreviewSnapshot("");
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Reset bulk choice editor when switching selected field
  useEffect(() => {
    setBulkChoicesMode(false);
  }, [selected]);

  const fields = schema?.clinical_fields || [];
  const pathology = schema?.fields.find((f) => f.id === "pathology");
  const options = pathology?.options || [];

  const filteredFields = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("vi");
    return fields.filter((f) => {
      if (sectionFilter !== "all" && f.section !== sectionFilter) return false;
      if (!q) return true;
      return `${f.label} ${f.id}`.toLocaleLowerCase("vi").includes(q);
    });
  }, [fields, query, sectionFilter]);

  const groupedFields = useMemo(() => {
    const map = new Map<string, ClinicalField[]>();
    for (const key of SECTION_ORDER) map.set(key, []);
    for (const f of filteredFields) {
      const bucket = map.get(f.section) || [];
      bucket.push(f);
      map.set(f.section, bucket);
    }
    return Array.from(map.entries()).filter(([, items]) => items.length > 0);
  }, [filteredFields]);

  const filteredWho = useMemo(() => {
    const q = whoQuery.trim().toLocaleLowerCase("vi");
    if (!q) return options;
    return options.filter((o) =>
      `${o.label} ${o.id} ${o.numericCode ?? ""}`
        .toLocaleLowerCase("vi")
        .includes(q),
    );
  }, [options, whoQuery]);

  if (!schema || !state) {
    return (
      <div className="workflow-shell admin-workspace builder-shell">
        <div className="builder-loading-box">
          <button type="button" className="admin-secondary" onClick={onBack}>
            <ArrowLeft size={16} /> Quay lại Quản lý phiếu
          </button>
          <p
            role={error ? "alert" : "status"}
            className={error ? "workflow-error" : "builder-muted"}
          >
            {error || "Đang tải cấu hình biểu mẫu…"}
          </p>
        </div>
      </div>
    );
  }

  const payload = () => ({
    base_version: base,
    draft_revision: revision,
    schema,
  });

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await workflowApi<{ draft_revision: number }>(
        "/admin/form-builder/draft",
        {
          method: "PUT",
          body: JSON.stringify(payload()),
        },
      );
      setRevision(result.draft_revision);
      setSaved(JSON.stringify(schema));
      setNotice(
        "Đã lưu bản nháp trên máy chủ. Biểu mẫu sinh viên đang dùng chưa thay đổi.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const inspect = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await workflowApi<Preview>("/admin/form-builder/preview", {
        method: "POST",
        body: JSON.stringify(payload()),
      });
      setPreview(result);
      setPreviewSnapshot(JSON.stringify(schema));
      setTab("preview");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (previewSnapshot !== JSON.stringify(schema)) {
      setError(
        "Cấu hình đã thay đổi. Vui lòng bấm Kiểm tra & xem trước trước khi xuất bản.",
      );
      return;
    }
    if (
      !window.confirm(
        "Xuất bản phiên bản mới cho các phiếu tạo sau đó? Phiếu cũ giữ phiên bản hiện có. File Excel tải mới và Google Sheets sẽ cập nhật theo cấu hình này.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await workflowApi<{ version: number; message: string }>(
        "/admin/form-builder/publish",
        { method: "POST", body: JSON.stringify(payload()) },
      );
      await load();
      setNotice(`Đã xuất bản phiên bản v${result.version}. ${result.message}`);
      setTab("versions");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = fields.find((f) => f.id === selected);
  const fieldIndex = fields.findIndex((f) => f.id === selected);
  const activeFieldCount = fields.filter((f) => f.active).length;
  const isSystemLockedType = Boolean(
    state.schema.clinical_fields?.some((f) => f.id === field?.id),
  );
  const isSoHs = field?.id === "so_hs";

  const update = (patch: Partial<ClinicalField>) =>
    setSchema({
      ...schema,
      clinical_fields: fields.map((f) =>
        f.id === selected ? { ...f, ...patch } : f,
      ),
    });

  const option = options.find((o) => o.id === who);
  const updateOptions = (next: FormOption[]) =>
    setSchema({
      ...schema,
      fields: schema.fields.map((f) =>
        f.id === "pathology" ? { ...f, options: next } : f,
      ),
    });
  const updateWho = (patch: Partial<FormOption>) =>
    updateOptions(options.map((o) => (o.id === who ? { ...o, ...patch } : o)));

  const addField = () => {
    const targetSection = (
      sectionFilter !== "all" ? sectionFilter : "extra"
    ) as ClinicalField["section"];
    const id = `custom_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    setSchema({
      ...schema,
      clinical_fields: [
        ...fields,
        {
          id,
          label: "Câu hỏi mới",
          type: "text",
          section: targetSection,
          active: true,
          required: false,
          export: true,
          choices: [],
          help_text: "",
          min_value: null,
          max_value: null,
          show_when: null,
          show_values: [],
        },
      ],
    });
    setSelected(id);
    setQuery("");
  };

  const moveField = (direction: number) => {
    const list = [...fields];
    const i = list.findIndex((f) => f.id === selected);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setSchema({ ...schema, clinical_fields: list });
  };

  const updateChoiceAt = (index: number, value: string) => {
    if (!field) return;
    const next = [...field.choices];
    next[index] = value;
    update({ choices: next });
  };

  const removeChoiceAt = (index: number) => {
    if (!field) return;
    update({ choices: field.choices.filter((_, i) => i !== index) });
  };

  const moveChoice = (index: number, dir: number) => {
    if (!field) return;
    const target = index + dir;
    if (target < 0 || target >= field.choices.length) return;
    const next = [...field.choices];
    [next[index], next[target]] = [next[target], next[index]];
    update({ choices: next });
  };

  const addChoice = () => {
    if (!field) return;
    update({
      choices: [...field.choices, `Lựa chọn ${field.choices.length + 1}`],
    });
  };

  const addWhoOption = () => {
    const id = `custom_who_${crypto.randomUUID().slice(0, 8)}`;
    updateOptions([
      ...options,
      {
        id,
        label: "Chẩn đoán mới",
        classification: "unspecified",
        has_other_text: false,
        children: [],
      },
    ]);
    setWho(id);
    setWhoQuery("");
  };

  const isPreviewFresh = Boolean(
    preview && previewSnapshot === JSON.stringify(schema),
  );

  return (
    <div className="workflow-shell admin-workspace builder-shell">
      {/* Compact Top Bar */}
      <header className="builder-header">
        <div className="builder-header-left">
          <button
            type="button"
            className="admin-back"
            aria-label="Quay lại Quản lý phiếu"
            title="Quay lại Quản lý phiếu"
            onClick={() => {
              if (
                !dirty ||
                window.confirm("Có cấu hình chưa lưu. Bạn muốn rời trang?")
              )
                onBack();
            }}
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="builder-title-row">
              <h1>Quản lý biểu mẫu</h1>
              <span className="builder-version-pill">
                v{state.base_version}
              </span>
              <span
                className={`builder-status-pill ${dirty ? "is-dirty" : "is-saved"}`}
              >
                {dirty
                  ? "Chưa lưu thay đổi"
                  : state.draft
                    ? `Bản nháp · ${state.draft.updated_by}`
                    : "Đã lưu"}
              </span>
            </div>
            <p className="builder-subtitle">
              Chỉnh sửa câu hỏi, danh mục WHO và xuất bản phiên bản mới cho form
              nhập, Excel &amp; Google Sheets.
            </p>
          </div>
        </div>

        <div className="builder-actions">
          <button
            type="button"
            className="admin-secondary"
            disabled={busy}
            onClick={save}
          >
            <Save size={15} />
            <span>Lưu nháp</span>
            {dirty && <span className="builder-dirty-dot" aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="admin-primary"
            disabled={busy}
            onClick={inspect}
          >
            <Eye size={15} />
            <span>Kiểm tra &amp; xem trước</span>
          </button>
        </div>
      </header>

      {/* Alerts & Notices */}
      {base !== state.base_version && (
        <div className="workflow-error builder-alert-row" role="alert">
          <span>
            Bản nháp đang dựa trên v{base}, trong khi v{state.base_version} đã
            được công bố.
          </span>
          <button
            type="button"
            className="admin-secondary"
            onClick={() => {
              if (
                window.confirm(
                  "Thay nội dung đang sửa bằng cấu hình đang công bố?",
                )
              ) {
                setSchema(state.schema);
                setBase(state.base_version);
                setNotice(
                  "Đã mở cấu hình hiện hành. Bấm Lưu nháp để cập nhật bản nháp.",
                );
              }
            }}
          >
            Dùng bản đang công bố
          </button>
        </div>
      )}

      {error && (
        <p
          className="workflow-error"
          role="alert"
          style={{ whiteSpace: "pre-line" }}
        >
          {error}
        </p>
      )}

      {notice && (
        <div className="builder-notice" role="status">
          <Check size={16} />
          <span>{notice}</span>
          <button
            type="button"
            className="admin-icon"
            aria-label="Đóng thông báo"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Clean Segmented Tabs + Subtle Info Hint */}
      <div className="builder-nav-bar">
        <nav className="builder-tabs" aria-label="Quản lý cấu hình">
          <button
            type="button"
            className={tab === "fields" ? "is-active" : ""}
            onClick={() => setTab("fields")}
          >
            <span>Câu hỏi lâm sàng</span>
            <span className="builder-tab-count">
              {activeFieldCount}/{fields.length}
            </span>
          </button>
          <button
            type="button"
            className={tab === "who" ? "is-active" : ""}
            onClick={() => setTab("who")}
          >
            <span>Danh mục WHO</span>
            <span className="builder-tab-count">{options.length}</span>
          </button>
          <button
            type="button"
            className={tab === "preview" ? "is-active" : ""}
            onClick={() => setTab("preview")}
          >
            <span>Xem trước &amp; xuất bản</span>
            {isPreviewFresh && (
              <span className="builder-ready-dot" title="Sẵn sàng xuất bản" />
            )}
          </button>
          <button
            type="button"
            className={tab === "versions" ? "is-active" : ""}
            onClick={() => setTab("versions")}
          >
            <span>Phiên bản &amp; đồng bộ</span>
            <span className="builder-tab-count">v{state.base_version}</span>
          </button>
        </nav>

        <div className="builder-hint-strip">
          <Info size={14} aria-hidden="true" />
          <span>
            Mã câu hỏi và quy tắc chuyên môn (bệnh viện, mã nghiên cứu, IOTA)
            được hệ thống giữ cố định để đảm bảo an toàn dữ liệu.
          </span>
        </div>
      </div>

      <fieldset disabled={busy} className="managed-fieldset">
        {/* ============================================================ */}
        {/* TAB 1: CÂU HỎI LÂM SÀNG                                      */}
        {/* ============================================================ */}
        {tab === "fields" && (
          <>
            {/* Collapsible Form Title & Description Strip */}
            <section
              className={`builder-meta-card ${showMetaEditor ? "is-open" : ""}`}
            >
              <div className="builder-meta-bar">
                <div className="builder-meta-summary">
                  <span className="builder-meta-kicker">Tên biểu mẫu</span>
                  <strong>{schema.title || "Chưa đặt tên biểu mẫu"}</strong>
                </div>
                <button
                  type="button"
                  className="admin-secondary builder-meta-toggle"
                  aria-expanded={showMetaEditor}
                  onClick={() => setShowMetaEditor((v) => !v)}
                >
                  <Pencil size={13} />
                  <span>{showMetaEditor ? "Thu gọn" : "Sửa tên & mô tả"}</span>
                  {showMetaEditor ? (
                    <ChevronUp size={14} />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                </button>
              </div>
              {showMetaEditor && (
                <div className="builder-title-fields">
                  <label>
                    Tên biểu mẫu
                    <input
                      maxLength={200}
                      value={schema.title}
                      onChange={(e) =>
                        setSchema({ ...schema, title: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Mô tả hiển thị trên phiếu
                    <textarea
                      rows={2}
                      maxLength={1000}
                      value={schema.description || ""}
                      onChange={(e) =>
                        setSchema({ ...schema, description: e.target.value })
                      }
                    />
                  </label>
                </div>
              )}
            </section>

            {/* 2-Pane Question Workspace */}
            <div className="builder-layout">
              {/* Left Pane: Grouped & Filterable Question List */}
              <aside
                className="builder-field-list"
                aria-label="Danh sách câu hỏi"
              >
                <div className="builder-list-tools">
                  <div className="builder-list-top-row">
                    <label className="builder-search">
                      <Search size={15} aria-hidden="true" />
                      <input
                        aria-label="Tìm câu hỏi"
                        placeholder="Tìm tên hoặc mã…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      {query && (
                        <button
                          type="button"
                          className="admin-icon builder-search-clear"
                          aria-label="Xóa từ khóa"
                          onClick={() => setQuery("")}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </label>
                    <button
                      type="button"
                      className="admin-primary builder-add-btn"
                      onClick={addField}
                      title="Thêm câu hỏi mới"
                    >
                      <Plus size={15} />
                      <span>Thêm</span>
                    </button>
                  </div>

                  <select
                    aria-label="Lọc theo nhóm câu hỏi"
                    className="builder-section-filter"
                    value={sectionFilter}
                    onChange={(e) => setSectionFilter(e.target.value)}
                  >
                    <option value="all">
                      Tất cả các nhóm ({fields.length} câu)
                    </option>
                    {SECTION_ORDER.map((key) => {
                      const count = fields.filter(
                        (f) => f.section === key,
                      ).length;
                      return (
                        <option key={key} value={key}>
                          {SECTION_NAMES[key]} ({count})
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="builder-list-scroll">
                  {groupedFields.length === 0 ? (
                    <div className="builder-empty-list">
                      <p>Không tìm thấy câu hỏi nào khớp từ khóa.</p>
                      <button
                        type="button"
                        className="admin-text-button"
                        onClick={() => {
                          setQuery("");
                          setSectionFilter("all");
                        }}
                      >
                        Xem tất cả câu hỏi
                      </button>
                    </div>
                  ) : (
                    groupedFields.map(([secKey, items]) => (
                      <div key={secKey} className="builder-list-group">
                        <div className="builder-group-label">
                          <span>{SECTION_NAMES[secKey] || secKey}</span>
                          <span>{items.length}</span>
                        </div>
                        {items.map((f) => (
                          <button
                            type="button"
                            className={`builder-field-row ${selected === f.id ? "is-active" : ""} ${
                              !f.active ? "is-inactive" : ""
                            }`}
                            key={f.id}
                            onClick={() => setSelected(f.id)}
                          >
                            <div className="builder-row-main">
                              <strong>
                                {f.label || "Câu hỏi chưa đặt tên"}
                              </strong>
                              <div className="builder-row-tags">
                                <span>{TYPE_NAMES[f.type]}</span>
                                {f.required && f.active && (
                                  <span className="builder-tag-required">
                                    Bắt buộc
                                  </span>
                                )}
                                {!f.active && (
                                  <span className="builder-tag-hidden">
                                    Đang ẩn
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              </aside>

              {/* Right Pane: Intuitive Question Editor */}
              {field ? (
                <section
                  className="builder-editor"
                  aria-label="Chỉnh sửa câu hỏi"
                >
                  <div className="builder-editor-heading">
                    <div className="builder-editor-title">
                      <div className="builder-editor-badges">
                        <span className="builder-pill-section">
                          {SECTION_NAMES[field.section]}
                        </span>
                        <span className="builder-pill-type">
                          {TYPE_NAMES[field.type]}
                        </span>
                        <span
                          className="builder-pill-code"
                          title="Mã hệ thống cố định"
                        >
                          Mã: {field.id}
                        </span>
                      </div>
                      <h2>{field.label || "Câu hỏi chưa đặt tên"}</h2>
                    </div>

                    <div className="builder-reorder-group">
                      <span className="builder-position-hint">
                        Vị trí {fieldIndex + 1}/{fields.length}
                      </span>
                      <button
                        type="button"
                        className="admin-secondary builder-move-btn"
                        aria-label="Đưa câu hỏi lên"
                        title="Đưa câu hỏi lên trên"
                        disabled={fieldIndex <= 0}
                        onClick={() => moveField(-1)}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        type="button"
                        className="admin-secondary builder-move-btn"
                        aria-label="Đưa câu hỏi xuống"
                        title="Đưa câu hỏi xuống dưới"
                        disabled={fieldIndex >= fields.length - 1}
                        onClick={() => moveField(1)}
                      >
                        <ArrowDown size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Block 1: Basic Info */}
                  <div className="builder-editor-block">
                    <h3 className="builder-block-title">
                      1. Nội dung hiển thị
                    </h3>
                    <label>
                      Tên câu hỏi (hiển thị trên form &amp; cột Excel)
                      <input
                        maxLength={160}
                        value={field.label}
                        placeholder="Nhập tên câu hỏi..."
                        onChange={(e) => update({ label: e.target.value })}
                      />
                    </label>

                    <div className="builder-two">
                      <label>
                        Nhóm câu hỏi
                        <select
                          value={field.section}
                          onChange={(e) =>
                            update({
                              section: e.target
                                .value as ClinicalField["section"],
                            })
                          }
                        >
                          {Object.entries(SECTION_NAMES).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        <span>
                          Kiểu nhập liệu
                          {isSystemLockedType && (
                            <span
                              className="builder-inline-lock"
                              title="Không đổi kiểu của câu hỏi đã xuất bản"
                            >
                              <Lock size={11} /> Cố định
                            </span>
                          )}
                        </span>
                        <select
                          value={field.type}
                          disabled={isSystemLockedType}
                          onChange={(e) =>
                            update({
                              type: e.target.value as ClinicalField["type"],
                              choices: ["select", "multiselect"].includes(
                                e.target.value,
                              )
                                ? field.choices.length
                                  ? field.choices
                                  : ["Lựa chọn 1"]
                                : [],
                            })
                          }
                        >
                          {Object.entries(TYPE_NAMES).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="builder-no-margin-bottom">
                      Hướng dẫn nhập ngắn (tùy chọn)
                      <input
                        maxLength={500}
                        placeholder="Ví dụ: Đơn vị mm, ví dụ 0000..."
                        value={field.help_text}
                        onChange={(e) => update({ help_text: e.target.value })}
                      />
                    </label>
                  </div>

                  {/* Block 2: Choices (for select / multiselect) */}
                  {["select", "multiselect"].includes(field.type) && (
                    <div className="builder-editor-block">
                      <div className="builder-block-header">
                        <h3 className="builder-block-title">
                          2. Danh sách lựa chọn ({field.choices.length})
                        </h3>
                        <button
                          type="button"
                          className="admin-text-button"
                          onClick={() => setBulkChoicesMode((v) => !v)}
                        >
                          <List size={14} />
                          <span>
                            {bulkChoicesMode
                              ? "Sửa từng dòng"
                              : "Nhập nhanh nhiều dòng"}
                          </span>
                        </button>
                      </div>

                      {bulkChoicesMode ? (
                        <label className="builder-no-margin-bottom">
                          Mỗi dòng tương ứng một lựa chọn
                          <textarea
                            rows={6}
                            value={field.choices.join("\n")}
                            onChange={(e) =>
                              update({ choices: e.target.value.split("\n") })
                            }
                          />
                        </label>
                      ) : (
                        <div className="builder-choices-list">
                          {field.choices.map((choice, idx) => (
                            <div key={idx} className="builder-choice-row">
                              <span className="builder-choice-index">
                                {idx + 1}
                              </span>
                              <input
                                aria-label={`Lựa chọn ${idx + 1}`}
                                value={choice}
                                placeholder={`Nhập lựa chọn ${idx + 1}...`}
                                onChange={(e) =>
                                  updateChoiceAt(idx, e.target.value)
                                }
                              />
                              <button
                                type="button"
                                className="admin-icon"
                                aria-label="Đưa lựa chọn lên"
                                disabled={idx === 0}
                                onClick={() => moveChoice(idx, -1)}
                              >
                                <ArrowUp size={14} />
                              </button>
                              <button
                                type="button"
                                className="admin-icon"
                                aria-label="Đưa lựa chọn xuống"
                                disabled={idx === field.choices.length - 1}
                                onClick={() => moveChoice(idx, 1)}
                              >
                                <ArrowDown size={14} />
                              </button>
                              <button
                                type="button"
                                className="admin-icon builder-choice-del"
                                aria-label="Xóa lựa chọn"
                                disabled={field.choices.length <= 1}
                                onClick={() => removeChoiceAt(idx)}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="admin-secondary builder-add-choice-btn"
                            onClick={addChoice}
                          >
                            <Plus size={14} /> Thêm lựa chọn
                          </button>
                        </div>
                      )}
                      <small className="builder-block-note">
                        Các phiếu đã nhập trước đó vẫn giữ nguyên lựa chọn theo
                        phiên bản cũ.
                      </small>
                    </div>
                  )}

                  {/* Block 2b: Numeric limits (for number) */}
                  {field.type === "number" && (
                    <div className="builder-editor-block">
                      <h3 className="builder-block-title">
                        2. Giới hạn giá trị số
                        {!field.id.startsWith("custom_") && (
                          <span className="builder-inline-lock">
                            <Lock size={11} /> Theo chuẩn hệ thống
                          </span>
                        )}
                      </h3>
                      <div className="builder-two">
                        <label className="builder-no-margin-bottom">
                          Giá trị nhỏ nhất
                          <input
                            type="number"
                            placeholder="Không giới hạn"
                            disabled={!field.id.startsWith("custom_")}
                            value={field.min_value ?? ""}
                            onChange={(e) =>
                              update({
                                min_value:
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <label className="builder-no-margin-bottom">
                          Giá trị lớn nhất
                          <input
                            type="number"
                            placeholder="Không giới hạn"
                            disabled={!field.id.startsWith("custom_")}
                            value={field.max_value ?? ""}
                            onChange={(e) =>
                              update({
                                max_value:
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Block 3: Visibility & Export Controls */}
                  <div className="builder-editor-block">
                    <h3 className="builder-block-title">
                      {["select", "multiselect", "number"].includes(field.type)
                        ? "3."
                        : "2."}{" "}
                      Hiển thị &amp; xuất dữ liệu
                      {isSoHs && (
                        <span className="builder-inline-lock">
                          <Lock size={11} /> Trường định danh bắt buộc
                        </span>
                      )}
                    </h3>

                    <div className="builder-toggle-list">
                      <label
                        className={`builder-toggle-card ${field.active ? "is-checked" : ""}`}
                      >
                        <input
                          type="checkbox"
                          disabled={isSoHs}
                          checked={field.active}
                          onChange={(e) => update({ active: e.target.checked })}
                        />
                        <div>
                          <strong>Hiển thị trên form nhập liệu</strong>
                          <small>
                            Tắt mục này để ngừng hỏi ở các phiếu mới. Dữ liệu
                            của phiếu cũ không bị mất.
                          </small>
                        </div>
                      </label>

                      <label
                        className={`builder-toggle-card ${field.required ? "is-checked" : ""}`}
                      >
                        <input
                          type="checkbox"
                          disabled={isSoHs}
                          checked={field.required}
                          onChange={(e) =>
                            update({ required: e.target.checked })
                          }
                        />
                        <div>
                          <strong>Bắt buộc nhập trước khi gửi</strong>
                          <small>
                            Người nhập phải điền thông tin cho ô này mới có thể
                            gửi phiếu.
                          </small>
                        </div>
                      </label>

                      <label
                        className={`builder-toggle-card ${field.export ? "is-checked" : ""}`}
                      >
                        <input
                          type="checkbox"
                          disabled={isSoHs}
                          checked={field.export}
                          onChange={(e) => update({ export: e.target.checked })}
                        />
                        <div>
                          <strong>Xuất cột ra Google Sheets và Excel</strong>
                          <small>
                            Bỏ chọn sẽ gỡ cột tương ứng trên Sheet khi đồng bộ
                            cấu trúc phiên bản mới.
                          </small>
                        </div>
                      </label>
                    </div>

                    {field.show_when && (
                      <div className="builder-condition-pill">
                        <Info size={14} />
                        <span>
                          Câu hỏi điều kiện: chỉ hiển thị khi{" "}
                          <strong>
                            {fields.find((f) => f.id === field.show_when)
                              ?.label || field.show_when}
                          </strong>{" "}
                          có giá trị:{" "}
                          <strong>{field.show_values.join(", ")}</strong>.
                        </span>
                      </div>
                    )}
                  </div>
                </section>
              ) : (
                <section className="builder-editor builder-editor-empty">
                  <p>
                    Chọn một câu hỏi ở cột bên trái để chỉnh sửa, hoặc bấm{" "}
                    <strong>+ Thêm</strong> để tạo câu hỏi mới.
                  </p>
                </section>
              )}
            </div>
          </>
        )}

        {/* ============================================================ */}
        {/* TAB 2: DANH MỤC GIẢI PHẪU BỆNH WHO                           */}
        {/* ============================================================ */}
        {tab === "who" && (
          <div className="builder-layout">
            <aside
              className="builder-field-list"
              aria-label="Danh sách chẩn đoán WHO"
            >
              <div className="builder-list-tools">
                <div className="builder-list-top-row">
                  <label className="builder-search">
                    <Search size={15} aria-hidden="true" />
                    <input
                      aria-label="Tìm chẩn đoán WHO"
                      placeholder="Tìm tên hoặc mã ICD-O…"
                      value={whoQuery}
                      onChange={(e) => setWhoQuery(e.target.value)}
                    />
                    {whoQuery && (
                      <button
                        type="button"
                        className="admin-icon builder-search-clear"
                        aria-label="Xóa từ khóa"
                        onClick={() => setWhoQuery("")}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </label>
                  <button
                    type="button"
                    className="admin-primary builder-add-btn"
                    onClick={addWhoOption}
                  >
                    <Plus size={15} />
                    <span>Thêm</span>
                  </button>
                </div>
              </div>

              <div className="builder-list-scroll">
                {filteredWho.map((o) => {
                  const cls =
                    WHO_CLASS_LABELS[o.classification || "unspecified"] ||
                    WHO_CLASS_LABELS.unspecified;
                  return (
                    <button
                      type="button"
                      className={`builder-field-row ${who === o.id ? "is-active" : ""}`}
                      key={o.id}
                      onClick={() => setWho(o.id)}
                    >
                      <div className="builder-row-main">
                        <strong>{o.label}</strong>
                        <div className="builder-row-tags">
                          <span
                            className={`builder-who-dot tone-${cls.tone}`}
                          />
                          <span>{cls.label}</span>
                          {o.numericCode && (
                            <span className="builder-who-code">
                              {o.numericCode}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="builder-editor">
              {option ? (
                <>
                  <div className="builder-editor-heading">
                    <div className="builder-editor-title">
                      <div className="builder-editor-badges">
                        <span className="builder-pill-section">
                          Danh mục WHO
                        </span>
                        <span className="builder-pill-code">
                          Mã: {option.id}
                        </span>
                      </div>
                      <h2>{option.label || "Chẩn đoán chưa đặt tên"}</h2>
                    </div>
                  </div>

                  <div className="builder-editor-block">
                    <p
                      className="builder-block-note"
                      style={{ marginTop: 0, marginBottom: 14 }}
                    >
                      Thay đổi ở danh mục WHO áp dụng cho các phiếu tạo mới sau
                      khi xuất bản. Kết quả của phiếu cũ được giữ nguyên.
                    </p>

                    <label>
                      Tên chẩn đoán
                      <input
                        value={option.label}
                        maxLength={300}
                        onChange={(e) => updateWho({ label: e.target.value })}
                      />
                    </label>

                    <div className="builder-two">
                      <label>
                        Phân loại bản chất u
                        <select
                          value={option.classification || "unspecified"}
                          onChange={(e) =>
                            updateWho({ classification: e.target.value })
                          }
                        >
                          <option value="unspecified">Chưa phân loại</option>
                          <option value="benign">Lành tính</option>
                          <option value="borderline">Giáp biên ác</option>
                          <option value="malignant">Ác tính</option>
                        </select>
                      </label>
                      <label>
                        Mã ICD-O
                        <input
                          value={option.numericCode ?? ""}
                          maxLength={50}
                          placeholder="Ví dụ: 8441/3"
                          onChange={(e) =>
                            updateWho({ numericCode: e.target.value })
                          }
                        />
                      </label>
                    </div>

                    <div
                      className="builder-toggle-list"
                      style={{ marginTop: 14 }}
                    >
                      <label
                        className={`builder-toggle-card ${
                          option.has_other_text ? "is-checked" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(option.has_other_text)}
                          onChange={(e) =>
                            updateWho({ has_other_text: e.target.checked })
                          }
                        />
                        <div>
                          <strong>Cho phép ghi thêm nội dung khác</strong>
                          <small>
                            Hiện thêm ô nhập văn bản khi người dùng chọn mục
                            chẩn đoán này.
                          </small>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="builder-danger-footer">
                    <button
                      type="button"
                      className="admin-text-button danger"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Bỏ "${option.label}" khỏi phiên bản biểu mẫu mới?`,
                          )
                        )
                          return;
                        const remaining = options.filter((o) => o.id !== who);
                        updateOptions(remaining);
                        setWho(remaining[0]?.id || "");
                      }}
                    >
                      <Trash2 size={15} />
                      <span>Bỏ chẩn đoán này khỏi phiên bản mới</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="builder-editor-empty">
                  <p>
                    Chọn một chẩn đoán bên trái để sửa hoặc bấm{" "}
                    <strong>+ Thêm</strong> để tạo mới.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 3: XEM TRƯỚC & XUẤT BẢN                                  */}
        {/* ============================================================ */}
        {tab === "preview" && (
          <>
            <section className="builder-review">
              <div className="builder-review-header">
                <div>
                  <h2>Xem trước &amp; xuất bản phiên bản mới</h2>
                  <p className="builder-muted">
                    {isPreviewFresh
                      ? preview!.message
                      : "Kiểm tra lại danh sách thay đổi và cấu trúc cột Excel / Google Sheets trước khi xuất bản."}
                  </p>
                </div>
                {isPreviewFresh ? (
                  <button
                    type="button"
                    className="admin-primary"
                    onClick={publish}
                  >
                    <Upload size={16} />
                    <span>Xuất bản phiên bản mới</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="admin-primary"
                    onClick={inspect}
                  >
                    <Eye size={16} />
                    <span>Kiểm tra &amp; xem trước</span>
                  </button>
                )}
              </div>

              {isPreviewFresh && (
                <div className="builder-review-details">
                  <div className="builder-changes-box">
                    <strong>Thay đổi so với v{state.base_version}</strong>
                    <ul>
                      {preview!.changes.length ? (
                        preview!.changes.map((c, i) => <li key={i}>{c}</li>)
                      ) : (
                        <li>
                          Không thay đổi câu hỏi; vẫn có thể xuất bản tên hoặc
                          mô tả mới.
                        </li>
                      )}
                    </ul>
                  </div>

                  <details className="builder-columns-details">
                    <summary>
                      Xem danh sách {preview!.columns.length} cột xuất chung cho
                      Google Sheets và Excel
                    </summary>
                    <ol>
                      {preview!.columns.map((c) => (
                        <li key={c.key}>
                          <span>{c.label}</span> <code>{c.key}</code>
                        </li>
                      ))}
                    </ol>
                  </details>
                </div>
              )}
            </section>

            <div className="builder-form-preview">
              <p className="builder-preview-label">
                <Eye size={14} /> BẢN XEM TRƯỚC TRỰC QUAN · Không lưu bệnh án
                hoặc gửi dữ liệu lên Sheet
              </p>
              <ManagedFormPage
                key={JSON.stringify(schema)}
                initialAnswers={{
                  clinical_data: {},
                  pathology: { selected: [] },
                  classification: "unspecified",
                }}
                schema={schema}
                readOnly={false}
                busy={false}
                onDraftChange={noChange}
                onSubmit={async () =>
                  setNotice(
                    "Đây là bản xem trước. Không có bệnh án nào được gửi.",
                  )
                }
                submitLabel="Thử gửi trong bản xem trước"
              />
            </div>
          </>
        )}

        {/* ============================================================ */}
        {/* TAB 4: PHIÊN BẢN & ĐỒNG BỘ                                   */}
        {/* ============================================================ */}
        {tab === "versions" && (
          <div className="builder-versions">
            <section className="builder-review">
              <h2>
                <Cloud size={18} />
                <span>Đồng bộ cấu trúc Google Sheets</span>
              </h2>
              <div className="builder-sheet-status-row">
                <span
                  className={`builder-sheet-badge status-${state.sheet.status}`}
                >
                  <span />
                  {SHEET_STATUS[state.sheet.status] || state.sheet.status}
                  {state.sheet.target_version
                    ? ` · v${state.sheet.target_version}`
                    : ""}
                </span>
              </div>
              {state.sheet.error && (
                <p className="workflow-error">{state.sheet.error}</p>
              )}
              <div className="builder-actions" style={{ margin: "14px 0" }}>
                <button
                  type="button"
                  className="admin-secondary"
                  onClick={async () => {
                    try {
                      const result = await workflowApi<BuilderState>(
                        "/admin/form-builder",
                      );
                      setState(result);
                      setNotice("Đã cập nhật trạng thái đồng bộ Sheet.");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <RefreshCw size={15} /> Cập nhật trạng thái
                </button>
                <button
                  type="button"
                  className="admin-secondary"
                  onClick={async () => {
                    try {
                      await workflowApi("/admin/form-builder/retry-sheet", {
                        method: "POST",
                      });
                      setState({
                        ...state,
                        sheet: {
                          ...state.sheet,
                          status: "pending",
                          error: null,
                        },
                      });
                      setNotice(
                        "Đã đưa yêu cầu đồng bộ cấu trúc cột vào hàng đợi.",
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <Cloud size={15} /> Thử lại đồng bộ cột
                </button>
              </div>
              <p className="builder-muted">
                Sau khi cập nhật cột, các phiếu đã gửi được đối chiếu tự động
                qua hàng đợi. File Excel đã tải về máy trước đó không tự đổi;
                tải lại file mới để lấy cấu trúc mới nhất.
              </p>
            </section>

            <section className="builder-review">
              <h2>
                <FileText size={18} />
                <span>Các phiên bản đã công bố ({state.versions.length})</span>
              </h2>
              <div className="builder-version-list">
                {state.versions.map((v) => (
                  <article className="builder-version" key={v.version}>
                    <div className="builder-version-info">
                      <div className="builder-version-head">
                        <strong>Phiên bản v{v.version}</strong>
                        {v.version === state.base_version && (
                          <span className="builder-active-badge">
                            Đang sử dụng
                          </span>
                        )}
                      </div>
                      <span>{v.title}</span>
                      <small>
                        {v.published_at
                          ? vietnamTime(v.published_at)
                          : "Phiên bản ban đầu"}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="admin-secondary"
                      onClick={async () => {
                        if (
                          dirty &&
                          !window.confirm(
                            "Thay cấu hình chưa lưu bằng bản sao phiên bản này?",
                          )
                        ) {
                          return;
                        }
                        try {
                          const old = await workflowApi<{
                            schema_json: FormSchemaDefinition;
                          }>(`/forms/${v.version}`);
                          const source = old.schema_json.clinical_fields
                            ? old.schema_json
                            : {
                                ...old.schema_json,
                                clinical_fields: state.schema.clinical_fields,
                              };
                          const oldIds = new Set(
                            source.clinical_fields?.map((f) => f.id),
                          );
                          setSchema({
                            ...source,
                            version: state.base_version,
                            clinical_fields: [
                              ...(source.clinical_fields || []),
                              ...(state.schema.clinical_fields || [])
                                .filter((f) => !oldIds.has(f.id))
                                .map((f) => ({ ...f, active: false })),
                            ],
                          });
                          setBase(state.base_version);
                          setPreview(null);
                          setTab("fields");
                          setNotice(
                            "Đã sao chép cấu hình để chỉnh sửa. Kiểm tra & xuất bản để tạo phiên bản mới.",
                          );
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <Copy size={14} /> Sao chép để sửa
                    </button>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}
      </fieldset>
    </div>
  );
};
