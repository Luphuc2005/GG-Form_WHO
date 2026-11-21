import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, FileText, Send, Trash2 } from "lucide-react";
import type { ComprehensiveFormPageProps } from "./ComprehensiveFormPage";
import { ClinicalField } from "../types/schema";
import { matchesFieldCondition } from "../utils/fieldConditions";
import { RecordAnswers, workflowApi } from "../api/workflow";
import "../styles/form-builder.css";
import {
  WhoResultsFields,
  whoValueAt,
  buildWhoPathology,
} from "../components/WhoResultsFields";

export const SECTION_NAMES: Record<string, string> = {
  sec1: "Hành chính",
  sec2: "Tiền sử & lâm sàng",
  sec3: "Dấu ấn sinh học",
  sec4: "Siêu âm",
  sec5: "Cộng hưởng từ",
  sec6: "Phẫu thuật",
  extra: "Thông tin bổ sung",
};
const SECTION_MARKERS: Record<string, string> = {
  sec1: "I", sec2: "II", sec3: "III", sec4: "IV", sec5: "V", sec6: "VI", extra: "+",
};
const SECTION_SHORT_NAMES: Record<string, string> = {
  sec1: "Hành chính", sec2: "Lâm sàng", sec3: "Markers", sec4: "Siêu âm", sec5: "MRI", sec6: "Phẫu thuật", extra: "Bổ sung",
};
const filled = (v: unknown) =>
  v !== undefined &&
  v !== null &&
  v !== "" &&
  (!Array.isArray(v) || v.length > 0);
const IOTA = [
  "iota_benign",
  "iota_malignant",
  "iota_borderline",
  "iota_stage1",
  "iota_stage2_4",
  "iota_metastatic",
];

