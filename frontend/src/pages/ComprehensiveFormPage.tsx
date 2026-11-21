import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Check,
  Trash2,
  FileText,
  Save,
  ChevronDown,
} from "lucide-react";
import { FormSchemaDefinition } from "../types/schema";
import { RecordAnswers, workflowApi } from "../api/workflow";
import { ManagedFormPage } from "./ManagedFormPage";
import { SurgicalProtocolFields, SURGICAL_FINDINGS } from "../components/SurgicalProtocolFields";
import { WhoResultsFields, whoValueAt, buildWhoPathology } from "../components/WhoResultsFields";
import { missingRequiredFields } from "../utils/requiredFields";
import { useRequiredFieldNavigation, RequiredValidationRef } from "../hooks/useRequiredFieldNavigation";
import { RequiredFieldsNotice } from "../components/RequiredFieldsNotice";

export interface ComprehensiveFormPageProps {
  initialAnswers: RecordAnswers;
  schema: FormSchemaDefinition;
  readOnly: boolean;
  busy: boolean;
  onDraftChange: (answers: RecordAnswers) => void;
  onSubmit: (answers: RecordAnswers) => Promise<void>;
  submitLabel?: string;
  compact?: boolean;
  identityVersion?: number;
  studyCode?: string | null;
  saveStatus?: string;
  validationRef?: RequiredValidationRef;
}

export const ComprehensiveFormPage: React.FC<ComprehensiveFormPageProps> = props => props.schema.clinical_fields ? <ManagedFormPage {...props}/> : <LegacyComprehensiveFormPage {...props}/>;

