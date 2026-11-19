import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, FileText, Send } from "lucide-react";
import type { ComprehensiveFormPageProps } from "./ComprehensiveFormPage";
import { ClinicalField } from "../types/schema";
import { SURGICAL_FINDINGS } from "../components/SurgicalProtocolFields";
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
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      Object.keys(SECTION_NAMES).map((k) => [k, !compact || k === "sec1"]),
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
    (!f.show_when ||
      f.show_values.includes(String(form[f.show_when] || "")) ||
      filled(form[f.id])) &&
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
      if (SURGICAL_FINDINGS.some(finding => finding.id === id) && value !== "Có") {
        next[`${id}_ghi_chu`] = "";
      }
      if (filled(value) && next.missing_reasons) {
        next.missing_reasons = { ...next.missing_reasons };
        delete next.missing_reasons[id];
      }
      if (id === "iota_malignant") next.sa_iota_adnex = value;
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
  const iotaEntered = IOTA.filter((k) => filled(form[k]));
  const iotaTotal = iotaEntered.reduce((sum, k) => sum + Number(form[k]), 0);
  return (
    <div
      className={`form-container managed-form ${compact ? "admin-case-form" : "entry-form"}`}
    >
      {!compact && (
        <header className="form-card header-card">
          <div className="entry-header-main">
            <span className="entry-header-icon">
              <FileText size={25} />
            </span>
            <div>
              <span className="entry-kicker">
                THU THẬP DỮ LIỆU NGHIÊN CỨU · PHIÊN BẢN {schema.version}
              </span>
              <h1 className="form-title">{schema.title}</h1>
              <p className="form-subtitle">
                {schema.description ||
                  "Nhập thông tin theo hồ sơ nguồn. Các ô có dấu * cần điền trước khi gửi."}
              </p>
            </div>
          </div>
          <div className="entry-progress">
            <div className="entry-progress-label">
              <span>Thông tin đã nhập</span>
              <strong>
                {count} / {total} mục
              </strong>
            </div>
            <progress
              aria-label="Tiến độ nhập thông tin"
              value={count}
              max={total}
            />
            <p>Các mục chưa có thông tin có thể để trống.</p>
          </div>
        </header>
      )}
      <nav className="sticky-nav-wrapper" aria-label="Các mục trong phiếu">
        <div className="entry-nav-heading">
          <strong>Các mục trong phiếu</strong>
        </div>
        <div className="sticky-nav-list">
          {!compact && (
            <a className="nav-pill-btn" href="#managed-identity">
              Mã phiếu
            </a>
          )}
          {sections.map(([key, name]) => (
            <a
              className="nav-pill-btn"
              key={key}
              href={`#managed-${key}`}
              onClick={() => setOpen((s) => ({ ...s, [key]: true }))}
            >
              {name}
            </a>
          ))}
          <a className="nav-pill-btn" href="#managed-who">
            Giải phẫu bệnh WHO
          </a>
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
                <h2>{name}</h2>
                <ChevronDown size={20} />
              </button>
              {open[key] && (
                <div className="section-content">
                  <div className="form-grid-3">
                    {fields
                      .filter((f) => f.section === key && visible(f))
                      .map((field) => (
                        <div className="form-item" key={field.id}>
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
          <section id="managed-who" className="form-card">
            <h2>Giải phẫu bệnh WHO 1 & 2</h2>
            <WhoResultsFields
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
            />
          </section>
          {!compact && !readOnly && (
            <footer className="managed-submit">
              <span>
                <Check size={16} />
                {saveStatus || "Kiểm tra thông tin trước khi gửi"}
              </span>
              <button
                type="submit"
                className="admin-primary"
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