export const ManagedFormPage: React.FC<ComprehensiveFormPageProps> = ({
  initialAnswers,
  schema,
  readOnly,
  busy,
  onDraftChange,
  onSubmit,
  submitLabel = "Gửi phiếu",
  compact = false,
  identityVersion = 2,
  studyCode,
  saveStatus,
}) => {
  const fields = schema.clinical_fields || [];
  const [form, setForm] = useState<Record<string, any>>(() => ({
    hospital_code: "",
    study_phase: "",
    encounter_code: "",
    ...Object.fromEntries(
      fields.map((f) => [f.id, f.type === "multiselect" ? [] : ""]),
    ),
    ...initialAnswers.clinical_data,
  }));
  const [diagnosis, setDiagnosis] = useState(whoValueAt(initialAnswers, 1).id);
  const [other, setOther] = useState(whoValueAt(initialAnswers, 1).other);
  const [secondDiagnosis, setSecondDiagnosis] = useState(
    whoValueAt(initialAnswers, 2).id,
  );
  const [secondOther, setSecondOther] = useState(
    whoValueAt(initialAnswers, 2).other,
  );
  const [error, setError] = useState("");
  const [identity, setIdentity] = useState<{
    hospitals: Record<string, string>;
    phases: Record<string, string>;
  }>({ hospitals: {}, phases: {} });
  const [identityError, setIdentityError] = useState("");
  const navigationRef = useRef<HTMLElement>(null);
  const [activeSection, setActiveSection] = useState(compact ? "sec1" : "identity");
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      [...Object.keys(SECTION_NAMES), "who"].map((k) => [k, !compact || k === "sec1"]),
    ),
  );
  const options =
    schema.fields.find((f) => f.id === "pathology")?.options || [];
  const selected = options.find((o) => o.id === diagnosis);
  const answers = useMemo<RecordAnswers>(
    () => ({
      clinical_data: form,
      classification: selected?.classification || "unspecified",
      pathology: buildWhoPathology(
        [
          { id: diagnosis, other },
          { id: secondDiagnosis, other: secondOther },
        ],
        options,
      ),
    }),
    [form, diagnosis, other, secondDiagnosis, secondOther, selected, options],
  );
  useEffect(() => {
    workflowApi<{ research_identity: typeof identity }>(
      "/forms/clinical-contract",
    )
      .then((c) => setIdentity(c.research_identity))
      .catch(() =>
        setIdentityError(
          "Chưa tải được danh mục bệnh viện. Vui lòng tải lại trang.",
        ),
      );
  }, []);
  useEffect(() => {
    if (!readOnly) onDraftChange(answers);
  }, [answers, onDraftChange, readOnly]);
  const visible = (f: ClinicalField) =>
    (matchesFieldCondition(f, form) || filled(form[f.id])) &&
    (f.active || filled(form[f.id]));
  const activeFields = fields.filter((f) => f.active && visible(f));
  const count =
    activeFields.filter((f) => filled(form[f.id])).length +
    Number(Boolean(diagnosis)) +
    Number(Boolean(secondDiagnosis));
  const total = activeFields.length + 2;
  const change = (id: string, value: any) => {
    setError("");
    setForm((previous) => {
      const next = { ...previous, [id]: value };
      for (const field of fields) {
        if (field.active && field.show_when === id && !matchesFieldCondition(field, next)) {
          next[field.id] = field.type === "multiselect" ? [] : "";
        }
      }
      if (filled(value) && next.missing_reasons) {
        next.missing_reasons = { ...next.missing_reasons };
        delete next.missing_reasons[id];
      }
      if (id === "iota_malignant" && fields.some((f) => f.id === id && f.type === "number")) next.sa_iota_adnex = value;
      if (id === "mri_dich_nang_t1w" || id === "mri_dich_nang_t2w")
        next.mri_dich_nang = `T1w: ${next.mri_dich_nang_t1w || ""}, T2w: ${next.mri_dich_nang_t2w || ""}`;
      return next;
    });
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (readOnly || busy) return;
    try {
      await onSubmit(answers);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const control = (field: ClinicalField) => {
    const value = form[field.id] ?? "";
    const disabled = readOnly || busy || !field.active;
    const props = {
      id: `managed-${field.id}`,
      name: field.id,
      disabled,
      "aria-label": field.label,
      "aria-describedby": field.help_text ? `hint-${field.id}` : undefined,
    };
    if (field.type === "select")
      return (
        <select
          {...props}
          className="form-select"
          value={value}
          onChange={(e) => change(field.id, e.target.value)}
        >
          <option value="">-- Chọn --</option>
          {field.choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          {filled(value) && !field.choices.includes(String(value)) && (
            <option value={value}>{value} (đã lưu)</option>
          )}
        </select>
      );
    if (field.type === "multiselect") {
      const values: string[] = Array.isArray(value)
        ? value
        : String(value).split(/,\s*/).filter(Boolean);
      return (
        <div className="managed-checks" role="group" aria-label={field.label}>
          {[...new Set([...field.choices, ...values])].map((c) => (
            <label key={c}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={values.includes(c)}
                onChange={(e) =>
                  change(
                    field.id,
                    e.target.checked
                      ? [...values, c]
                      : values.filter((v) => v !== c),
                  )
                }
              />
              {c}
              {!field.choices.includes(c) ? " (đã lưu)" : ""}
            </label>
          ))}
        </div>
      );
    }
    if (field.type === "textarea")
      return (
        <textarea
          {...props}
          className="form-input"
          rows={3}
          maxLength={4000}
          value={value}
          onChange={(e) => change(field.id, e.target.value)}
        />
      );
    return (
      <input
        {...props}
        className="form-input"
        type={field.type}
        step={field.type === "number" ? "any" : undefined}
        min={field.min_value ?? undefined}
        max={field.max_value ?? undefined}
        maxLength={field.type === "text" ? 4000 : undefined}
        value={value}
        onInput={
          field.type === "date"
            ? (e) => change(field.id, e.currentTarget.value)
            : undefined
        }
        onChange={(e) => change(field.id, e.target.value)}
      />
    );
  };
  const sections = Object.entries(SECTION_NAMES).filter(([key]) =>
    fields.some((f) => f.section === key && visible(f)),
  );
  const sectionStats = (key: string) => {
    const current = activeFields.filter(field => field.section === key);
    return { filled: current.filter(field => filled(form[field.id])).length, total: current.length };
  };
  const whoCount = Number(Boolean(diagnosis)) + Number(Boolean(secondDiagnosis));
  const navigation = [
    ...(!compact ? [{ key: "identity", marker: "#", label: "Mã phiếu", short: "Mã phiếu", filled: Number(filled(form.hospital_code)) + Number(filled(form.study_phase)), total: 2 }] : []),
    ...sections.map(([key, label]) => ({ key, marker: SECTION_MARKERS[key], label, short: SECTION_SHORT_NAMES[key], ...sectionStats(key) })),
    { key: "who", marker: "VII", label: "Giải phẫu bệnh WHO", short: "GPB WHO", filled: whoCount, total: 2 },
  ];
  const allSectionsOpen = [...sections.map(([key]) => key), "who"].every(key => open[key]);
  const navigate = (key: string) => {
    setActiveSection(key);
    setOpen(previous => ({ ...previous, [key]: true }));
    window.setTimeout(() => {
      const element = document.getElementById(`managed-${key}`);
      if (!element) return;
      const offset = compact ? 85 : window.innerWidth <= 1040 ? (navigationRef.current?.offsetHeight || 100) + 18 : 20;
      window.scrollTo({ top: Math.max(0, element.getBoundingClientRect().top + window.scrollY - offset),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }, 40);
  };
  const clearAll = () => {
    if (!window.confirm("Xóa toàn bộ nội dung đang nhập của phiếu này? Thay đổi sẽ được lưu vào bản nháp.")) return;
    const multi = new Set(fields.filter(field => field.type === "multiselect").map(field => field.id));
    setForm(previous => Object.fromEntries(Object.keys(previous).map(key => [key, key === "missing_reasons" ? {} : multi.has(key) ? [] : ""])));
    setDiagnosis(""); setOther(""); setSecondDiagnosis(""); setSecondOther(""); setError("");
  };
  const numericIota = IOTA.every((id) => fields.some((f) => f.id === id && f.type === "number"));
  const iotaEntered = numericIota ? IOTA.filter((k) => filled(form[k])) : [];
  const iotaTotal = iotaEntered.reduce((sum, k) => sum + Number(form[k]), 0);
  return (
    <div
      className={`form-container managed-form ${compact ? "admin-case-form" : "entry-form"}`}
    >
      {!compact && (
        <header className="form-card header-card entry-header">
          <div className="entry-header-main">
            <span className="entry-header-icon">
              <FileText size={25} />
            </span>
            <div className="entry-header-copy">
              <span className="entry-kicker">
                THU THẬP DỮ LIỆU NGHIÊN CỨU · PHIÊN BẢN {schema.version}
              </span>
              <h1 className="form-title">{schema.title}</h1>
              <p className="form-subtitle">
                {schema.description ||
                  "Nhập thông tin theo hồ sơ nguồn. Các ô có dấu * cần điền trước khi gửi."}
              </p>
            </div>
            <button type="button" className="clear-form-button" aria-label="Xóa tất cả thông tin"
              onClick={clearAll} disabled={busy || readOnly}><Trash2 size={15} aria-hidden="true"/><span>Xóa tất cả thông tin</span></button>
          </div>
          <div className="entry-progress">
            <div className="entry-progress-label">
              <span>Thông tin đã nhập</span>
              <strong>
                {count}<span> / {total} mục</span>
              </strong>
            </div>
            <div className="entry-progress-track" role="progressbar" aria-label="Tiến độ nhập thông tin"
              aria-valuemin={0} aria-valuemax={total} aria-valuenow={count}>
              <span style={{width: `${Math.min(100, count / total * 100)}%`}}/>
            </div>
            <p>Các mục chưa có thông tin có thể để trống.</p>
          </div>
        </header>
      )}
      <nav ref={navigationRef} className="sticky-nav-wrapper" aria-label="Các mục trong phiếu">
        {!compact && <div className="entry-nav-heading">
          <strong>Các mục trong phiếu</strong>
          <button type="button" className="entry-collapse-toggle" aria-expanded={allSectionsOpen}
            onClick={() => setOpen(previous => ({...previous, ...Object.fromEntries([...sections.map(([key]) => key), "who"].map(key => [key, !allSectionsOpen]))}))}>
            {allSectionsOpen ? "Thu gọn tất cả" : "Mở tất cả"}<ChevronDown size={14} className={allSectionsOpen ? "" : "is-collapsed"}/>
          </button>
        </div>}
        <div className="sticky-nav-list">
          {navigation.map(item => <button type="button" key={item.key}
            className={`nav-pill-btn ${activeSection === item.key ? "active" : ""}`}
            aria-current={activeSection === item.key ? "step" : undefined}
            aria-controls={`managed-${item.key}`} onClick={() => navigate(item.key)}>
            {compact ? `${item.marker}. ${item.label}` : <>
              <span className="entry-nav-roman">{item.marker}</span><span className="entry-nav-label">{item.label}</span>
              <span className="entry-nav-short">{item.short}</span>
              <span className={`entry-nav-count ${item.filled === item.total ? "is-filled" : ""}`}>{item.filled}/{item.total}</span>
            </>}
          </button>)}
        </div>
      </nav>
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="managed-fieldset">
          {(error || identityError) && (
            <p role="alert" className="workflow-error">
              {error || identityError}
            </p>
          )}
          <section
            id="managed-identity"
            className="form-card entry-identity-card"
          >
            <h2>{identityVersion >= 2 ? "Tạo mã phiếu" : "Đợt điều trị"}</h2>
            <p>Phiếu sử dụng biểu mẫu phiên bản {schema.version}.</p>
            <div className="form-grid-3 study-identity-grid">
              <label>
                Bệnh viện *
                {identityVersion >= 2 ? (
                  <select
                    aria-label="Bệnh viện"
                    className="form-select"
                    disabled={readOnly || busy || Boolean(studyCode)}
                    value={form.hospital_code}
                    onChange={(e) => change("hospital_code", e.target.value)}
                  >
                    <option value="">-- Chọn bệnh viện --</option>
                    {Object.entries(identity.hospitals).map(([k, v]) => (
                      <option key={k} value={k}>
                        {k} — {v}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label="Mã bệnh viện"
                    className="form-input"
                    disabled={readOnly || busy}
                    value={form.hospital_code}
                    onChange={(e) => change("hospital_code", e.target.value)}
                  />
                )}
              </label>
              {identityVersion >= 2 ? (
                <>
                  <label>
                    Giai đoạn nghiên cứu *
                    <select
                      aria-label="Giai đoạn nghiên cứu"
                      className="form-select"
                      disabled={readOnly || busy || Boolean(studyCode)}
                      value={form.study_phase}
                      onChange={(e) => change("study_phase", e.target.value)}
                    >
                      <option value="">-- Chọn giai đoạn --</option>
                      {Object.entries(identity.phases).map(([k, v]) => (
                        <option key={k} value={k}>
                          {k} — {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="study-code-field">
                    <span className="study-code-label">Mã phiếu (tự động)</span>
                    <output className="study-code-preview">
                      {studyCode || "Được cấp khi gửi phiếu"}
                    </output>
                  </div>
                </>
              ) : (
                <label>
                  Mã đợt điều trị *
                  <input
                    aria-label="Mã đợt điều trị"
                    className="form-input"
                    disabled={readOnly || busy}
                    value={form.encounter_code}
                    onChange={(e) => change("encounter_code", e.target.value)}
                  />
                </label>
              )}
            </div>
          </section>
          {sections.map(([key, name]) => (
            <section
              key={key}
              id={`managed-${key}`}
              className={`section-accordion ${open[key] ? "is-open" : ""}`}
            >
              <button
                type="button"
                className="section-header-btn"
                aria-expanded={Boolean(open[key])}
                onClick={() => setOpen((s) => ({ ...s, [key]: !s[key] }))}
              >
                <div className="section-header-left">
                  <span className="section-roman-badge">{SECTION_MARKERS[key]}</span>
                  <div className="section-title-wrap"><h3>{name}</h3></div>
                </div>
                <div className="section-header-right">
                  <span className={`section-count-badge ${sectionStats(key).filled === sectionStats(key).total ? "is-complete" : ""}`}>
                    {sectionStats(key).filled}/{sectionStats(key).total} mục
                  </span>
                  <ChevronDown size={19} className="entry-section-chevron" aria-hidden="true"/>
                </div>
              </button>
              {open[key] && (
                <div className="section-content section-body">
                  <div className="form-grid-3">
                    {fields
                      .filter((f) => f.section === key && visible(f))
                      .map((field) => (
                        <div className={`form-item ${["textarea", "multiselect"].includes(field.type) ? "form-col-span-full" : ""}`} key={field.id}>
                          <label
                            className="field-label"
                            htmlFor={
                              field.type !== "multiselect"
                                ? `managed-${field.id}`
                                : undefined
                            }
                          >
                            {field.label}
                            {field.required && field.active ? " *" : ""}
                            {!field.active && <small> (đã ngừng dùng)</small>}
                          </label>
                          {control(field)}
                          {field.help_text && (
                            <small
                              id={`hint-${field.id}`}
                              className="field-hint"
                            >
                              {field.help_text}
                            </small>
                          )}
                        </div>
                      ))}
                  </div>
                  {key === "sec4" && iotaEntered.length > 0 && (
                    <p
                      className={
                        iotaEntered.length === 6 &&
                        Math.abs(iotaTotal - 100) < 1e-9
                          ? "managed-valid"
                          : "workflow-error"
                      }
                    >
                      IOTA: {iotaEntered.length}/6 ô, tổng{" "}
                      {Number(iotaTotal.toFixed(6))}%. Theo quy ước của phiếu,
                      cần đủ 6 ô và tổng 100%.
                    </p>
                  )}
                </div>
              )}
            </section>
          ))}
          <section id="managed-who" className={`section-accordion ${open.who ? "is-open" : ""}`}>
            <button type="button" className="section-header-btn" aria-expanded={Boolean(open.who)}
              onClick={() => setOpen(previous => ({ ...previous, who: !previous.who }))}>
              <div className="section-header-left"><span className="section-roman-badge">VII</span>
                <div className="section-title-wrap"><h3>Giải phẫu bệnh WHO</h3></div>
              </div>
              <div className="section-header-right"><span className={`section-count-badge ${whoCount === 2 ? "is-complete" : ""}`}>{whoCount}/2 mục</span>
                <ChevronDown size={19} className="entry-section-chevron" aria-hidden="true"/>
              </div>
            </button>
            {open.who && <div className="section-content section-body"><WhoResultsFields
              options={options}
              disabled={readOnly || busy}
              values={[
                { id: diagnosis, other },
                { id: secondDiagnosis, other: secondOther },
              ]}
              onChange={(slot, value) => {
                if (slot === 1) {
                  setDiagnosis(value.id);
                  setOther(value.other);
                } else {
                  setSecondDiagnosis(value.id);
                  setSecondOther(value.other);
                }
              }}
            /></div>}
          </section>
          {!compact && !readOnly && (
            <footer className="entry-submit-bar managed-submit">
              <div className="entry-submit-copy"><strong>Kiểm tra thông tin trước khi gửi</strong><span>
                <Check size={16} />
                {saveStatus || "Kiểm tra thông tin trước khi gửi"}
              </span></div>
              <button
                type="submit"
                className="btn-submit"
                disabled={busy || Boolean(identityError)}
              >
                <Send size={17} />
                {busy ? "Đang xử lý…" : submitLabel}
              </button>
            </footer>
          )}
        </fieldset>
      </form>
    </div>
  );
};