const LegacyComprehensiveFormPage: React.FC<ComprehensiveFormPageProps> = ({ initialAnswers, schema, readOnly, busy, onDraftChange, onSubmit, submitLabel = "Gửi phiếu", compact = false, identityVersion = 2, studyCode = null, saveStatus = "", validationRef }) => {
  const formRoot = useRef<HTMLDivElement>(null);
  const pathologyOptions = (schema.fields.find(f => f.id === "pathology")?.options || []).map(o => ({ ...o, code: o.numericCode || "", classification: o.classification || "unspecified" }));
  const [selectedPathologyId, setSelectedPathologyId] = useState(whoValueAt(initialAnswers, 1).id);
  const [pathologyOtherText, setPathologyOtherText] = useState(whoValueAt(initialAnswers, 1).other);
  const [secondPathologyId, setSecondPathologyId] = useState(whoValueAt(initialAnswers, 2).id);
  const [secondPathologyOtherText, setSecondPathologyOtherText] = useState(whoValueAt(initialAnswers, 2).other);
  const [formError, setFormError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [clinicalChoices, setClinicalChoices] = useState<Record<string, (string | number)[]>>({});
  const hasSurgeryProtocol = Boolean(clinicalChoices.pt_so_luong_u?.length);
  const surgeryFieldTotal = hasSurgeryProtocol ? 11 : 7;
  const totalFieldCount = hasSurgeryProtocol ? 66 : 62;
  const [identityOptions, setIdentityOptions] = useState<{hospitals: Record<string,string>; phases: Record<string,string>}>({hospitals:{},phases:{}});
  useEffect(() => { workflowApi<{ choices: typeof clinicalChoices; research_identity: typeof identityOptions }>("/forms/clinical-contract").then(c => {setClinicalChoices(c.choices);setIdentityOptions(c.research_identity);}).catch(() => setCatalogError("Chưa tải được danh mục lựa chọn của biểu mẫu. Vui lòng tải lại trang.")); }, []);

  // References for smooth scrolling
  const sectionRefs = {
    meta: useRef<HTMLDivElement>(null),
    sec1: useRef<HTMLDivElement>(null),
    sec2: useRef<HTMLDivElement>(null),
    sec3: useRef<HTMLDivElement>(null),
    sec4: useRef<HTMLDivElement>(null),
    sec5: useRef<HTMLDivElement>(null),
    sec6: useRef<HTMLDivElement>(null),
    sec7: useRef<HTMLDivElement>(null),
  };
  const navigationRef = useRef<HTMLElement>(null);

  // Accordion open/close states (All 6 sections open by default)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    sec1: true,
    sec2: !compact,
    sec3: !compact,
    sec4: !compact,
    sec5: !compact,
    sec6: !compact,
    sec7: !compact,
  });

  const [activeTab, setActiveTab] = useState<string>(compact ? "sec1" : "meta");
  const navigationOffset = () => compact ? 85 : window.innerWidth <= 1040 ? (navigationRef.current?.offsetHeight || 100) + 18 : 20;

  const toggleSection = (sec: string) => {
    setOpenSections((prev) => ({ ...prev, [sec]: !prev[sec] }));
  };



  const scrollToSection = (secKey: keyof typeof sectionRefs) => {
    setActiveTab(secKey);
    setOpenSections((prev) => ({ ...prev, [secKey]: true }));
    setTimeout(() => {
      const el = sectionRefs[secKey].current;
      if (el) {
        const topOffset = el.getBoundingClientRect().top + window.scrollY - navigationOffset();
        window.scrollTo({ top: Math.max(0, topOffset), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
    }, 40);
  };

  // Scrollspy: Tự động cập nhật nút tab khi lướt (cuộn trang)
  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const scrollPosition = window.scrollY;
          const windowHeight = window.innerHeight;
          const docHeight = document.documentElement.scrollHeight;

          // Nếu cuộn gần hết trang (xuống đáy), kích hoạt mục cuối cùng
          if (windowHeight + scrollPosition >= docHeight - 90) {
            setActiveTab("sec7");
            ticking = false;
            return;
          }

          const sections: Array<{ key: string; el: HTMLDivElement | null }> = [
            { key: "meta", el: sectionRefs.meta.current },
            { key: "sec1", el: sectionRefs.sec1.current },
            { key: "sec2", el: sectionRefs.sec2.current },
            { key: "sec3", el: sectionRefs.sec3.current },
            { key: "sec4", el: sectionRefs.sec4.current },
            { key: "sec5", el: sectionRefs.sec5.current },
            { key: "sec6", el: sectionRefs.sec6.current },
            { key: "sec7", el: sectionRefs.sec7.current },
          ];

          const threshold = navigationOffset() + 24;
          let currentSec = compact ? "sec1" : "meta";

          for (const sec of sections) {
            if (sec.el) {
              const top = sec.el.getBoundingClientRect().top;
              if (top <= threshold) {
                currentSec = sec.key;
              }
            }
          }

          setActiveTab(currentSec);
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [compact]);

  // 52 Clinical Fields + WHO Pathology + IOTA ADNEX 6 Sub-fields
  const [form, setForm] = useState<Record<string, any>>(() => ({
      so_hs: "",
      ho_ten: "",
      nam_sinh: "",
      nam_kham: "",
      dia_chi: "",
      nghe_nghiep: "",
      tuoi_phau_thuat: "",
      para: "",
      kinh_nguyet: "",
      thoi_diem_phat_hien: "",
      tien_can_phau_thuat_ubt: "",
      tien_can_phau_thuat_ubt_ghi_chu: "",
      tien_can_ung_thu_khac: "",
      tien_can_ung_thu_khac_ghi_chu: "",
      tien_can_lac_nmtc: "",
      co_thai: "",
      ubt_xoan: "",
      ubt_vo: "",
      ubt_nhiem_trung: "",
      ca_125: "",
      he4: "",
      roma: "",
      afp: "",
      beta_hcg: "",
      sa_so_luong_u: "",
      sa_mo_buong_trung: "",
      sa_phan_loai_u: "",
      sa_phan_am: [] as string[],
      sa_kich_thuoc_u: "",
      sa_bo_ngoai: "",
      sa_bo_trong: "",
      sa_so_luong_thuy: "",
      sa_kich_thuoc_phan_dac: "",
      sa_bong_lung: "",
      sa_nang_trong_phan_dac: "",
      sa_nang_trong_phan_dac_so_luong: "",
      sa_choi: "",
      sa_tang_sinh_mach_mau: "",
      sa_dich_o_bung: "",
      sa_ton_thuong_nmtc: "",
      sa_ton_thuong_nmtc_ghi_chu: "",
      sa_ket_luan: "",
      iota_benign: "",
      iota_malignant: "",
      iota_borderline: "",
      iota_stage1: "",
      iota_stage2_4: "",
      iota_metastatic: "",
      sa_iota_adnex: "",
      sa_orads: "",
      mri_mo_buong_trung: "",
      mri_so_luong_u: "",
      mri_dang_ton_thuong: "",
      mri_kich_thuoc_u: "",
      mri_dich_nang_t1w: "",
      mri_dich_nang_t2w: "",
      mri_dich_nang: "",
      mri_thanh_phan_mo: "",
      mri_phan_dac: "",
      mri_kich_thuoc_phan_dac: "",
      mri_khuech_tan: "",
      mri_tang_sinh_mach_mau: "",
      mri_ngam_thuoc: "",
      mri_hach: "",
      mri_dich_o_bung: "",
      mri_ton_thuong_co_quan_khac: "",
      mri_ket_luan: "",
      pt_chan_doan_truoc: "",
      pt_chan_doan_sau: "",
      pt_sinh_thiet_lanh: "",
      pt_sinh_thiet_lanh_ghi_chu: "",
      pt_ton_thuong: "",
      hospital_code: "", study_phase: "", encounter_code: "", treatment_date: "", missing_reasons: {},
      ...initialAnswers.clinical_data,
      // Preserve historical string values from older records while editing arrays.
      pt_phuong_phap: Array.isArray(initialAnswers.clinical_data?.pt_phuong_phap) ? initialAnswers.clinical_data.pt_phuong_phap : (initialAnswers.clinical_data?.pt_phuong_phap ? String(initialAnswers.clinical_data.pt_phuong_phap).split(/,\s*/) : []),
  }));

  const handleClearAll = () => {
    if (!window.confirm("Xóa toàn bộ nội dung đang nhập của phiếu này? Thay đổi sẽ được lưu vào bản nháp.")) return;
    setForm(Object.fromEntries(Object.keys(form).map(key => [key, key === "missing_reasons" ? {} : ["sa_phan_am", "pt_phuong_phap"].includes(key) ? [] : ""])));
    setSelectedPathologyId(""); setPathologyOtherText(""); setSecondPathologyId(""); setSecondPathologyOtherText("");
  };

  const buildAnswers = (): RecordAnswers => ({
    pathology: buildWhoPathology([{id:selectedPathologyId,other:pathologyOtherText},{id:secondPathologyId,other:secondPathologyOtherText}], pathologyOptions),
    classification: pathologyOptions.find(o => o.id === selectedPathologyId)?.classification || "unspecified",
    clinical_data: form,
  });
  const required = useRequiredFieldNavigation(missingRequiredFields(schema, buildAnswers(), identityVersion), formRoot, navigationRef,
    section => { setActiveTab(section); setOpenSections(previous => ({...previous, [section]: true})); }, compact, validationRef);
  useEffect(() => { setFormError(""); }, [form, selectedPathologyId, pathologyOtherText, secondPathologyId, secondPathologyOtherText]);
  useEffect(() => { if (!readOnly) onDraftChange(buildAnswers()); }, [form, selectedPathologyId, pathologyOtherText, secondPathologyId, secondPathologyOtherText, readOnly, onDraftChange]);

  // Field change handler
  const handleChange = (field: string, value: any) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (SURGICAL_FINDINGS.some(finding => finding.id === field) && value !== "Có") {
        next[`${field}_ghi_chu`] = "";
      }

      if (value !== "" && value !== undefined) {
        next.missing_reasons = { ...(prev.missing_reasons || {}) };
        delete next.missing_reasons[field];
      }
      if (field === "iota_malignant") {
        next.sa_iota_adnex = value;
      }
      return next;
    });
  };

  const handleCheckboxMulti = (field: string, opt: string) => {
    setForm((prev) => {
      const currentList: string[] = Array.isArray(prev[field]) ? prev[field] : [];
      const exists = currentList.includes(opt);
      const updated = exists
        ? currentList.filter((item) => item !== opt)
        : [...currentList, opt];
      return { ...prev, [field]: updated };
    });
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormError("");
    if (readOnly || busy) return;
    if (compact) { await onSubmit(buildAnswers()); return; }
    if (!required.validate()) return;
    if (isIotaSumInvalid) { setFormError("Kiểm tra tỷ lệ: cần nhập đủ 6 ô, mỗi ô từ 0 đến 100%, và tổng cả 6 ô phải bằng 100% theo quy ước của phiếu."); scrollToSection("sec4"); return; }
    await onSubmit(buildAnswers());
  };

  // Study entry convention: six independent input boxes total 100%.
  const iotaValues = [form.iota_benign, form.iota_malignant, form.iota_borderline, form.iota_stage1, form.iota_stage2_4, form.iota_metastatic];
  const filledIotaCount = iotaValues.filter(value => value !== "" && value !== null && value !== undefined).length;
  const hasAnyIota = filledIotaCount > 0;
  const iotaNumbersValid = iotaValues.filter(value => value !== "" && value !== null && value !== undefined)
    .every(value => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100);
  const iotaTotal = iotaValues.reduce((total: number, value) => total + Number(value === "" || value == null ? 0 : value), 0);
  const formatIota = (value: number) => Number.isFinite(value) ? value.toLocaleString("vi-VN", {maximumFractionDigits: 6}) : "—";
  const isIotaSumValid = filledIotaCount === 6 && iotaNumbersValid && Math.abs(iotaTotal - 100) <= 0.000000001;
  const isIotaSumInvalid = hasAnyIota && !isIotaSumValid;
  const iotaError = !iotaNumbersValid
    ? "Mỗi ô phải là số từ 0 đến 100%."
    : filledIotaCount < 6
      ? `Đã nhập ${filledIotaCount}/6 ô, tổng hiện tại ${formatIota(iotaTotal)}%. Vui lòng nhập đủ 6 ô; không dùng ô trống thay cho giá trị 0.`
      : `Tổng 6 ô hiện là ${formatIota(iotaTotal)}% — ${iotaTotal > 100 ? "vượt" : "thiếu"} ${formatIota(Math.abs(iotaTotal - 100))} điểm phần trăm. Theo quy ước phiếu, tổng phải bằng 100%.`;

  const handleResetIota = () => {
    setForm((prev) => ({
      ...prev,
      iota_benign: "",
      iota_malignant: "",
      iota_borderline: "",
      iota_stage1: "",
      iota_stage2_4: "",
      iota_metastatic: "",
      sa_iota_adnex: "",
    }));
  };

  // Count valid zero values as entered data as well.
  const isEntered = (value: unknown) => typeof value === "boolean" ? value : Array.isArray(value) ? value.length > 0 : value !== "" && value !== undefined && value !== null;
  const countSec1 = [form.so_hs, form.ho_ten, form.nam_sinh, form.nam_kham, form.dia_chi, form.nghe_nghiep].filter(isEntered).length;
  const countSec2 = [
    form.tuoi_phau_thuat,
    form.para,
    form.kinh_nguyet,
    form.thoi_diem_phat_hien,
    form.tien_can_phau_thuat_ubt,
    form.tien_can_ung_thu_khac,
    form.tien_can_lac_nmtc,
    form.co_thai,
    form.ubt_nhiem_trung,
  ].filter(isEntered).length;
  const countSec3 = [form.ca_125, form.he4, form.roma, form.afp, form.beta_hcg].filter(isEntered).length;
  const isIotaFilled = hasAnyIota || isEntered(form.sa_iota_adnex);
  const countSec4 = [
    form.sa_so_luong_u,
    form.sa_mo_buong_trung,
    form.sa_phan_loai_u,
    form.sa_phan_am && form.sa_phan_am.length > 0,
    form.sa_kich_thuoc_u,
    form.sa_bo_ngoai,
    form.sa_bo_trong,
    form.sa_so_luong_thuy,
    form.sa_kich_thuoc_phan_dac,
    form.sa_bong_lung,
    form.sa_nang_trong_phan_dac,
    form.sa_choi,
    form.sa_tang_sinh_mach_mau,
    form.sa_dich_o_bung,
    form.sa_ton_thuong_nmtc,
    form.sa_ket_luan,
    isIotaFilled,
  ].filter(isEntered).length;
  const countSec5 = [
    form.mri_mo_buong_trung,
    form.mri_so_luong_u,
    form.mri_dang_ton_thuong,
    form.mri_kich_thuoc_u,
    form.mri_dich_nang || form.mri_dich_nang_t1w || form.mri_dich_nang_t2w,
    form.mri_thanh_phan_mo,
    form.mri_phan_dac,
    form.mri_kich_thuoc_phan_dac,
    form.mri_khuech_tan,
    form.mri_tang_sinh_mach_mau,
    form.mri_ngam_thuoc,
    form.mri_hach,
    form.mri_dich_o_bung,
    form.mri_ton_thuong_co_quan_khac,
    form.sa_orads,
    form.mri_ket_luan,
  ].filter(isEntered).length;
  const countSec6 = [
    form.pt_chan_doan_truoc,
    form.pt_chan_doan_sau,
    (Array.isArray(form.pt_phuong_phap) ? form.pt_phuong_phap.length > 0 : Boolean(form.pt_phuong_phap)),
    form.pt_sinh_thiet_lanh,
    form.pt_ton_thuong,
    form.pt_so_luong_u,
    form.pt_co_dich_o_bung,
    form.pt_u_dinh_co_quan_khac,
    form.pt_nghi_ngo_di_can,
    form.ubt_xoan,
    form.ubt_vo,
  ].filter(isEntered).length;
  const countSec7 = Number(Boolean(selectedPathologyId)) + Number(Boolean(secondPathologyId));

  const totalFilled = countSec1 + countSec2 + countSec3 + countSec4 + countSec5 + countSec6 + countSec7;
  const progressPercent = Math.min(100, Math.round((totalFilled / totalFieldCount) * 100));
  const sectionNavigation: {key: keyof typeof sectionRefs; roman: string; label: string; short: string; filled: number; total: number}[] = [
    {key:"meta",roman:"#",label:"Mã phiếu",short:"Mã phiếu",filled:[form.hospital_code,form.study_phase].filter(isEntered).length,total:2},
    {key:"sec1",roman:"I",label:"Hành chính",short:"Hành chính",filled:countSec1,total:6},
    {key:"sec2",roman:"II",label:"Tiền sử & lâm sàng",short:"Lâm sàng",filled:countSec2,total:9},
    {key:"sec3",roman:"III",label:"Dấu ấn sinh học",short:"Markers",filled:countSec3,total:5},
    {key:"sec4",roman:"IV",label:"Siêu âm",short:"Siêu âm",filled:countSec4,total:17},
    {key:"sec5",roman:"V",label:"Cộng hưởng từ",short:"MRI",filled:countSec5,total:16},
    {key:"sec6",roman:"VI",label:"Phẫu thuật",short:"Phẫu thuật",filled:countSec6,total:surgeryFieldTotal},
    {key:"sec7",roman:"VII",label:"Giải phẫu bệnh WHO",short:"GPB WHO",filled:countSec7,total:2},
  ];
  const allSectionsOpen = sectionNavigation.filter(item => item.key !== "meta").every(item => openSections[item.key]);
  const choiceOptions = (field: string) => {
    const choices = (clinicalChoices[field] || []).map(String);
    const value = String(form[field] || "");
    return <><option value="">-- Chọn --</option>{choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}{value && !choices.includes(value) && <option value={value} disabled>{value} (dữ liệu cũ)</option>}</>;
  };


  return (
    <div ref={formRoot} className={`form-container ${compact ? `admin-case-form ${readOnly ? "is-read-only" : "is-editable"}` : "entry-form"}`}>
      {!compact && <header className="form-card header-card entry-header">
        <div className="entry-header-main">
          <span className="entry-header-icon"><FileText size={25} aria-hidden="true"/></span>
          <div className="entry-header-copy"><span className="entry-kicker">THU THẬP DỮ LIỆU NGHIÊN CỨU</span><h1 className="form-title">Bệnh án & giải phẫu bệnh u buồng trứng</h1><p className="form-subtitle">Nhập thông tin theo hồ sơ nguồn. Các ô có dấu <b>*</b> cần điền trước khi gửi.</p></div>
          <button type="button" className="clear-form-button" aria-label="Xóa tất cả thông tin" onClick={handleClearAll} disabled={busy || readOnly}><Trash2 size={15} aria-hidden="true"/><span>Xóa tất cả thông tin</span></button>
        </div>
        <div className="entry-progress"><div className="entry-progress-label"><span>Thông tin đã nhập</span><strong>{totalFilled}<span> / {totalFieldCount} mục</span></strong></div><div className="entry-progress-track" role="progressbar" aria-label="Tiến độ nhập thông tin" aria-valuemin={0} aria-valuemax={totalFieldCount} aria-valuenow={totalFilled}><span style={{width:`${progressPercent}%`}}/></div><p>Các mục chưa có thông tin có thể để trống.</p></div>
      </header>}
      <nav ref={navigationRef} className="sticky-nav-wrapper" aria-label="Các mục trong phiếu">
        {!compact && <div className="entry-nav-heading"><strong>Các mục trong phiếu</strong><button type="button" className="entry-collapse-toggle" aria-expanded={allSectionsOpen} onClick={() => setOpenSections(prev => ({...prev,...Object.fromEntries(sectionNavigation.filter(item => item.key !== "meta").map(item => [item.key,!allSectionsOpen]))}))}>{allSectionsOpen ? "Thu gọn tất cả" : "Mở tất cả"}<ChevronDown size={14} className={allSectionsOpen ? "" : "is-collapsed"}/></button></div>}
        <div className="sticky-nav-list">{sectionNavigation.filter(item => !compact || item.key !== "meta").map(item => <button key={item.key} type="button" className={`nav-pill-btn ${activeTab === item.key ? "active" : ""}`} aria-current={activeTab === item.key ? "step" : undefined} aria-controls={`entry-${item.key}`} onClick={() => scrollToSection(item.key)}>{compact ? `${item.roman}. ${item.short}` : <><span className="entry-nav-roman">{item.roman}</span><span className="entry-nav-label">{item.label}</span><span className="entry-nav-short">{item.short}</span><span className={`entry-nav-count ${item.filled === item.total ? "is-filled" : ""}`}>{item.filled}/{item.total}</span></>}</button>)}</div>
      </nav>

      <form onSubmit={handleSubmit}>
        <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        {(catalogError || (compact && formError)) && <p className="workflow-error" role="alert">{catalogError || formError}</p>}
        <RequiredFieldsNotice issues={required.issues} onFocus={required.focus}/>
        <div ref={sectionRefs.meta} id="entry-meta" className="form-card entry-identity-card">
          <h2>{identityVersion >= 2 || form.study_phase ? "Tạo mã phiếu" : "Đợt điều trị / phẫu thuật"}</h2>
          {!compact && <p>Chọn bệnh viện và giai đoạn nghiên cứu. Số thứ tự được cấp tự động khi gửi phiếu.</p>}
          {identityVersion >= 2 || form.study_phase ? <>
          <div className="form-grid-3 study-identity-grid">
            <label htmlFor="study-hospital">Bệnh viện *<select id="study-hospital" disabled={readOnly || busy || Boolean(studyCode)} aria-label="Bệnh viện" title={identityOptions.hospitals[form.hospital_code] || "Chọn bệnh viện"} name="hospital_code" className="form-select" value={form.hospital_code} onChange={e => handleChange("hospital_code",e.target.value)}><option value="">-- Chọn bệnh viện --</option>{Object.entries(identityOptions.hospitals).map(([code,name]) => <option key={code} value={code}>{code} — {name.replace(/^Bệnh viện /, "")}</option>)}</select></label>
            <label htmlFor="study-phase">Giai đoạn nghiên cứu *<select id="study-phase" disabled={readOnly || busy || Boolean(studyCode)} aria-label="Giai đoạn nghiên cứu" name="study_phase" className="form-select" value={form.study_phase} onChange={e => handleChange("study_phase",e.target.value)}><option value="">-- Chọn giai đoạn --</option>{Object.entries(identityOptions.phases).map(([code,name]) => <option key={code} value={code}>{code} — {name}</option>)}</select></label>
            <div className="study-code-field"><span className="study-code-label">Mã phiếu (tự động)</span><output className={`study-code-preview ${studyCode ? "is-issued" : ""}`} aria-label="Mã phiếu" aria-live="polite">{studyCode || (form.hospital_code && form.study_phase ? `${form.hospital_code}_${form.study_phase}_•••••` : "Được cấp khi gửi phiếu")}</output><small>{studyCode ? "Mã đã cấp được giữ nguyên." : "Số thứ tự 5 chữ số, tăng liên tục."}</small></div>
          </div>
          </> : <div className="form-grid-3">
            <label>Mã bệnh viện *<input id="study-hospital" disabled={readOnly || busy} aria-label="Mã bệnh viện" name="hospital_code" className="form-input" value={form.hospital_code} maxLength={100} onChange={e => handleChange("hospital_code", e.target.value)} /></label>
            <label>Mã đợt điều trị *<input id="entry-encounter_code" disabled={readOnly || busy} aria-label="Mã đợt điều trị" name="encounter_code" className="form-input" value={form.encounter_code} maxLength={100} onChange={e => handleChange("encounter_code", e.target.value)} /></label>
          </div>}
        </div>
        {/* ============================================================== */}
        {/* MỤC I: THÔNG TIN HÀNH CHÍNH & BỆNH NHÂN */}
        {/* ============================================================== */}
        <div
          ref={sectionRefs.sec1}
          id="entry-sec1"
          className={`section-accordion ${openSections.sec1 ? "is-open" : ""}`}
        >
          <button
            type="button"
            className="section-header-btn"
            aria-expanded={openSections.sec1}
            onClick={() => toggleSection("sec1")}
          >
            <div className="section-header-left">
              <span className="section-roman-badge">I</span>
              <div className="section-title-wrap">
                <h3>{compact ? "Thông tin bệnh nhân" : "Thông tin hành chính & bệnh nhân"}</h3>
              </div>
            </div>
            <div className="section-header-right">
              <ChevronDown className="entry-section-chevron" size={19} aria-hidden="true"/>
              <span className={`section-count-badge ${countSec1 === 6 ? "is-complete" : ""}`}>
                {countSec1}/6 câu
              </span>
            </div>
          </button>

          {openSections.sec1 && (
            <div className="section-body">
              <div className="form-grid-3">
                {/* 1. Số HS */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-so_hs">Số HS *</label>
                  <input id="entry-so_hs" disabled={readOnly || busy} aria-label="Số HS" name="so_hs"
                    type="text"
                    className="form-input"
                    value={form.so_hs}
                    onChange={(e) => handleChange("so_hs", e.target.value)}
                  />
                </div>

                {/* 2. Họ Tên */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-ho_ten">Họ Tên</label>
                  <input id="entry-ho_ten" disabled={readOnly || busy} aria-label="Họ Tên" name="ho_ten"
                    type="text"
                    className="form-input"
                    value={form.ho_ten}
                    onChange={(e) => handleChange("ho_ten", e.target.value.toUpperCase())}
                  />
                </div>

                {/* 3. Năm Sinh */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-nam_sinh">Năm Sinh</label>
                  <input id="entry-nam_sinh" disabled={readOnly || busy} aria-label="Năm Sinh" name="nam_sinh"
                    type="number" min="1900" max={new Date().getFullYear()}
                    className="form-input"
                    value={form.nam_sinh}
                    onChange={(e) => handleChange("nam_sinh", e.target.value)}
                  />
                </div>

                {/* Năm Khám */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-nam_kham">Năm Khám</label>
                  <input id="entry-nam_kham" disabled={readOnly || busy} aria-label="Năm Khám" name="nam_kham"
                    type="number" min="1900" max={new Date().getFullYear()}
                    className="form-input"
                    value={form.nam_kham}
                    onChange={(e) => handleChange("nam_kham", e.target.value)}
                  />
                </div>

                {/* 4. Địa chỉ */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-dia_chi">Địa chỉ</label>
                  <input id="entry-dia_chi" disabled={readOnly || busy} aria-label="Địa chỉ" name="dia_chi"
                    type="text"
                    className="form-input"
                    value={form.dia_chi}
                    onChange={(e) => handleChange("dia_chi", e.target.value)}
                  />
                </div>

                {/* 5. Nghề nghiệp */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-nghe_nghiep">Nghề nghiệp</label>
                  <input id="entry-nghe_nghiep" disabled={readOnly || busy} aria-label="Nghề nghiệp" name="nghe_nghiep"
                    type="text"
                    className="form-input"
                    value={form.nghe_nghiep}
                    onChange={(e) => handleChange("nghe_nghiep", e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ============================================================== */}
        {/* MỤC II: TIỀN SỬ & LÂM SÀNG */}
        {/* ============================================================== */}
        <div
          ref={sectionRefs.sec2}
          id="entry-sec2"
          className={`section-accordion ${openSections.sec2 ? "is-open" : ""}`}
        >
          <button
            type="button"
            className="section-header-btn"
            aria-expanded={openSections.sec2}
            onClick={() => toggleSection("sec2")}
          >
            <div className="section-header-left">
              <span className="section-roman-badge">II</span>
              <div className="section-title-wrap">
                <h3>{compact ? "Tiền sử và lâm sàng" : "Tiền sử & lâm sàng"}</h3>
              </div>
            </div>
            <div className="section-header-right">
              <ChevronDown className="entry-section-chevron" size={19} aria-hidden="true"/>
              <span className={`section-count-badge ${countSec2 === 9 ? "is-complete" : ""}`}>
                {countSec2}/9 câu
              </span>
            </div>
          </button>

          {openSections.sec2 && (
            <div className="section-body">
              <div className="form-grid-3">
                {/* 6. Tuổi BN khi phẫu thuật */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-tuoi_phau_thuat">Tuổi BN khi phẫu thuật</label>
                  <input id="entry-tuoi_phau_thuat" disabled={readOnly || busy} aria-label="Tuổi BN khi phẫu thuật" name="tuoi_phau_thuat"
                    type="number" min="0" max="130"
                    className="form-input"
                    value={form.tuoi_phau_thuat}
                    onChange={(e) => handleChange("tuoi_phau_thuat", e.target.value)}
                  />
                </div>

                {/* 7. PARA */}
                <div className="form-item">
                  <label className="field-label" htmlFor="para">PARA</label>
                  <input disabled={readOnly || busy} id="para" aria-label="PARA" aria-describedby="para-hint" name="para"
                    type="text"
                    className="form-input"
                    maxLength={4}
                    placeholder="0000"
                    value={form.para}
                    onChange={(e) => handleChange("para", e.target.value)}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (/^\d+$/.test(v) && v.length < 4) {
                        handleChange("para", v.padStart(4, "0"));
                      }
                    }}
                  />
                  <span id="para-hint" className="field-hint field-helper">Ví dụ: 0000, 2002</span>
                </div>

                {/* 8. Kinh nguyệt */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-kinh_nguyet">Kinh nguyệt</label>
                  <select id="entry-kinh_nguyet" disabled={readOnly || busy} aria-label="Kinh nguyệt" name="kinh_nguyet"
                    className="form-select"
                    value={form.kinh_nguyet}
                    onChange={(e) => handleChange("kinh_nguyet", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Còn hành kinh">Còn hành kinh</option>
                    <option value="Đã mãn kinh">Đã mãn kinh</option>
                  </select>
                </div>

                {/* 9. Thời điểm phát hiện UBT */}
                <div className="form-item form-col-span-full">
                  <label className="field-label" htmlFor="entry-thoi_diem_phat_hien">Thời điểm phát hiện UBT</label>
                  <select id="entry-thoi_diem_phat_hien" disabled={readOnly || busy} aria-label="Thời điểm phát hiện UBT" name="thoi_diem_phat_hien"
                    className="form-select"
                    value={form.thoi_diem_phat_hien}
                    onChange={(e) => handleChange("thoi_diem_phat_hien", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Mới phát hiện">Mới phát hiện</option>
                    <option value="Đã biết > 3 tháng, không có sự thay đổi kích thước u">
                      Đã biết &gt; 3 tháng, không có sự thay đổi kích thước u
                    </option>
                    <option value="Đã biết > 3 tháng, có sự thay đổi kích thước u">
                      Đã biết &gt; 3 tháng, có sự thay đổi kích thước u
                    </option>
                    <option value="Đã biết > 3 tháng, không có dữ liệu theo dõi u">
                      Đã biết &gt; 3 tháng, không có dữ liệu theo dõi u
                    </option>
                    <option value="Không có dữ liệu">Không có dữ liệu</option>
                  </select>
                </div>

                {/* 10. Tiền căn phẫu thuật UBT */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-tien_can_phau_thuat_ubt">Tiền căn phẫu thuật UBT</label>
                  <select id="entry-tien_can_phau_thuat_ubt" disabled={readOnly || busy} aria-label="Tiền căn phẫu thuật UBT" name="tien_can_phau_thuat_ubt"
                    className="form-select"
                    value={form.tien_can_phau_thuat_ubt}
                    onChange={(e) => handleChange("tien_can_phau_thuat_ubt", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                    <option value="Ghi chú GPB nếu có">Ghi chú GPB nếu có</option>
                  </select>
                  {(form.tien_can_phau_thuat_ubt === "Có" || form.tien_can_phau_thuat_ubt === "Ghi chú GPB nếu có") && (
                    <div className="conditional-box">
                      <label className="conditional-box-label">
                        Ghi chú GPB nếu có
                      </label>
                      <input disabled={readOnly || busy} aria-label="tien_can_phau_thuat_ubt_ghi_chu" name="tien_can_phau_thuat_ubt_ghi_chu"
                        type="text"
                        className="form-input"
                        placeholder="Nhập ghi chú GPB nếu có..."
                        value={form.tien_can_phau_thuat_ubt_ghi_chu}
                        onChange={(e) => handleChange("tien_can_phau_thuat_ubt_ghi_chu", e.target.value)}
                      />
                    </div>
                  )}
                </div>

                {/* 11. Tiền căn ung thư khác */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-tien_can_ung_thu_khac">Tiền căn ung thư khác</label>
                  <select id="entry-tien_can_ung_thu_khac" disabled={readOnly || busy} aria-label="Tiền căn ung thư khác" name="tien_can_ung_thu_khac"
                    className="form-select"
                    value={form.tien_can_ung_thu_khac}
                    onChange={(e) => handleChange("tien_can_ung_thu_khac", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                    <option value="Ghi chú loại ung thư nếu có">Ghi chú loại ung thư nếu có</option>
                  </select>
                  {(form.tien_can_ung_thu_khac === "Có" || form.tien_can_ung_thu_khac === "Ghi chú loại ung thư nếu có") && (
                    <div className="conditional-box">
                      <label className="conditional-box-label">
                        Ghi chú loại ung thư nếu có
                      </label>
                      <input disabled={readOnly || busy} aria-label="tien_can_ung_thu_khac_ghi_chu" name="tien_can_ung_thu_khac_ghi_chu"
                        type="text"
                        className="form-input"
                        placeholder="Nhập ghi chú loại ung thư..."
                        value={form.tien_can_ung_thu_khac_ghi_chu}
                        onChange={(e) => handleChange("tien_can_ung_thu_khac_ghi_chu", e.target.value)}
                      />
                    </div>
                  )}
                </div>

                {/* 12. Tiền căn lạc nội mạc tử cung */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-tien_can_lac_nmtc">Tiền căn lạc nội mạc tử cung</label>
                  <select id="entry-tien_can_lac_nmtc" disabled={readOnly || busy} aria-label="Tiền căn lạc nội mạc tử cung" name="tien_can_lac_nmtc"
                    className="form-select"
                    value={form.tien_can_lac_nmtc}
                    onChange={(e) => handleChange("tien_can_lac_nmtc", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                </div>

                {/* 13. Có thai */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-co_thai">Có thai</label>
                  <select id="entry-co_thai" disabled={readOnly || busy} aria-label="Có thai" name="co_thai"
                    className="form-select"
                    value={form.co_thai}
                    onChange={(e) => handleChange("co_thai", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                </div>

                {/* 16. UBT nhiễm trùng */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-ubt_nhiem_trung">UBT nhiễm trùng</label>
                  <select id="entry-ubt_nhiem_trung" disabled={readOnly || busy} aria-label="UBT nhiễm trùng" name="ubt_nhiem_trung"
                    className="form-select"
                    value={form.ubt_nhiem_trung}
                    onChange={(e) => handleChange("ubt_nhiem_trung", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ============================================================== */}
        {/* MỤC III: DẤU ẤN SINH HỌC */}
        {/* ============================================================== */}
        <div
          ref={sectionRefs.sec3}
          id="entry-sec3"
          className={`section-accordion ${openSections.sec3 ? "is-open" : ""}`}
        >
          <button
            type="button"
            className="section-header-btn"
            aria-expanded={openSections.sec3}
            onClick={() => toggleSection("sec3")}
          >
            <div className="section-header-left">
              <span className="section-roman-badge">III</span>
              <div className="section-title-wrap">
                <h3>{compact ? "Dấu ấn sinh học" : "Dấu ấn sinh học"}</h3>
              </div>
            </div>
            <div className="section-header-right">
              <ChevronDown className="entry-section-chevron" size={19} aria-hidden="true"/>
              <span className={`section-count-badge ${countSec3 === 5 ? "is-complete" : ""}`}>
                {countSec3}/5 câu
              </span>
            </div>
          </button>

          {openSections.sec3 && (
            <div className="section-body">
              <div className="form-grid-3">
                {/* 17. CA 125 */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-ca_125">CA 125</label>
                  <input id="entry-ca_125" disabled={readOnly || busy} aria-label="CA 125" name="ca_125"
                    type="number" min="0"
                    step="any"
                    className="form-input"
                    value={form.ca_125}
                    onChange={(e) => handleChange("ca_125", e.target.value)}
                  />
                </div>

                {/* 18. HE4 */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-he4">HE4</label>
                  <input id="entry-he4" disabled={readOnly || busy} aria-label="HE4" name="he4"
                    type="number" min="0"
                    step="any"
                    className="form-input"
                    value={form.he4}
                    onChange={(e) => handleChange("he4", e.target.value)}
                  />
                </div>

                {/* 19. ROMA */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-roma">ROMA</label>
                  <input id="entry-roma" disabled={readOnly || busy} aria-label="ROMA" name="roma"
                    type="number" min="0" max="100"
                    step="any"
                    className="form-input"
                    value={form.roma}
                    onChange={(e) => handleChange("roma", e.target.value)}
                  />
                </div>

                {/* 20. AFP */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-afp">AFP</label>
                  <input id="entry-afp" disabled={readOnly || busy} aria-label="AFP" name="afp"
                    type="number" min="0"
                    step="any"
                    className="form-input"
                    value={form.afp}
                    onChange={(e) => handleChange("afp", e.target.value)}
                  />
                </div>

                {/* 21. beta hCG */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-beta_hcg">beta hCG</label>
                  <input id="entry-beta_hcg" disabled={readOnly || busy} aria-label="beta hCG" name="beta_hcg"
                    type="number" min="0"
                    step="any"
                    className="form-input"
                    value={form.beta_hcg}
                    onChange={(e) => handleChange("beta_hcg", e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ============================================================== */}
        {/* MỤC IV: ĐẶC ĐIỂM SIÊU ÂM (IOTA / O-RADS) */}
        {/* ============================================================== */}
        <div
          ref={sectionRefs.sec4}
          id="entry-sec4"
          className={`section-accordion ${openSections.sec4 ? "is-open" : ""}`}
        >
          <button
            type="button"
            className="section-header-btn"
            aria-expanded={openSections.sec4}
            onClick={() => toggleSection("sec4")}
          >
            <div className="section-header-left">
              <span className="section-roman-badge">IV</span>
              <div className="section-title-wrap">
                <h3>{compact ? "Siêu âm" : "Đặc điểm siêu âm"}</h3>
              </div>
            </div>
            <div className="section-header-right">
              <ChevronDown className="entry-section-chevron" size={19} aria-hidden="true"/>
              <span className={`section-count-badge ${countSec4 === 17 ? "is-complete" : ""}`}>
                {countSec4}/17 câu
              </span>
            </div>
          </button>

          {openSections.sec4 && (
            <div className="section-body">
              <div className="form-grid-2">
                {/* 22. Số lượng u */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-sa_so_luong_u">Số lượng u</label>
                  <select id="entry-sa_so_luong_u" disabled={readOnly || busy} aria-label="Số lượng u (Siêu âm)" name="sa_so_luong_u"
                    className="form-select"
                    value={form.sa_so_luong_u}
                    onChange={(e) => handleChange("sa_so_luong_u", e.target.value)}
                  >
                    {choiceOptions("sa_so_luong_u")}
                  </select>
                </div>

                {/* 23. Mô buồng trứng */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-sa_mo_buong_trung">Mô buồng trứng</label>
                  <select id="entry-sa_mo_buong_trung" disabled={readOnly || busy} aria-label="Mô buồng trứng (Siêu âm)" name="sa_mo_buong_trung"
                    className="form-select"
                    value={form.sa_mo_buong_trung}
                    onChange={(e) => handleChange("sa_mo_buong_trung", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Còn">Còn</option>
                    <option value="Không quan sát thấy">Không quan sát thấy</option>
                    <option value="Không đánh giá">Không đánh giá</option>
                  </select>
                </div>

                {/* 24. Phân loại u */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-sa_phan_loai_u">Phân loại u</label>
                  <select id="entry-sa_phan_loai_u" disabled={readOnly || busy} aria-label="Phân loại u (Siêu âm)" name="sa_phan_loai_u"
                    className="form-select"
                    value={form.sa_phan_loai_u}
                    onChange={(e) => handleChange("sa_phan_loai_u", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Đơn thùy">Đơn thùy</option>
                    <option value="Đơn thùy đặc">Đơn thùy đặc</option>
                    <option value="Đa thùy">Đa thùy</option>
                    <option value="Đa thùy đặc">Đa thùy đặc</option>
                    <option value="U đặc">U đặc</option>
                    <option value="Không phân loại">Không phân loại</option>
                  </select>
                </div>

                {/* 25. Phản âm (chọn nhiều lựa chọn) */}
                <div className="form-item form-col-span-full">
                  <label className="field-label">Phản âm (chọn nhiều lựa chọn)</label>
                  <div className="chip-group">
                    {["Trống", "Kém", "Hỗn hợp", "Kính mờ", "Xuất huyết", "Dày sáng"].map((opt) => {
                      const isChecked = Array.isArray(form.sa_phan_am) && form.sa_phan_am.includes(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          disabled={readOnly || busy} aria-pressed={isChecked} className={`toggle-chip ${isChecked ? "active" : ""}`}
                          onClick={() => handleCheckboxMulti("sa_phan_am", opt)}
                        >
                          {isChecked && <Check size={16} />} {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 26. Kích thước u */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-sa_kich_thuoc_u">Kích thước u</label>
                  <input id="entry-sa_kich_thuoc_u" disabled={readOnly || busy} aria-label="Kích thước u (Siêu âm)" name="sa_kich_thuoc_u"
                    type="number" min="0"
                    className="form-input"
                    value={form.sa_kich_thuoc_u}
                    onChange={(e) => handleChange("sa_kich_thuoc_u", e.target.value)}
                  />
                </div>

                {/* 27. Bờ ngoài */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-sa_bo_ngoai">Bờ ngoài</label>
                  <select id="entry-sa_bo_ngoai" disabled={readOnly || busy} aria-label="Bờ ngoài" name="sa_bo_ngoai"
                    className="form-select"
                    value={form.sa_bo_ngoai}
                    onChange={(e) => handleChange("sa_bo_ngoai", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không đều">Không đều</option>
                    <option value="Đều">Đều</option>
                    <option value="Không đánh giá">Không đánh giá</option>
                  </select>
                </div>

                {/* 28. Bờ trong */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-sa_bo_trong">Bờ trong</label>
                  <select id="entry-sa_bo_trong" disabled={readOnly || busy} aria-label="Bờ trong" name="sa_bo_trong"
                    className="form-select"
                    value={form.sa_bo_trong}
                    onChange={(e) => handleChange("sa_bo_trong", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không trơn láng">Không trơn láng</option>
                    <option value="Trơn láng">Trơn láng</option>
                    <option value="Không đánh giá">Không đánh giá</option>
                  </select>
                </div>

                {/* 29. Số lượng thùy */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-sa_so_luong_thuy">Số lượng thùy</label>
                  <select id="entry-sa_so_luong_thuy" disabled={readOnly || busy} aria-label="Số lượng thùy" name="sa_so_luong_thuy"
                    className="form-select"
                    value={form.sa_so_luong_thuy}
                    onChange={(e) => handleChange("sa_so_luong_thuy", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="0">0 (u đặc / không thùy)</option>
                    <option value="1">1</option>
                    <option value="2-10">2-10</option>
                    <option value=">10">&gt; 10</option>
                  </select>
                </div>

                {/* 30. Kích thước phần đặc */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-sa_kich_thuoc_phan_dac">Kích thước phần đặc</label>
                  <input id="entry-sa_kich_thuoc_phan_dac" disabled={readOnly || busy} aria-label="Kích thước phần đặc (Siêu âm)" name="sa_kich_thuoc_phan_dac"
                    type="number" min="0"
                    className="form-input"
                    value={form.sa_kich_thuoc_phan_dac}
                    onChange={(e) => handleChange("sa_kich_thuoc_phan_dac", e.target.value)}
                  />
                </div>

                {/* 31. Bóng lưng */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-sa_bong_lung">Bóng lưng</label>
                  <select id="entry-sa_bong_lung" disabled={readOnly || busy} aria-label="Bóng lưng" name="sa_bong_lung"
                    className="form-select"
                    value={form.sa_bong_lung}
                    onChange={(e) => handleChange("sa_bong_lung", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                </div>

                {/* 32. Nang trong phần đặc */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-sa_nang_trong_phan_dac">Nang trong phần đặc</label>
                  <select id="entry-sa_nang_trong_phan_dac" disabled={readOnly || busy} aria-label="Nang trong phần đặc" name="sa_nang_trong_phan_dac"
                    className="form-select"
                    value={form.sa_nang_trong_phan_dac ? (form.sa_nang_trong_phan_dac === "Không" ? "Không" : "Có") : ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleChange("sa_nang_trong_phan_dac", val);
                      if (val === "Không") {
                        handleChange("sa_nang_trong_phan_dac_so_luong", "");
                      }
                    }}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                  {form.sa_nang_trong_phan_dac === "Có" && (
                    <div className="conditional-box">
                      <label className="conditional-box-label">
                        Có bao nhiêu nang trong phần đặc?
                      </label>
                      <input disabled={readOnly || busy} aria-label="sa_nang_trong_phan_dac_so_luong" name="sa_nang_trong_phan_dac_so_luong"
                        type="text"
                        className="form-input"
                        placeholder="Ví dụ: 1 nang, 2 nang, nhiều nang nhỏ..."
                        value={form.sa_nang_trong_phan_dac_so_luong || ""}
                        onChange={(e) => handleChange("sa_nang_trong_phan_dac_so_luong", e.target.value)}
                      />
                    </div>
                  )}
                </div>

                {/* 33. Chồi */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-sa_choi">Chồi</label>
                  <select id="entry-sa_choi" disabled={readOnly || busy} aria-label="Chồi" name="sa_choi"
                    className="form-select"
                    value={form.sa_choi ? (form.sa_choi === "Không" ? "Không" : "Có") : ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "Không") {
                        handleChange("sa_choi", "Không");
                      } else {
                        handleChange("sa_choi", ["1", "2", "3", ">3"].includes(form.sa_choi) ? form.sa_choi : "1");
                      }
                    }}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                  {form.sa_choi !== "Không" && Boolean(form.sa_choi) && (
                    <div className="conditional-box">
                      <label className="conditional-box-label">
                        Có bao nhiêu chồi?
                      </label>
                      <select disabled={readOnly || busy}
                        className="form-select"
                        value={["1", "2", "3", ">3"].includes(form.sa_choi) ? form.sa_choi : "1"}
                        onChange={(e) => handleChange("sa_choi", e.target.value)}
                      >
                        <option value="">-- Chọn --</option>
                        <option value="1">1 chồi</option>
                        <option value="2">2 chồi</option>
                        <option value="3">3 chồi</option>
                        <option value=">3">&gt; 3 chồi</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* 34. Tăng sinh mạch máu */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-sa_tang_sinh_mach_mau">Tăng sinh mạch máu</label>
                  <select id="entry-sa_tang_sinh_mach_mau" disabled={readOnly || busy} aria-label="Tăng sinh mạch máu" name="sa_tang_sinh_mach_mau"
                    className="form-select"
                    value={form.sa_tang_sinh_mach_mau}
                    onChange={(e) => handleChange("sa_tang_sinh_mach_mau", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không tăng sinh">Không tăng sinh (0)</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="Không đánh giá">Không đánh giá</option>
                  </select>
                </div>

                {/* 35. Dịch ổ bụng */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-sa_dich_o_bung">Dịch ổ bụng</label>
                  <select id="entry-sa_dich_o_bung" disabled={readOnly || busy} aria-label="Dịch ổ bụng (Siêu âm)" name="sa_dich_o_bung"
                    className="form-select"
                    value={form.sa_dich_o_bung}
                    onChange={(e) => handleChange("sa_dich_o_bung", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Cùng đồ">Cùng đồ</option>
                    <option value="2 hố chậu">2 hố chậu</option>
                    <option value="khoảng gan thận">khoảng gan thận</option>
                    <option value="Dịch màng phổi">Dịch màng phổi</option>
                  </select>
                </div>

                {/* 36. Tổn thương NMTC */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-sa_ton_thuong_nmtc">Tổn thương NMTC</label>
                  <select id="entry-sa_ton_thuong_nmtc" disabled={readOnly || busy} aria-label="Tổn thương NMTC" name="sa_ton_thuong_nmtc"
                    className="form-select"
                    value={form.sa_ton_thuong_nmtc}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleChange("sa_ton_thuong_nmtc", val);
                      if (val === "Không") {
                        handleChange("sa_ton_thuong_nmtc_ghi_chu", "");
                      }
                    }}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                  {form.sa_ton_thuong_nmtc === "Có" && (
                    <div className="conditional-box">
                      <label className="conditional-box-label">
                        Ghi chú tổn thương tử cung
                      </label>
                      <input disabled={readOnly || busy} aria-label="sa_ton_thuong_nmtc_ghi_chu" name="sa_ton_thuong_nmtc_ghi_chu"
                        type="text"
                        className="form-input"
                        placeholder="Nhập ghi chú tổn thương tử cung..."
                        value={form.sa_ton_thuong_nmtc_ghi_chu || ""}
                        onChange={(e) => handleChange("sa_ton_thuong_nmtc_ghi_chu", e.target.value)}
                      />
                    </div>
                  )}
                </div>

                <div className="form-item form-col-span-full">
                  <label className="field-label" htmlFor="entry-sa_ket_luan">Kết luận siêu âm</label>
                  <textarea id="entry-sa_ket_luan" name="sa_ket_luan" className="form-input"
                    disabled={readOnly || busy} rows={3} maxLength={4000}
                    value={form.sa_ket_luan || ""}
                    onChange={event => handleChange("sa_ket_luan", event.target.value)}
                  />
                </div>

                {/* IOTA ADNEX */}
                <div className="form-item form-col-span-full">
                  <div className="iota-panel">
                    <div className="iota-panel-header">
                      <div>
                        <label className="iota-panel-title">
                          IOTA ADNEX
                        </label>
                        <div className="iota-panel-desc">
                          Quy ước riêng của phiếu nghiên cứu: tổng cả 6 ô phải bằng 100%.
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {isIotaSumInvalid ? (
                          <span className="iota-status-pill is-invalid">
                            ⚠️ Tổng 6 ô: {formatIota(iotaTotal)}%
                          </span>
                        ) : isIotaSumValid ? (
                          <span className="iota-status-pill is-valid">
                            ✓ Tổng 6 ô: 100%
                          </span>
                        ) : (
                          <span className="iota-status-pill is-idle">
                            Tổng 6 ô = 100%
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="form-grid-3">
                      {/* Benign tumor */}
                      <div className="form-item">
                        <label className="field-label">Benign tumor (%)</label>
                        <input disabled={readOnly || busy} aria-label="IOTA - Benign (%)" name="iota_benign"
                          type="number" min="0" max="100"
                          step="0.1"
                          className="form-input"
                          style={
                            isIotaSumInvalid
                              ? { borderColor: "#ef4444", backgroundColor: "#fff5f5" }
                              : isIotaSumValid
                              ? { borderColor: "#10b981", backgroundColor: "#ecfdf5" }
                              : undefined
                          }
                          value={form.iota_benign}
                          onChange={(e) => handleChange("iota_benign", e.target.value)}
                        />
                      </div>

                      {/* Malignant */}
                      <div className="form-item">
                        <label className="field-label">Malignant (%)</label>
                        <input disabled={readOnly || busy} aria-label="IOTA - Malignant (%)" name="iota_malignant"
                          type="number" min="0" max="100"
                          step="0.1"
                          className="form-input"
                          style={
                            isIotaSumInvalid
                              ? { borderColor: "#ef4444", backgroundColor: "#fff5f5" }
                              : isIotaSumValid
                              ? { borderColor: "#10b981", backgroundColor: "#ecfdf5" }
                              : undefined
                          }
                          value={form.iota_malignant}
                          onChange={(e) => handleChange("iota_malignant", e.target.value)}
                        />
                      </div>

                      {/* Borderline */}
                      <div className="form-item">
                        <label className="field-label">Borderline (%)</label>
                        <input disabled={readOnly || busy} aria-label="IOTA - Borderline (%)" name="iota_borderline"
                          type="number" min="0" max="100"
                          step="0.1"
                          className="form-input"
                          style={
                            isIotaSumInvalid
                              ? { borderColor: "#ef4444", backgroundColor: "#fff5f5" }
                              : isIotaSumValid
                              ? { borderColor: "#10b981", backgroundColor: "#ecfdf5" }
                              : undefined
                          }
                          value={form.iota_borderline}
                          onChange={(e) => handleChange("iota_borderline", e.target.value)}
                        />
                      </div>

                      {/* Stage I */}
                      <div className="form-item">
                        <label className="field-label">Stage I (%)</label>
                        <input disabled={readOnly || busy} aria-label="IOTA - Stage I (%)" name="iota_stage1"
                          type="number" min="0" max="100"
                          step="0.1"
                          className="form-input"
                          style={
                            isIotaSumInvalid
                              ? { borderColor: "#ef4444", backgroundColor: "#fff5f5" }
                              : isIotaSumValid
                              ? { borderColor: "#10b981", backgroundColor: "#ecfdf5" }
                              : undefined
                          }
                          value={form.iota_stage1}
                          onChange={(e) => handleChange("iota_stage1", e.target.value)}
                        />
                      </div>

                      {/* Stage II-IV */}
                      <div className="form-item">
                        <label className="field-label">Stage II-IV (%)</label>
                        <input disabled={readOnly || busy} aria-label="IOTA - Stage II-IV (%)" name="iota_stage2_4"
                          type="number" min="0" max="100"
                          step="0.1"
                          className="form-input"
                          style={
                            isIotaSumInvalid
                              ? { borderColor: "#ef4444", backgroundColor: "#fff5f5" }
                              : isIotaSumValid
                              ? { borderColor: "#10b981", backgroundColor: "#ecfdf5" }
                              : undefined
                          }
                          value={form.iota_stage2_4}
                          onChange={(e) => handleChange("iota_stage2_4", e.target.value)}
                        />
                      </div>

                      {/* Metastatic */}
                      <div className="form-item">
                        <label className="field-label">Metastatic (%)</label>
                        <input disabled={readOnly || busy} aria-label="IOTA - Metastatic (%)" name="iota_metastatic"
                          type="number" min="0" max="100"
                          step="0.1"
                          className="form-input"
                          style={
                            isIotaSumInvalid
                              ? { borderColor: "#ef4444", backgroundColor: "#fff5f5" }
                              : isIotaSumValid
                              ? { borderColor: "#10b981", backgroundColor: "#ecfdf5" }
                              : undefined
                          }
                          value={form.iota_metastatic}
                          onChange={(e) => handleChange("iota_metastatic", e.target.value)}
                        />
                      </div>
                    </div>

                    {isIotaSumInvalid && (
                      <div className="iota-feedback is-invalid">
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span>⚠️</span>
                          <span>{iotaError}</span>
                        </div>
                        <button type="button" onClick={handleResetIota} className="iota-reset-btn">
                          ↺ Xóa làm lại
                        </button>
                      </div>
                    )}

                    {isIotaSumValid && (
                      <div className="iota-feedback is-valid">
                        <span>✓ Tổng cả 6 ô bằng 100%, đúng quy ước nhập của phiếu.</span>
                        <button type="button" onClick={handleResetIota} className="iota-reset-btn">
                          ↺ Nhập lại
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ============================================================== */}
        {/* MỤC V: ĐẶC ĐIỂM CỘNG HƯỞNG TỪ (MRI) */}
        {/* ============================================================== */}
        <div
          ref={sectionRefs.sec5}
          id="entry-sec5"
          className={`section-accordion ${openSections.sec5 ? "is-open" : ""}`}
        >
          <button
            type="button"
            className="section-header-btn"
            aria-expanded={openSections.sec5}
            onClick={() => toggleSection("sec5")}
          >
            <div className="section-header-left">
              <span className="section-roman-badge">V</span>
              <div className="section-title-wrap">
                <h3>{compact ? "Cộng hưởng từ (MRI)" : "Cộng hưởng từ (MRI)"}</h3>
              </div>
            </div>
            <div className="section-header-right">
              <ChevronDown className="entry-section-chevron" size={19} aria-hidden="true"/>
              <span className={`section-count-badge ${countSec5 === 16 ? "is-complete" : ""}`}>
                {countSec5}/16 câu
              </span>
            </div>
          </button>

          {openSections.sec5 && (
            <div className="section-body">
              <div className="form-grid-2">
                {/* 39. Số lượng u */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-mri_so_luong_u">Số lượng u</label>
                  <select id="entry-mri_so_luong_u" disabled={readOnly || busy} aria-label="Số lượng u (MRI)" name="mri_so_luong_u"
                    className="form-select"
                    value={form.mri_so_luong_u}
                    onChange={(e) => handleChange("mri_so_luong_u", e.target.value)}
                  >
                    {choiceOptions("mri_so_luong_u")}
                  </select>
                </div>

                {/* 40. Mô buồng trứng */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-mri_mo_buong_trung">Mô buồng trứng</label>
                  <select id="entry-mri_mo_buong_trung" disabled={readOnly || busy} aria-label="Mô buồng trứng (MRI)" name="mri_mo_buong_trung"
                    className="form-select"
                    value={form.mri_mo_buong_trung}
                    onChange={(e) => handleChange("mri_mo_buong_trung", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Còn">Còn</option>
                    <option value="Không quan sát thấy">Không quan sát thấy</option>
                    <option value="Không đánh giá">Không đánh giá</option>
                  </select>
                </div>

                {/* 41. Dạng tổn thương */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-mri_dang_ton_thuong">Dạng tổn thương</label>
                  <select id="entry-mri_dang_ton_thuong" disabled={readOnly || busy} aria-label="Dạng tổn thương (MRI)" name="mri_dang_ton_thuong"
                    className="form-select"
                    value={form.mri_dang_ton_thuong}
                    onChange={(e) => handleChange("mri_dang_ton_thuong", e.target.value)}
                  >
                    {choiceOptions("mri_dang_ton_thuong")}
                  </select>
                </div>

                {/* 42. Kích thước u */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-mri_kich_thuoc_u">Kích thước u</label>
                  <input id="entry-mri_kich_thuoc_u" disabled={readOnly || busy} aria-label="Kích thước u (MRI)" name="mri_kich_thuoc_u"
                    type="number" min="0"
                    className="form-input"
                    value={form.mri_kich_thuoc_u}
                    onChange={(e) => handleChange("mri_kich_thuoc_u", e.target.value)}
                  />
                </div>

                {/* 43. Dịch nang (T1W và T2W - 5 biến chuẩn) */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-mri_dich_nang_t1w">Dịch nang (T1W)</label>
                  <select id="entry-mri_dich_nang_t1w" disabled={readOnly || busy} aria-label="mri_dich_nang_t1w" name="mri_dich_nang_t1w"
                    className="form-select"
                    value={form.mri_dich_nang_t1w || ""}
                    onChange={(e) => {
                      const t1 = e.target.value;
                      handleChange("mri_dich_nang_t1w", t1);
                      const t2 = form.mri_dich_nang_t2w || "";
                      handleChange("mri_dich_nang", `T1w: ${t1}, T2w: ${t2}`);
                    }}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="thấp">Thấp</option>
                    <option value="cao">Cao</option>
                    <option value="trung gian">Trung gian</option>
                    <option value="cao và thấp">Cao và thấp (Không đồng nhất)</option>
                    <option value="không xác định">Không xác định</option>
                  </select>
                </div>

                <div className="form-item">
                  <label className="field-label" htmlFor="entry-mri_dich_nang_t2w">Dịch nang (T2W)</label>
                  <select id="entry-mri_dich_nang_t2w" disabled={readOnly || busy} aria-label="mri_dich_nang_t2w" name="mri_dich_nang_t2w"
                    className="form-select"
                    value={form.mri_dich_nang_t2w || ""}
                    onChange={(e) => {
                      const t2 = e.target.value;
                      handleChange("mri_dich_nang_t2w", t2);
                      const t1 = form.mri_dich_nang_t1w || "";
                      handleChange("mri_dich_nang", `T1w: ${t1}, T2w: ${t2}`);
                    }}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="cao">Cao</option>
                    <option value="thấp">Thấp</option>
                    <option value="trung gian">Trung gian</option>
                    <option value="cao và thấp">Cao và thấp (Không đồng nhất)</option>
                    <option value="không xác định">Không xác định</option>
                  </select>
                </div>

                {/* 44. Thành phần mỡ */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-mri_thanh_phan_mo">Thành phần mỡ</label>
                  <select id="entry-mri_thanh_phan_mo" disabled={readOnly || busy} aria-label="Thành phần mỡ" name="mri_thanh_phan_mo"
                    className="form-select"
                    value={form.mri_thanh_phan_mo}
                    onChange={(e) => handleChange("mri_thanh_phan_mo", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                </div>

                {/* 45. Phần đặc */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-mri_phan_dac">Phần đặc</label>
                  <select id="entry-mri_phan_dac" disabled={readOnly || busy} aria-label="Phần đặc (MRI)" name="mri_phan_dac"
                    className="form-select"
                    value={form.mri_phan_dac}
                    onChange={(e) => handleChange("mri_phan_dac", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                  {form.mri_phan_dac === "Có" && (
                    <div className="conditional-box">
                      <label className="conditional-box-label">
                        Kích thước phần đặc
                      </label>
                      <input disabled={readOnly || busy} aria-label="Kích thước phần đặc (MRI)" name="mri_kich_thuoc_phan_dac"
                        type="number" min="0"
                        className="form-input"
                        value={form.mri_kich_thuoc_phan_dac}
                        onChange={(e) => handleChange("mri_kich_thuoc_phan_dac", e.target.value)}
                      />
                    </div>
                  )}
                </div>

                {/* 47. Khuếch tán */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-mri_khuech_tan">Khuếch tán</label>
                  <select id="entry-mri_khuech_tan" disabled={readOnly || busy} aria-label="Khuếch tán" name="mri_khuech_tan"
                    className="form-select"
                    value={form.mri_khuech_tan}
                    onChange={(e) => handleChange("mri_khuech_tan", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không giới hạn">Không giới hạn</option>
                    <option value="Giới hạn">Giới hạn</option>
                    <option value="Không đánh giá">Không đánh giá</option>
                  </select>
                </div>

                <div className="form-item">
                  <label className="field-label" htmlFor="entry-mri_tang_sinh_mach_mau">Tăng sinh mạch máu</label>
                  <select id="entry-mri_tang_sinh_mach_mau" disabled={readOnly || busy} aria-label="Tăng sinh mạch máu (MRI)" name="mri_tang_sinh_mach_mau"
                    className="form-select"
                    value={form.mri_tang_sinh_mach_mau}
                    onChange={(e) => handleChange("mri_tang_sinh_mach_mau", e.target.value)}
                  >
                    {choiceOptions("mri_tang_sinh_mach_mau")}
                  </select>
                </div>

                {/* 48. Đặc điểm ngấm thuốc tương phản từ */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-mri_ngam_thuoc">Đặc điểm ngấm thuốc tương phản từ</label>
                  <select id="entry-mri_ngam_thuoc" disabled={readOnly || busy} aria-label="Đặc điểm ngấm thuốc tương phản từ" name="mri_ngam_thuoc"
                    className="form-select"
                    value={form.mri_ngam_thuoc}
                    onChange={(e) => handleChange("mri_ngam_thuoc", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="type 1">type 1</option>
                    <option value="type 2">type 2</option>
                    <option value="type 3">type 3</option>
                    <option value="kém hơn cơ tử cung">kém hơn cơ tử cung</option>
                    <option value="nhiều hơn cơ tử cung">nhiều hơn cơ tử cung</option>
                    <option value="Không đánh giá">Không đánh giá</option>
                  </select>
                </div>

                {/* 49. Hạch */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-mri_hach">Hạch</label>
                  <select id="entry-mri_hach" disabled={readOnly || busy} aria-label="Hạch" name="mri_hach"
                    className="form-select"
                    value={form.mri_hach}
                    onChange={(e) => handleChange("mri_hach", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                </div>

                {/* 50. Dịch ổ bụng */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-mri_dich_o_bung">Dịch ổ bụng</label>
                  <select id="entry-mri_dich_o_bung" disabled={readOnly || busy} aria-label="Dịch ổ bụng (MRI)" name="mri_dich_o_bung"
                    className="form-select"
                    value={form.mri_dich_o_bung}
                    onChange={(e) => handleChange("mri_dich_o_bung", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Cùng đồ">Cùng đồ</option>
                    <option value="2 hố chậu">2 hố chậu</option>
                    <option value="khoảng gan thận">khoảng gan thận</option>
                    <option value="Dịch màng phổi">Dịch màng phổi</option>
                  </select>
                </div>

                {/* 51. Tổn thương cơ quan khác */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-mri_ton_thuong_co_quan_khac">Tổn thương cơ quan khác</label>
                  <input id="entry-mri_ton_thuong_co_quan_khac" disabled={readOnly || busy} aria-label="Tổn thương cơ quan khác" name="mri_ton_thuong_co_quan_khac"
                    type="text"
                    className="form-input"
                    value={form.mri_ton_thuong_co_quan_khac}
                    onChange={(e) => handleChange("mri_ton_thuong_co_quan_khac", e.target.value)}
                  />
                </div>

                {/* ORADS */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-sa_orads">ORADS</label>
                  <select id="entry-sa_orads" disabled={readOnly || busy} aria-label="ORADS (Siêu âm)" name="sa_orads"
                    className="form-select"
                    value={form.sa_orads}
                    onChange={(e) => handleChange("sa_orads", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="0">0</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="5">5</option>
                  </select>
                </div>

                {/* 52. Kết luận MRI */}
                <div className="form-item form-col-span-full">
                  <label className="field-label" htmlFor="entry-mri_ket_luan">Kết luận MRI</label>
                  <input id="entry-mri_ket_luan" disabled={readOnly || busy} aria-label="Kết luận MRI" name="mri_ket_luan"
                    type="text"
                    className="form-input"
                    value={form.mri_ket_luan}
                    onChange={(e) => handleChange("mri_ket_luan", e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ============================================================== */}
        {/* ============================================================== */}
        {/* MỤC VI: PROTOCOL PHẪU THUẬT */}
        {/* ============================================================== */}
        <div
          ref={sectionRefs.sec6}
          id="entry-sec6"
          className={`section-accordion ${openSections.sec6 ? "is-open" : ""}`}
        >
          <button
            type="button"
            className="section-header-btn"
            aria-expanded={openSections.sec6}
            onClick={() => toggleSection("sec6")}
          >
            <div className="section-header-left">
              <span className="section-roman-badge">VI</span>
              <div className="section-title-wrap">
                <h3>{compact ? "Phẫu thuật" : "Thông tin phẫu thuật"}</h3>
              </div>
            </div>
            <div className="section-header-right">
              <ChevronDown className="entry-section-chevron" size={19} aria-hidden="true"/>
              <span className={`section-count-badge ${countSec6 === surgeryFieldTotal ? "is-complete" : ""}`}>
                {countSec6}/{surgeryFieldTotal} mục
              </span>
            </div>
          </button>

          {openSections.sec6 && (
            <div className="section-body">
              <div className="form-grid-2">
                {/* 1. Chẩn đoán trước phẫu thuật */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-pt_chan_doan_truoc">1. Chẩn đoán trước phẫu thuật</label>
                  <select id="entry-pt_chan_doan_truoc" disabled={readOnly || busy} aria-label="Chẩn đoán trước phẫu thuật" name="pt_chan_doan_truoc"
                    className="form-select"
                    value={form.pt_chan_doan_truoc}
                    onChange={(e) => handleChange("pt_chan_doan_truoc", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="u buồng trứng">u buồng trứng</option>
                    <option value="ung thư buồng trứng">ung thư buồng trứng</option>
                  </select>
                </div>

                {/* 2. Chẩn đoán sau phẫu thuật */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-pt_chan_doan_sau">2. Chẩn đoán sau phẫu thuật</label>
                  <select id="entry-pt_chan_doan_sau" disabled={readOnly || busy} aria-label="Chẩn đoán sau phẫu thuật" name="pt_chan_doan_sau"
                    className="form-select"
                    value={form.pt_chan_doan_sau}
                    onChange={(e) => handleChange("pt_chan_doan_sau", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="u buồng trứng">u buồng trứng</option>
                    <option value="ung thư buồng trứng">ung thư buồng trứng</option>
                  </select>
                </div>

                {/* 3. Phương pháp phẫu thuật (chọn nhiều lựa chọn) */}
                <div className="form-item form-col-span-full">
                  <label className="field-label">
                    <span>3. Phương pháp phẫu thuật</span>
                    <span className="field-hint">(Chọn nhiều lựa chọn)</span>
                  </label>
                  <div className="chip-group">
                    {[
                      "cắt u",
                      "cắt phần phụ",
                      "cắt tử cung",
                      "cắt mạc nối lớn và phân giai đoạn",
                    ].map((opt) => {
                      const selectedMethods = Array.isArray(form.pt_phuong_phap)
                        ? form.pt_phuong_phap
                        : (typeof form.pt_phuong_phap === "string" && form.pt_phuong_phap ? form.pt_phuong_phap.split(", ") : []);
                      const isChecked = selectedMethods.includes(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          disabled={readOnly || busy} aria-pressed={isChecked} className={`toggle-chip ${isChecked ? "active" : ""}`}
                          onClick={() => {
                            const next = isChecked
                              ? selectedMethods.filter((m: string) => m !== opt)
                              : [...selectedMethods, opt];
                            handleChange("pt_phuong_phap", next);
                          }}
                        >
                          {isChecked && <Check size={16} />} <span style={{ textTransform: "capitalize" }}>{opt}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 4. Sinh thiết lạnh */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-pt_sinh_thiet_lanh">4. Sinh thiết lạnh</label>
                  <select id="entry-pt_sinh_thiet_lanh" disabled={readOnly || busy} aria-label="Sinh thiết lạnh" name="pt_sinh_thiet_lanh"
                    className="form-select"
                    value={form.pt_sinh_thiet_lanh}
                    onChange={e => handleChange("pt_sinh_thiet_lanh", e.target.value)}
                  >
                    {choiceOptions("pt_sinh_thiet_lanh")}
                  </select>
                  {(form.pt_sinh_thiet_lanh === "Có" || form.pt_sinh_thiet_lanh_ghi_chu) && (
                    <div className="conditional-box">
                      <label className="conditional-box-label">
                        Ghi chú kết quả sinh thiết lạnh đã lưu
                      </label>
                      <input disabled={readOnly || busy} aria-label="pt_sinh_thiet_lanh_ghi_chu" name="pt_sinh_thiet_lanh_ghi_chu"
                        type="text"
                        className="form-input"
                        placeholder="Nhập kết quả sinh thiết lạnh..."
                        value={form.pt_sinh_thiet_lanh_ghi_chu || ""}
                        onChange={(e) => handleChange("pt_sinh_thiet_lanh_ghi_chu", e.target.value)}
                        autoFocus
                      />
                    </div>
                  )}
                </div>

                {/* 5. Mô tả tổn thương u khi phẫu thuật */}
                <div className="form-item form-col-span-full">
                  <label className="field-label" htmlFor="entry-pt_ton_thuong">5. Mô tả tổn thương u khi phẫu thuật</label>
                  <input id="entry-pt_ton_thuong" disabled={readOnly || busy} aria-label="Mô tả tổn thương u khi phẫu thuật" name="pt_ton_thuong"
                    type="text"
                    className="form-input"
                    placeholder="Ví dụ: U buồng trứng P dạng nang đa thùy..."
                    value={form.pt_ton_thuong || ""}
                    onChange={(e) => handleChange("pt_ton_thuong", e.target.value)}
                  />
                </div>

                {hasSurgeryProtocol && <SurgicalProtocolFields values={form} disabled={readOnly || busy}
                  onChange={handleChange} choiceOptions={choiceOptions}/>}

                {/* 10. UBT xoắn */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-ubt_xoan">UBT xoắn</label>
                  <select id="entry-ubt_xoan" disabled={readOnly || busy} aria-label="UBT xoắn" name="ubt_xoan"
                    className="form-select"
                    value={form.ubt_xoan}
                    onChange={(e) => handleChange("ubt_xoan", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                </div>

                {/* 11. UBT vỡ */}
                <div className="form-item">
                  <label className="field-label" htmlFor="entry-ubt_vo">UBT vỡ</label>
                  <select id="entry-ubt_vo" disabled={readOnly || busy} aria-label="UBT vỡ" name="ubt_vo"
                    className="form-select"
                    value={form.ubt_vo}
                    onChange={(e) => handleChange("ubt_vo", e.target.value)}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                </div>

              </div>
            </div>
          )}
        </div>

        {/* ============================================================== */}
        {/* MỤC VII: PHÂN LOẠI GIẢI PHẪU BỆNH CỦA U BUỒNG TRỨNG THEO WHO */}
        {/* ============================================================== */}
        <div
          ref={sectionRefs.sec7}
          id="entry-sec7"
          className={`section-accordion ${openSections.sec7 ? "is-open" : ""}`}
        >
          <button
            type="button"
            className="section-header-btn"
            aria-expanded={openSections.sec7}
            onClick={() => toggleSection("sec7")}
          >
            <div className="section-header-left">
              <span className="section-roman-badge">VII</span>
              <div className="section-title-wrap">
                <h3>{compact ? "Giải phẫu bệnh WHO" : "Phân loại giải phẫu bệnh theo WHO"}</h3>
              </div>
            </div>
            <div className="section-header-right">
              <ChevronDown className="entry-section-chevron" size={19} aria-hidden="true"/>
              <span className={`section-count-badge ${selectedPathologyId ? "is-complete" : ""}`}>
                {`Đã chọn ${countSec7}/2`}
              </span>
            </div>
          </button>

          {openSections.sec7 && (
            <div className="section-body">
              <WhoResultsFields options={pathologyOptions} disabled={readOnly || busy}
                values={[{id:selectedPathologyId,other:pathologyOtherText},{id:secondPathologyId,other:secondPathologyOtherText}]}
                onChange={(slot,value) => { if(slot === 1){setSelectedPathologyId(value.id);setPathologyOtherText(value.other);}else{setSecondPathologyId(value.id);setSecondPathologyOtherText(value.other);} }}/>
            </div>
          )}
        </div>

        {!compact && <div className="entry-submit-bar">
          {formError && <p className="entry-submit-error" role="alert">{formError}</p>}
          <div className="entry-submit-copy"><strong>Kiểm tra thông tin trước khi gửi</strong><span><Save size={14} aria-hidden="true"/>{saveStatus || "Nội dung được tự động lưu nháp."}</span></div>
          <button type="submit" className="btn-submit" disabled={busy || readOnly}><Send size={18} aria-hidden="true"/>{busy ? "Đang gửi phiếu…" : submitLabel}</button>
        </div>}
        </fieldset>
      </form>
    </div>
  );
};
