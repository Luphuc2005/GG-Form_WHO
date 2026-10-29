import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Download,
  Check,
  Trash2,
} from "lucide-react";
import { FormSchemaDefinition } from "../types/schema";
import { fetchCurrentForm, submitSurveyAnswers } from "../api/client";

interface ComprehensiveFormPageProps {
  onSwitchToClassic?: () => void;
}

export const WHO_PATHOLOGY_OPTIONS_V2 = [
  { id: "serous_cystadenoma_8441_0", code: "8441/0", label: "U thanh dịch lành tính/Serous cystadenoma (8441/0)", classification: "benign" },
  { id: "serous_borderline_8442_1", code: "8442/1", label: "U thanh dịch giáp biên ác/Serous borderline tumour (8442/1)", classification: "borderline" },
  { id: "lgsc_8460_3", code: "8460/3", label: "Ung thư biểu mô tuyến thanh dịch độ thấp/Low-grade serous carcinoma LGSC (8460/3)", classification: "malignant" },
  { id: "hgsc_8461_3", code: "8461/3", label: "Ung thư biểu mô tuyến thanh dịch độ cao/High-grade serous carcinoma HGSC (8461/3)", classification: "malignant" },
  { id: "mucinous_cystadenoma_8470_0", code: "8470/0", label: "U dịch nhầy lành tính/Mucinous cystadenoma (8470/0)", classification: "benign" },
  { id: "mucinous_borderline_8472_1", code: "8472/1", label: "U dịch nhầy giáp biên ác/Mucinous borderline tumour (8472/1)", classification: "borderline" },
  { id: "mucinous_adenocarcinoma_8480_3", code: "8480/3", label: "Ung thư biểu mô tuyến dịch nhầy/Mucinous adenocarcinoma (8480/3)", classification: "malignant" },
  { id: "endometrioma_benign", code: "Nang lạc NMTC", label: "Nang lạc nội mạc tử cung lành", classification: "benign" },
  { id: "endometrioid_adenocarcinoma_8380_3", code: "8380/3", label: "Ung thư dạng nội mạc tử cung/Endometrioid adenocarcinoma (8380/3)", classification: "malignant" },
  { id: "seromucinous_carcinoma_8474_3", code: "8474/3", label: "Ung thư thanh dịch nhầy/Seromucinous carcinoma (8474/3)", classification: "malignant" },
  { id: "clear_cell_adenocarcinoma_8310_3", code: "8310/3", label: "Ung thư tế bào sáng/Clear cell adenocarcinoma (8310/3)", classification: "malignant" },
  { id: "brenner_tumor_9000_0", code: "9000/0", label: "U Brenner (9000/0)", classification: "benign" },
  { id: "mature_teratoma_9080_0", code: "9080/0", label: "U quái trưởng thành/Mature teratoma (9080/0)", classification: "benign" },
  { id: "immature_teratoma_9080_3", code: "9080/3", label: "U quái không trưởng thành/Immature teratoma (9080/3)", classification: "malignant" },
  { id: "dysgerminoma_9060_3", code: "9060/3", label: "U nguyên bào mầm/Dysgerminoma (9060/3)", classification: "malignant" },
  { id: "yolk_sac_tumor_9071_3", code: "9071/3", label: "U túi noãn hoàng/Yolk sac tumour (9071/3)", classification: "malignant" },
  { id: "fibroma_8810_0", code: "8810/0", label: "U sợi buồng trứng/Fibroma (8810/0)", classification: "benign" },
  { id: "cellular_fibroma_8810_1", code: "8810/1", label: "U sợi giàu tế bào/Cellular fibroma (8810/1)", classification: "borderline" },
  { id: "thecoma_8600_0", code: "8600/0", label: "U vỏ xơ buồng trứng/Thecoma (8600/0)", classification: "benign" },
  { id: "pathology_other", code: "Khác", label: "Khác:", classification: "unspecified" },
];

export const ComprehensiveFormPage: React.FC<ComprehensiveFormPageProps> = () => {
  // Schema for WHO pathology tree
  const [whoSchema, setWhoSchema] = useState<FormSchemaDefinition | null>(null);
  const [selectedPathologyId, setSelectedPathologyId] = useState<string>(() => {
    return sessionStorage.getItem("clinical_form_draft_pathology") ?? "endometrioma_benign";
  });
  const [pathologyOtherText, setPathologyOtherText] = useState<string>("");
  const [showPathologyRadioList, setShowPathologyRadioList] = useState(false);

  // References for smooth scrolling
  const sectionRefs = {
    sec1: useRef<HTMLDivElement>(null),
    sec2: useRef<HTMLDivElement>(null),
    sec3: useRef<HTMLDivElement>(null),
    sec4: useRef<HTMLDivElement>(null),
    sec5: useRef<HTMLDivElement>(null),
    sec6: useRef<HTMLDivElement>(null),
    sec7: useRef<HTMLDivElement>(null),
  };

  // Accordion open/close states (All 6 sections open by default)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    sec1: true,
    sec2: true,
    sec3: true,
    sec4: true,
    sec5: true,
    sec6: true,
    sec7: true,
  });

  const [activeTab, setActiveTab] = useState<string>("sec1");

  const toggleSection = (sec: string) => {
    setOpenSections((prev) => ({ ...prev, [sec]: !prev[sec] }));
  };



  const scrollToSection = (secKey: keyof typeof sectionRefs) => {
    setActiveTab(secKey);
    setOpenSections((prev) => ({ ...prev, [secKey]: true }));
    setTimeout(() => {
      const el = sectionRefs[secKey].current;
      if (el) {
        const topOffset = el.getBoundingClientRect().top + window.scrollY - 85;
        window.scrollTo({ top: Math.max(0, topOffset), behavior: "smooth" });
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
            { key: "sec1", el: sectionRefs.sec1.current },
            { key: "sec2", el: sectionRefs.sec2.current },
            { key: "sec3", el: sectionRefs.sec3.current },
            { key: "sec4", el: sectionRefs.sec4.current },
            { key: "sec5", el: sectionRefs.sec5.current },
            { key: "sec6", el: sectionRefs.sec6.current },
            { key: "sec7", el: sectionRefs.sec7.current },
          ];

          const threshold = 140;
          let currentSec = "sec1";

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
  }, []);

  // 52 Clinical Fields + WHO Pathology + IOTA ADNEX 6 Sub-fields
  const [form, setForm] = useState<Record<string, any>>(() => {
    const saved = sessionStorage.getItem("clinical_form_draft");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return {
      // 1-5. Hành chính
      so_hs: "",
      ho_ten: "",
      nam_sinh: "",
      nam_kham: "",
      dia_chi: "",
      nghe_nghiep: "",

      // 6-16. Tiền sử & Lâm sàng
      tuoi_phau_thuat: "",
      para: "0000",
      kinh_nguyet: "Còn hành kinh",
      thoi_diem_phat_hien: "Mới phát hiện",
      tien_can_phau_thuat_ubt: "Không",
      tien_can_phau_thuat_ubt_ghi_chu: "",
      tien_can_ung_thu_khac: "Không",
      tien_can_ung_thu_khac_ghi_chu: "",
      tien_can_lac_nmtc: "Không",
      co_thai: "Không",
      ubt_xoan: "Không",
      ubt_vo: "Không",
      ubt_nhiem_trung: "Không",

      // 17-21. Dấu ấn sinh học
      ca_125: "",
      he4: "",
      roma: "",
      afp: "",
      beta_hcg: "",

      // 22-38. Siêu âm (IOTA / O-RADS)
      sa_so_luong_u: "1 bên",
      sa_mo_buong_trung: "Còn",
      sa_phan_loai_u: "Đơn thùy",
      sa_phan_am: [] as string[],
      sa_kich_thuoc_u: "",
      sa_bo_ngoai: "Đều",
      sa_bo_trong: "Trơn láng",
      sa_so_luong_thuy: "1",
      sa_kich_thuoc_phan_dac: "",
      sa_bong_lung: "Không",
      sa_nang_trong_phan_dac: "Không",
      sa_nang_trong_phan_dac_so_luong: "",
      sa_choi: "Không",
      sa_tang_sinh_mach_mau: "Không tăng sinh",
      sa_dich_o_bung: "Không",
      sa_ton_thuong_nmtc: "Không",
      sa_ton_thuong_nmtc_ghi_chu: "",

      // 37. IOTA ADNEX (6 mục nhỏ)
      iota_benign: "",
      iota_malignant: "",
      iota_borderline: "",
      iota_stage1: "",
      iota_stage2_4: "",
      iota_metastatic: "",
      sa_iota_adnex: "",

      // 38. ORADS
      sa_orads: "",

      // 39-52. MRI
      mri_mo_buong_trung: "Còn",
      mri_so_luong_u: "1 bên",
      mri_dang_ton_thuong: "Nang đơn thùy",
      mri_kich_thuoc_u: "",
      mri_dich_nang_t1w: "thấp",
      mri_dich_nang_t2w: "cao",
      mri_dich_nang: "T1w: thấp, T2w: cao",
      mri_thanh_phan_mo: "Không",
      mri_phan_dac: "Không",
      mri_kich_thuoc_phan_dac: "",
      mri_khuech_tan: "Không giới hạn",
      mri_ngam_thuoc: "type 1",
      mri_hach: "Không",
      mri_dich_o_bung: "Không",
      mri_ton_thuong_co_quan_khac: "",
      mri_ket_luan: "",

      // VI. Protocol phẫu thuật
      pt_chan_doan_truoc: "u buồng trứng",
      pt_chan_doan_sau: "u buồng trứng",
      pt_phuong_phap: ["cắt u"] as string[],
      pt_sinh_thiet_lanh: "Không",
      pt_sinh_thiet_lanh_ghi_chu: "",
      pt_ton_thuong: "",
      pt_dich_o_bung: "Không có",
    };
  });

  const handleClearAll = () => {
    const emptyForm = Object.fromEntries(
      Object.entries(form).map(([key, value]) => [key, Array.isArray(value) ? [] : ""])
    );
    setForm(emptyForm);
    setSelectedPathologyId("");
    setPathologyOtherText("");
    setShowPathologyRadioList(false);
    sessionStorage.setItem("clinical_form_draft", JSON.stringify(emptyForm));
    sessionStorage.setItem("clinical_form_draft_pathology", "");
    sessionStorage.removeItem("clinical_form_draft_pathology_other");
  };

  // Real-time persistence to draft
  useEffect(() => {
    sessionStorage.setItem("clinical_form_draft", JSON.stringify(form));
  }, [form]);

  // Load WHO schema from server
  useEffect(() => {
    fetchCurrentForm()
      .then((res) => setWhoSchema(res.schema_json))
      .catch((err) => console.error("Lỗi tải WHO schema:", err));
  }, []);


  // Field change handler
  const handleChange = (field: string, value: any) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };

      if (field === "nam_sinh" || field === "nam_kham") {
        const birthYear = parseInt(field === "nam_sinh" ? value : prev.nam_sinh, 10);
        const examYear = parseInt(field === "nam_kham" ? value : prev.nam_kham, 10);

        if (!isNaN(birthYear) && birthYear > 1900 && birthYear < 2030) {
          if (!isNaN(examYear) && examYear >= birthYear) {
            next.tuoi_phau_thuat = String(examYear - birthYear);
          } else if (!prev.tuoi_phau_thuat || prev.tuoi_phau_thuat === "") {
            const currentYear = new Date().getFullYear();
            next.tuoi_phau_thuat = String(currentYear - birthYear);
          }
        }
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


  // Export to CSV with exact header names
  const exportToCSV = () => {
    const headers = [
      "Số HS",
      "Họ Tên",
      "Năm Sinh",
      "Năm Khám",
      "Địa chỉ",
      "Nghề nghiệp",
      "Tuổi BN khi phẫu thuật",
      "PARA",
      "Kinh nguyệt",
      "Thời điểm phát hiện UBT",
      "Tiền căn phẫu thuật UBT",
      "Ghi chú GPB nếu có",
      "Tiền căn ung thư khác",
      "Ghi chú loại ung thư nếu có",
      "Tiền căn lạc nội mạc tử cung",
      "Có thai",
      "UBT xoắn",
      "UBT vỡ",
      "UBT nhiễm trùng",
      "CA 125",
      "HE4",
      "ROMA",
      "AFP",
      "beta hCG",
      "Số lượng u",
      "Mô buồng trứng",
      "Phân loại u",
      "Phản âm (chọn nhiều lựa chọn)",
      "Kích thước u",
      "Bờ ngoài",
      "Bờ trong",
      "Số lượng thùy",
      "Kích thước phần đặc",
      "Bóng lưng",
      "Nang trong phần đặc",
      "Chồi",
      "Tăng sinh mạch máu",
      "Dịch ổ bụng",
      "Tổn thương NMTC",
      "IOTA ADNEX",
      "IOTA ADNEX - Benign (%)",
      "IOTA ADNEX - Malignant (%)",
      "IOTA ADNEX - Borderline (%)",
      "IOTA ADNEX - Stage I (%)",
      "IOTA ADNEX - Stage II-IV (%)",
      "IOTA ADNEX - Metastatic (%)",
      "ORADS",
      "Mô buồng trứng",
      "Số lượng u",
      "Dạng tổn thương",
      "Kích thước u",
      "Dịch nang",
      "Thành phần mỡ",
      "Phần đặc",
      "Kích thước phần đặc",
      "Khuếch tán",
      "Đặc điểm ngấm thuốc tương phản từ",
      "Hạch",
      "Dịch ổ bụng",
      "Tổn thương cơ quan khác",
      "Kết luận MRI",
      "Chẩn đoán trước phẫu thuật",
      "Chẩn đoán sau phẫu thuật",
      "Phương pháp phẫu thuật",
      "Sinh thiết lạnh",
      "Dịch ổ bụng khi phẫu thuật",
      "Mô tả tổn thương u khi phẫu thuật",
      "Phân loại Giải phẫu bệnh theo WHO",
    ];

    const iotaSummary = [
      form.iota_benign ? `Benign: ${form.iota_benign}%` : "",
      form.iota_malignant ? `Malignant: ${form.iota_malignant}%` : "",
      form.iota_borderline ? `Borderline: ${form.iota_borderline}%` : "",
      form.iota_stage1 ? `Stage I: ${form.iota_stage1}%` : "",
      form.iota_stage2_4 ? `Stage II-IV: ${form.iota_stage2_4}%` : "",
      form.iota_metastatic ? `Metastatic: ${form.iota_metastatic}%` : "",
    ].filter(Boolean).join(" | ") || form.sa_iota_adnex;

    const values = [
      form.so_hs,
      form.ho_ten,
      form.nam_sinh,
      form.nam_kham,
      form.dia_chi,
      form.nghe_nghiep,
      form.tuoi_phau_thuat,
      form.para,
      form.kinh_nguyet,
      form.thoi_diem_phat_hien,
      form.tien_can_phau_thuat_ubt,
      form.tien_can_phau_thuat_ubt_ghi_chu,
      form.tien_can_ung_thu_khac,
      form.tien_can_ung_thu_khac_ghi_chu,
      form.tien_can_lac_nmtc,
      form.co_thai,
      form.ubt_xoan,
      form.ubt_vo,
      form.ubt_nhiem_trung,
      form.ca_125,
      form.he4,
      form.roma,
      form.afp,
      form.beta_hcg,
      form.sa_so_luong_u,
      form.sa_mo_buong_trung,
      form.sa_phan_loai_u,
      Array.isArray(form.sa_phan_am) ? form.sa_phan_am.join(", ") : form.sa_phan_am,
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
      iotaSummary,
      form.iota_benign,
      form.iota_malignant,
      form.iota_borderline,
      form.iota_stage1,
      form.iota_stage2_4,
      form.iota_metastatic,
      form.sa_orads,
      form.mri_mo_buong_trung,
      form.mri_so_luong_u,
      form.mri_dang_ton_thuong,
      form.mri_kich_thuoc_u,
      form.mri_dich_nang,
      form.mri_thanh_phan_mo,
      form.mri_phan_dac,
      form.mri_kich_thuoc_phan_dac,
      form.mri_khuech_tan,
      form.mri_ngam_thuoc,
      form.mri_hach,
      form.mri_dich_o_bung,
      form.mri_ton_thuong_co_quan_khac,
      form.mri_ket_luan,
      form.pt_chan_doan_truoc || "",
      form.pt_chan_doan_sau || "",
      Array.isArray(form.pt_phuong_phap) ? form.pt_phuong_phap.join(", ") : (form.pt_phuong_phap || ""),
      form.pt_sinh_thiet_lanh === "Có" && form.pt_sinh_thiet_lanh_ghi_chu
        ? `Có (${form.pt_sinh_thiet_lanh_ghi_chu})`
        : (form.pt_sinh_thiet_lanh || ""),
      form.pt_dich_o_bung || "",
      form.pt_ton_thuong || "",
      selectedPathologyId === "pathology_other"
        ? `Khác (${pathologyOtherText || "chưa ghi"})`
        : (WHO_PATHOLOGY_OPTIONS_V2.find((o) => o.id === selectedPathologyId)?.label || ""),
    ];

    const csvContent =
      "\ufeff" +
      headers.map((h) => `"${h}"`).join(",") +
      "\n" +
      values.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",") +
      "\n";

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `benh_an_ubt_${form.so_hs || "chua_co_so"}_${Date.now()}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isIotaSumInvalid) {
      alert(`Cảnh báo: Tổng 6 mục IOTA ADNEX hiện là ${currentIotaSum}%. Yêu cầu tổng các mục phải bằng đúng 100%! Vui lòng kiểm tra lại trước khi gửi phiếu.`);
      scrollToSection("sec4");
      return;
    }
    setIsSubmitting(true);
    setSubmitSuccess(null);

    try {
      if (!selectedPathologyId) {
        alert("Vui lòng chọn 1 kết quả Giải phẫu bệnh theo WHO!");
        scrollToSection("sec7");
        return;
      }
      if (selectedPathologyId === "pathology_other" && !pathologyOtherText.trim()) {
        alert("Vui lòng nhập tên Giải phẫu bệnh khác!");
        scrollToSection("sec7");
        return;
      }

      const matchedOpt = WHO_PATHOLOGY_OPTIONS_V2.find((o) => o.id === selectedPathologyId);
      const uuid = crypto.randomUUID();
      const payloadAnswers: any = {
        pathology: {
          selected: selectedPathologyId ? [{
            id: selectedPathologyId,
            children: [],
            other_text: selectedPathologyId === "pathology_other" ? pathologyOtherText.trim() : null,
          }] : [],
          other_text: selectedPathologyId === "pathology_other" ? pathologyOtherText.trim() : null,
        },
        classification: matchedOpt?.classification || "unspecified",
        clinical_data: {
          ...form,
          pt_phuong_phap: Array.isArray(form.pt_phuong_phap) ? form.pt_phuong_phap.join(", ") : form.pt_phuong_phap,
        },
      };

      const res = await submitSurveyAnswers({
        submission_uuid: uuid,
        form_version: whoSchema?.version || 1,
        answers: payloadAnswers,
      });

      setSubmitSuccess(res.reference_code || res.submission_uuid);
      sessionStorage.removeItem("clinical_form_draft");
    } catch (err: any) {
      alert("Lỗi khi gửi phiếu: " + (err.message || "Không thể kết nối đến máy chủ"));
    } finally {
      setIsSubmitting(false);
    }
  };


  // =========================================================================
  // IOTA ADNEX: Tính tổng 6 mục (Miễn sao tổng bằng đúng 100%)
  // =========================================================================
  const iotaB = parseFloat(form.iota_benign) || 0;
  const iotaM = parseFloat(form.iota_malignant) || 0;
  const iotaBor = parseFloat(form.iota_borderline) || 0;
  const iotaS1 = parseFloat(form.iota_stage1) || 0;
  const iotaS24 = parseFloat(form.iota_stage2_4) || 0;
  const iotaMet = parseFloat(form.iota_metastatic) || 0;

  const filledIotaCount = [
    form.iota_benign,
    form.iota_malignant,
    form.iota_borderline,
    form.iota_stage1,
    form.iota_stage2_4,
    form.iota_metastatic,
  ].filter((v) => v !== "" && !isNaN(parseFloat(v))).length;

  const hasAnyIota = filledIotaCount > 0;

  // Tổng trực tiếp cả 6 ô
  const iotaTotalSum = parseFloat((iotaB + iotaM + iotaBor + iotaS1 + iotaS24 + iotaMet).toFixed(1));

  // Kiểm tra trường hợp chuẩn IOTA ADNEX (Lành + Ác = 100%, và 4 thể con = Ác)
  const hasSubIota = [form.iota_borderline, form.iota_stage1, form.iota_stage2_4, form.iota_metastatic].some(
    (v) => v !== "" && !isNaN(parseFloat(v))
  );
  const subIotaSum = parseFloat((iotaBor + iotaS1 + iotaS24 + iotaMet).toFixed(1));
  const isClinicalIota100 =
    form.iota_benign !== "" &&
    form.iota_malignant !== "" &&
    Math.abs(iotaB + iotaM - 100) < 0.1 &&
    (!hasSubIota || Math.abs(subIotaSum - iotaM) < 0.1);

  // Miễn điền sao cho tổng bằng đúng 100% (hoặc tổng 6 ô = 100%, hoặc chuẩn IOTA = 100%)
  const isIotaSumValid = hasAnyIota && (Math.abs(iotaTotalSum - 100) < 0.1 || isClinicalIota100);
  const isIotaSumInvalid = hasAnyIota && !isIotaSumValid;
  const currentIotaSum = isClinicalIota100 && Math.abs(iotaTotalSum - 100) >= 0.1 ? 100 : iotaTotalSum;

  const handleAutoBalanceIota = () => {
    const diff = parseFloat((100 - iotaTotalSum).toFixed(1));
    if (diff === 0) return;

    if (form.iota_benign !== "") {
      const newB = Math.max(0, parseFloat((iotaB + diff).toFixed(1)));
      setForm((prev) => ({ ...prev, iota_benign: String(newB) }));
    } else if (form.iota_malignant !== "") {
      const newM = Math.max(0, parseFloat((iotaM + diff).toFixed(1)));
      setForm((prev) => ({ ...prev, iota_malignant: String(newM), sa_iota_adnex: String(newM) }));
    } else {
      const others = iotaTotalSum - iotaB;
      const newB = Math.max(0, parseFloat((100 - others).toFixed(1)));
      setForm((prev) => ({ ...prev, iota_benign: String(newB) }));
    }
  };

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

  // Field counts
  const countSec1 = [form.so_hs, form.ho_ten, form.nam_sinh, form.dia_chi, form.nghe_nghiep].filter(Boolean).length;
  const countSec2 = [
    form.tuoi_phau_thuat,
    form.para,
    form.kinh_nguyet,
    form.thoi_diem_phat_hien,
    form.tien_can_phau_thuat_ubt,
    form.tien_can_ung_thu_khac,
    form.tien_can_lac_nmtc,
    form.co_thai,
    form.ubt_xoan,
    form.ubt_vo,
    form.ubt_nhiem_trung,
  ].filter(Boolean).length;
  const countSec3 = [form.ca_125, form.he4, form.roma, form.afp, form.beta_hcg].filter(Boolean).length;
  const isIotaFilled = Boolean(
    form.sa_iota_adnex ||
    form.iota_benign ||
    form.iota_malignant ||
    (form.iota_borderline && form.iota_stage1)
  );
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
    isIotaFilled,
  ].filter(Boolean).length;
  const countSec5 = [
    form.mri_mo_buong_trung,
    form.mri_so_luong_u,
    form.mri_dang_ton_thuong,
    form.mri_kich_thuoc_u,
    form.mri_dich_nang,
    form.mri_thanh_phan_mo,
    form.mri_phan_dac,
    form.mri_kich_thuoc_phan_dac,
    form.mri_khuech_tan,
    form.mri_ngam_thuoc,
    form.mri_hach,
    form.mri_dich_o_bung,
    form.mri_ton_thuong_co_quan_khac,
    form.sa_orads,
    form.mri_ket_luan,
  ].filter(Boolean).length;
  const countSec6 = [
    form.pt_chan_doan_truoc,
    form.pt_chan_doan_sau,
    (Array.isArray(form.pt_phuong_phap) ? form.pt_phuong_phap.length > 0 : Boolean(form.pt_phuong_phap)),
    form.pt_sinh_thiet_lanh,
    form.pt_dich_o_bung,
    form.pt_ton_thuong,
  ].filter(Boolean).length;
  const countSec7 = selectedPathologyId ? 1 : 0;

  const totalFilled = Math.min(53, countSec1 + countSec2 + countSec3 + countSec4 + countSec5 + countSec7);
  const progressPercent = Math.min(100, Math.round((totalFilled / 53) * 100));

  // Success view
  if (submitSuccess) {
    return (
      <div className="form-container" style={{ textAlign: "center", paddingTop: "40px" }}>
        <div className="form-card" style={{ padding: "48px 24px", maxWidth: "600px", margin: "0 auto" }}>
          <div
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "50%",
              background: "#dcfce7",
              color: "#16a34a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <Check size={36} strokeWidth={3} />
          </div>
          <h2 style={{ fontSize: "24px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px" }}>
            Đã Lưu Bệnh Án Nghiên Cứu Thành Công!
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "15.5px", marginBottom: "24px" }}>
            Dữ liệu bệnh nhân và kết quả phân loại giải phẫu bệnh theo WHO đã được ghi nhận vào hệ thống.
          </p>

          <div
            style={{
              background: "#f8fafc",
              border: "1.5px dashed #cbd5e1",
              borderRadius: "10px",
              padding: "18px",
              marginBottom: "24px",
            }}
          >
            <div style={{ fontSize: "13px", textTransform: "uppercase", letterSpacing: "1px", color: "#64748b", fontWeight: 600 }}>
              Mã Phiếu Nghiên Cứu
            </div>
            <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--primary)", marginTop: "4px" }}>
              {submitSuccess}
            </div>
          </div>

          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn-submit"
              onClick={() => {
                setSubmitSuccess(null);
                setForm((prev) => ({ ...prev, so_hs: "", ho_ten: "" }));
              }}
            >
              + Nhập bệnh nhân mới
            </button>
            <button
              type="button"
              className="btn-secondary btn-excel"
              onClick={exportToCSV}
            >
              <Download size={17} /> Tải CSV
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="form-container">
      {/* 1. Header Card (Sạch sẽ, không huy hiệu màu mè, không nút thử nghiệm trên tiêu đề) */}
      <div className="form-card header-card" style={{ marginBottom: "18px" }}>
        <div className="form-header-actions">
          <button type="button" className="clear-form-button" onClick={handleClearAll} disabled={isSubmitting}>
            <Trash2 size={16} aria-hidden="true" />
            Xóa tất cả thông tin
          </button>
        </div>
        <h1 className="form-title">
          PHIẾU THU THẬP BỆNH ÁN & GIẢI PHẪU BỆNH U BUỒNG TRỨNG
        </h1>
        <p className="form-subtitle" style={{ marginBottom: "14px" }}>
          Biểu mẫu khảo sát và nghiên cứu chuyên môn tích hợp dữ liệu Hành chính, Lâm sàng, Dấu ấn sinh học, Siêu âm (IOTA/O-RADS), Cộng hưởng từ (MRI) và Phân loại Giải phẫu bệnh theo WHO.
        </p>

        {/* Global Progress Bar */}
        <div style={{ background: "#ffffff", padding: "14px 18px", borderRadius: "10px", border: "1.5px solid #e2e8f0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "15px", marginBottom: "8px" }}>
            <span style={{ fontWeight: 600, color: "#334155" }}>Tiến độ điền biểu mẫu:</span>
            <span style={{ fontWeight: 700, color: "var(--primary)", fontSize: "16px" }}>
              {totalFilled}/53 trường ({progressPercent}%)
            </span>
          </div>
          <div style={{ width: "100%", height: "9px", background: "#f1f5f9", borderRadius: "5px", overflow: "hidden" }}>
            <div
              style={{
                width: `${progressPercent}%`,
                height: "100%",
                background: "linear-gradient(90deg, #5c35b5 0%, #7c3aed 100%)",
                borderRadius: "5px",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      </div>

      {/* 2. Sticky Quick Navigation Bar */}
      <div className="sticky-nav-wrapper">
        <div className="sticky-nav-list">
          <button
            type="button"
            className={`nav-pill-btn ${activeTab === "sec1" ? "active" : ""}`}
            onClick={() => scrollToSection("sec1")}
          >
            I. Hành chính
          </button>
          <button
            type="button"
            className={`nav-pill-btn ${activeTab === "sec2" ? "active" : ""}`}
            onClick={() => scrollToSection("sec2")}
          >
            II. Lâm sàng
          </button>
          <button
            type="button"
            className={`nav-pill-btn ${activeTab === "sec3" ? "active" : ""}`}
            onClick={() => scrollToSection("sec3")}
          >
            III. Markers
          </button>
          <button
            type="button"
            className={`nav-pill-btn ${activeTab === "sec4" ? "active" : ""}`}
            onClick={() => scrollToSection("sec4")}
          >
            IV. Siêu âm
          </button>
          <button
            type="button"
            className={`nav-pill-btn ${activeTab === "sec5" ? "active" : ""}`}
            onClick={() => scrollToSection("sec5")}
          >
            V. MRI
          </button>
          <button
            type="button"
            className={`nav-pill-btn ${activeTab === "sec6" ? "active" : ""}`}
            onClick={() => scrollToSection("sec6")}
          >
            VI. Phẫu thuật
          </button>
          <button
            type="button"
            className={`nav-pill-btn ${activeTab === "sec7" ? "active" : ""}`}
            onClick={() => scrollToSection("sec7")}
            style={{ fontWeight: 600 }}
          >
            VII. GPB WHO
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {/* ============================================================== */}
        {/* MỤC I: THÔNG TIN HÀNH CHÍNH & BỆNH NHÂN */}
        {/* ============================================================== */}
        <div
          ref={sectionRefs.sec1}
          className={`section-accordion ${openSections.sec1 ? "is-open" : ""}`}
        >
          <button
            type="button"
            className="section-header-btn"
            onClick={() => toggleSection("sec1")}
          >
            <div className="section-header-left">
              <span className="section-roman-badge">I</span>
              <div className="section-title-wrap">
                <h3>THÔNG TIN HÀNH CHÍNH & BỆNH NHÂN</h3>
              </div>
            </div>
            <div className="section-header-right">
              <span className={`section-count-badge ${countSec1 === 5 ? "is-complete" : ""}`}>
                {countSec1}/5 câu
              </span>
            </div>
          </button>

          {openSections.sec1 && (
            <div className="section-body">
              <div className="form-grid-3">
                {/* 1. Số HS */}
                <div className="form-item">
                  <label className="field-label">Số HS</label>
                  <input
                    type="text"
                    className="form-input"
                    value={form.so_hs}
                    onChange={(e) => handleChange("so_hs", e.target.value)}
                  />
                </div>

                {/* 2. Họ Tên */}
                <div className="form-item">
                  <label className="field-label">Họ Tên</label>
                  <input
                    type="text"
                    className="form-input"
                    value={form.ho_ten}
                    onChange={(e) => handleChange("ho_ten", e.target.value.toUpperCase())}
                  />
                </div>

                {/* 3. Năm Sinh */}
                <div className="form-item">
                  <label className="field-label">Năm Sinh</label>
                  <input
                    type="number"
                    className="form-input"
                    value={form.nam_sinh}
                    onChange={(e) => handleChange("nam_sinh", e.target.value)}
                  />
                </div>

                {/* Năm Khám */}
                <div className="form-item">
                  <label className="field-label">Năm Khám</label>
                  <input
                    type="number"
                    className="form-input"
                    value={form.nam_kham}
                    onChange={(e) => handleChange("nam_kham", e.target.value)}
                  />
                </div>

                {/* 4. Địa chỉ */}
                <div className="form-item">
                  <label className="field-label">Địa chỉ</label>
                  <input
                    type="text"
                    className="form-input"
                    value={form.dia_chi}
                    onChange={(e) => handleChange("dia_chi", e.target.value)}
                  />
                </div>

                {/* 5. Nghề nghiệp */}
                <div className="form-item">
                  <label className="field-label">Nghề nghiệp</label>
                  <input
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
          className={`section-accordion ${openSections.sec2 ? "is-open" : ""}`}
        >
          <button
            type="button"
            className="section-header-btn"
            onClick={() => toggleSection("sec2")}
          >
            <div className="section-header-left">
              <span className="section-roman-badge">II</span>
              <div className="section-title-wrap">
                <h3>TIỀN SỬ & LÂM SÀNG</h3>
              </div>
            </div>
            <div className="section-header-right">
              <span className={`section-count-badge ${countSec2 === 11 ? "is-complete" : ""}`}>
                {countSec2}/11 câu
              </span>
            </div>
          </button>

          {openSections.sec2 && (
            <div className="section-body">
              <div className="form-grid-3">
                {/* 6. Tuổi BN khi phẫu thuật */}
                <div className="form-item">
                  <label className="field-label">Tuổi BN khi phẫu thuật</label>
                  <input
                    type="number"
                    className="form-input"
                    value={form.tuoi_phau_thuat}
                    onChange={(e) => handleChange("tuoi_phau_thuat", e.target.value)}
                  />
                </div>

                {/* 7. PARA */}
                <div className="form-item">
                  <label className="field-label">
                    <span>PARA</span>
                    <span className="field-hint">(Ví dụ: 0000, 2002)</span>
                  </label>
                  <input
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
                </div>

                {/* 8. Kinh nguyệt */}
                <div className="form-item">
                  <label className="field-label">Kinh nguyệt</label>
                  <select
                    className="form-select"
                    value={form.kinh_nguyet}
                    onChange={(e) => handleChange("kinh_nguyet", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Còn hành kinh">Còn hành kinh</option>
                    <option value="Đã mãn kinh">Đã mãn kinh</option>
                  </select>
                </div>

                {/* 9. Thời điểm phát hiện UBT */}
                <div className="form-item form-col-span-full">
                  <label className="field-label">Thời điểm phát hiện UBT</label>
                  <select
                    className="form-select"
                    value={form.thoi_diem_phat_hien}
                    onChange={(e) => handleChange("thoi_diem_phat_hien", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
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
                  <label className="field-label">Tiền căn phẫu thuật UBT</label>
                  <select
                    className="form-select"
                    value={form.tien_can_phau_thuat_ubt}
                    onChange={(e) => handleChange("tien_can_phau_thuat_ubt", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                    <option value="Ghi chú GPB nếu có">Ghi chú GPB nếu có</option>
                  </select>
                  {(form.tien_can_phau_thuat_ubt === "Có" || form.tien_can_phau_thuat_ubt === "Ghi chú GPB nếu có") && (
                    <div className="conditional-box">
                      <label style={{ fontSize: "14px", color: "#334155", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                        Ghi chú GPB nếu có
                      </label>
                      <input
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
                  <label className="field-label">Tiền căn ung thư khác</label>
                  <select
                    className="form-select"
                    value={form.tien_can_ung_thu_khac}
                    onChange={(e) => handleChange("tien_can_ung_thu_khac", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                    <option value="Ghi chú loại ung thư nếu có">Ghi chú loại ung thư nếu có</option>
                  </select>
                  {(form.tien_can_ung_thu_khac === "Có" || form.tien_can_ung_thu_khac === "Ghi chú loại ung thư nếu có") && (
                    <div className="conditional-box">
                      <label style={{ fontSize: "14px", color: "#334155", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                        Ghi chú loại ung thư nếu có
                      </label>
                      <input
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
                  <label className="field-label">Tiền căn lạc nội mạc tử cung</label>
                  <select
                    className="form-select"
                    value={form.tien_can_lac_nmtc}
                    onChange={(e) => handleChange("tien_can_lac_nmtc", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                </div>

                {/* 13. Có thai */}
                <div className="form-item">
                  <label className="field-label">Có thai</label>
                  <select
                    className="form-select"
                    value={form.co_thai}
                    onChange={(e) => handleChange("co_thai", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                </div>

                {/* 14. UBT xoắn */}
                <div className="form-item">
                  <label className="field-label">UBT xoắn</label>
                  <select
                    className="form-select"
                    value={form.ubt_xoan}
                    onChange={(e) => handleChange("ubt_xoan", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                </div>

                {/* 15. UBT vỡ */}
                <div className="form-item">
                  <label className="field-label">UBT vỡ</label>
                  <select
                    className="form-select"
                    value={form.ubt_vo}
                    onChange={(e) => handleChange("ubt_vo", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                </div>

                {/* 16. UBT nhiễm trùng */}
                <div className="form-item">
                  <label className="field-label">UBT nhiễm trùng</label>
                  <select
                    className="form-select"
                    value={form.ubt_nhiem_trung}
                    onChange={(e) => handleChange("ubt_nhiem_trung", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
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
          className={`section-accordion ${openSections.sec3 ? "is-open" : ""}`}
        >
          <button
            type="button"
            className="section-header-btn"
            onClick={() => toggleSection("sec3")}
          >
            <div className="section-header-left">
              <span className="section-roman-badge">III</span>
              <div className="section-title-wrap">
                <h3>DẤU ẤN SINH HỌC</h3>
              </div>
            </div>
            <div className="section-header-right">
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
                  <label className="field-label">CA 125</label>
                  <input
                    type="number"
                    step="any"
                    className="form-input"
                    value={form.ca_125}
                    onChange={(e) => handleChange("ca_125", e.target.value)}
                  />
                </div>

                {/* 18. HE4 */}
                <div className="form-item">
                  <label className="field-label">HE4</label>
                  <input
                    type="number"
                    step="any"
                    className="form-input"
                    value={form.he4}
                    onChange={(e) => handleChange("he4", e.target.value)}
                  />
                </div>

                {/* 19. ROMA */}
                <div className="form-item">
                  <label className="field-label">ROMA</label>
                  <input
                    type="number"
                    step="any"
                    className="form-input"
                    value={form.roma}
                    onChange={(e) => handleChange("roma", e.target.value)}
                  />
                </div>

                {/* 20. AFP */}
                <div className="form-item">
                  <label className="field-label">AFP</label>
                  <input
                    type="number"
                    step="any"
                    className="form-input"
                    value={form.afp}
                    onChange={(e) => handleChange("afp", e.target.value)}
                  />
                </div>

                {/* 21. beta hCG */}
                <div className="form-item">
                  <label className="field-label">beta hCG</label>
                  <input
                    type="number"
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
          className={`section-accordion ${openSections.sec4 ? "is-open" : ""}`}
        >
          <button
            type="button"
            className="section-header-btn"
            onClick={() => toggleSection("sec4")}
          >
            <div className="section-header-left">
              <span className="section-roman-badge">IV</span>
              <div className="section-title-wrap">
                <h3>ĐẶC ĐIỂM SIÊU ÂM</h3>
              </div>
            </div>
            <div className="section-header-right">
              <span className={`section-count-badge ${countSec4 === 16 ? "is-complete" : ""}`}>
                {countSec4}/16 câu
              </span>
            </div>
          </button>

          {openSections.sec4 && (
            <div className="section-body">
              <div className="form-grid-2">
                {/* 22. Số lượng u */}
                <div className="form-item">
                  <label className="field-label">Số lượng u</label>
                  <select
                    className="form-select"
                    value={form.sa_so_luong_u}
                    onChange={(e) => handleChange("sa_so_luong_u", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="1 bên">1 bên</option>
                    <option value="2 bên">2 bên</option>
                  </select>
                </div>

                {/* 23. Mô buồng trứng */}
                <div className="form-item">
                  <label className="field-label">Mô buồng trứng</label>
                  <select
                    className="form-select"
                    value={form.sa_mo_buong_trung}
                    onChange={(e) => handleChange("sa_mo_buong_trung", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Còn">Còn</option>
                    <option value="Không quan sát thấy">Không quan sát thấy</option>
                    <option value="Không đánh giá">Không đánh giá</option>
                  </select>
                </div>

                {/* 24. Phân loại u */}
                <div className="form-item">
                  <label className="field-label">Phân loại u</label>
                  <select
                    className="form-select"
                    value={form.sa_phan_loai_u}
                    onChange={(e) => handleChange("sa_phan_loai_u", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
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
                          className={`toggle-chip ${isChecked ? "active" : ""}`}
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
                  <label className="field-label">Kích thước u</label>
                  <input
                    type="number"
                    className="form-input"
                    value={form.sa_kich_thuoc_u}
                    onChange={(e) => handleChange("sa_kich_thuoc_u", e.target.value)}
                  />
                </div>

                {/* 27. Bờ ngoài */}
                <div className="form-item">
                  <label className="field-label">Bờ ngoài</label>
                  <select
                    className="form-select"
                    value={form.sa_bo_ngoai}
                    onChange={(e) => handleChange("sa_bo_ngoai", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không đều">Không đều</option>
                    <option value="Đều">Đều</option>
                    <option value="Không đánh giá">Không đánh giá</option>
                  </select>
                </div>

                {/* 28. Bờ trong */}
                <div className="form-item">
                  <label className="field-label">Bờ trong</label>
                  <select
                    className="form-select"
                    value={form.sa_bo_trong}
                    onChange={(e) => handleChange("sa_bo_trong", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không trơn láng">Không trơn láng</option>
                    <option value="Trơn láng">Trơn láng</option>
                    <option value="Không đánh giá">Không đánh giá</option>
                  </select>
                </div>

                {/* 29. Số lượng thùy */}
                <div className="form-item">
                  <label className="field-label">Số lượng thùy</label>
                  <select
                    className="form-select"
                    value={form.sa_so_luong_thuy}
                    onChange={(e) => handleChange("sa_so_luong_thuy", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="0">0 (u đặc / không thùy)</option>
                    <option value="1">1</option>
                    <option value="2-10">2-10</option>
                    <option value=">10">&gt; 10</option>
                  </select>
                </div>

                {/* 30. Kích thước phần đặc */}
                <div className="form-item">
                  <label className="field-label">Kích thước phần đặc</label>
                  <input
                    type="number"
                    className="form-input"
                    value={form.sa_kich_thuoc_phan_dac}
                    onChange={(e) => handleChange("sa_kich_thuoc_phan_dac", e.target.value)}
                  />
                </div>

                {/* 31. Bóng lưng */}
                <div className="form-item">
                  <label className="field-label">Bóng lưng</label>
                  <select
                    className="form-select"
                    value={form.sa_bong_lung}
                    onChange={(e) => handleChange("sa_bong_lung", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                </div>

                {/* 32. Nang trong phần đặc */}
                <div className="form-item">
                  <label className="field-label">Nang trong phần đặc</label>
                  <select
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
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                  {form.sa_nang_trong_phan_dac === "Có" && (
                    <div className="conditional-box">
                      <label style={{ fontSize: "14px", color: "#334155", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                        Có bao nhiêu nang trong phần đặc?
                      </label>
                      <input
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
                  <label className="field-label">Chồi</label>
                  <select
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
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                  {form.sa_choi !== "Không" && Boolean(form.sa_choi) && (
                    <div className="conditional-box">
                      <label style={{ fontSize: "14px", color: "#334155", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                        Có bao nhiêu chồi?
                      </label>
                      <select
                        className="form-select"
                        value={["1", "2", "3", ">3"].includes(form.sa_choi) ? form.sa_choi : "1"}
                        onChange={(e) => handleChange("sa_choi", e.target.value)}
                      >
                        <option value="" disabled>-- Chọn --</option>
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
                  <label className="field-label">Tăng sinh mạch máu</label>
                  <select
                    className="form-select"
                    value={form.sa_tang_sinh_mach_mau}
                    onChange={(e) => handleChange("sa_tang_sinh_mach_mau", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
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
                  <label className="field-label">Dịch ổ bụng</label>
                  <select
                    className="form-select"
                    value={form.sa_dich_o_bung}
                    onChange={(e) => handleChange("sa_dich_o_bung", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Cùng đồ">Cùng đồ</option>
                    <option value="2 hố chậu">2 hố chậu</option>
                    <option value="khoảng gan thận">khoảng gan thận</option>
                    <option value="Dịch màng phổi">Dịch màng phổi</option>
                  </select>
                </div>

                {/* 36. Tổn thương NMTC */}
                <div className="form-item">
                  <label className="field-label">Tổn thương NMTC</label>
                  <select
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
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                  {form.sa_ton_thuong_nmtc === "Có" && (
                    <div className="conditional-box">
                      <label style={{ fontSize: "14px", color: "#334155", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                        Ghi chú tổn thương tử cung
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Nhập ghi chú tổn thương tử cung..."
                        value={form.sa_ton_thuong_nmtc_ghi_chu || ""}
                        onChange={(e) => handleChange("sa_ton_thuong_nmtc_ghi_chu", e.target.value)}
                      />
                    </div>
                  )}
                </div>

                {/* 37. IOTA ADNEX (Miễn tổng 6 mục đủ 100% là hợp lệ) */}
                <div className="form-item form-col-span-full">
                  <div
                    style={{
                      background: "#f8fafc",
                      border: "1.5px solid #cbd5e1",
                      borderRadius: "12px",
                      padding: "20px 22px",
                      marginTop: "6px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                      <div>
                        <label className="field-label" style={{ fontSize: "16.5px", color: "var(--primary)", margin: 0 }}>
                          IOTA ADNEX
                        </label>
                        <div style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>
                          (Miễn điền sao cho tổng các mục bằng đúng 100%)
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {isIotaSumInvalid ? (
                          <span
                            style={{
                              fontSize: "13.5px",
                              fontWeight: 600,
                              color: "#b91c1c",
                              background: "#fee2e2",
                              border: "1px solid #f87171",
                              padding: "4px 12px",
                              borderRadius: "12px",
                            }}
                          >
                            ⚠️ Tổng: {currentIotaSum}% ({currentIotaSum > 100 ? "Thừa" : "Thiếu"} {Math.abs(parseFloat((100 - currentIotaSum).toFixed(1)))}%)
                          </span>
                        ) : isIotaSumValid ? (
                          <span
                            style={{
                              fontSize: "13.5px",
                              fontWeight: 600,
                              color: "#15803d",
                              background: "#dcfce7",
                              border: "1px solid #86efac",
                              padding: "4px 12px",
                              borderRadius: "12px",
                            }}
                          >
                            Tổng 6 mục: 100% (Hợp lệ)
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: "13.5px",
                              fontWeight: 500,
                              color: "#64748b",
                              background: "#f1f5f9",
                              padding: "4px 12px",
                              borderRadius: "12px",
                            }}
                          >
                            Yêu cầu Tổng 6 mục = 100%
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="form-grid-3">
                      {/* Benign tumor */}
                      <div className="form-item">
                        <label className="field-label" style={{ fontSize: "14.5px" }}>Benign tumor (%)</label>
                        <input
                          type="number"
                          step="0.1"
                          className="form-input"
                          style={
                            isIotaSumInvalid
                              ? { borderColor: "#ef4444", backgroundColor: "#fff5f5" }
                              : isIotaSumValid
                              ? { borderColor: "#22c55e", backgroundColor: "#f0fdf4" }
                              : undefined
                          }
                          value={form.iota_benign}
                          onChange={(e) => handleChange("iota_benign", e.target.value)}
                        />
                      </div>

                      {/* Malignant */}
                      <div className="form-item">
                        <label className="field-label" style={{ fontSize: "14.5px" }}>Malignant (%)</label>
                        <input
                          type="number"
                          step="0.1"
                          className="form-input"
                          style={
                            isIotaSumInvalid
                              ? { borderColor: "#ef4444", backgroundColor: "#fff5f5" }
                              : isIotaSumValid
                              ? { borderColor: "#22c55e", backgroundColor: "#f0fdf4" }
                              : undefined
                          }
                          value={form.iota_malignant}
                          onChange={(e) => handleChange("iota_malignant", e.target.value)}
                        />
                      </div>

                      {/* Borderline */}
                      <div className="form-item">
                        <label className="field-label" style={{ fontSize: "14.5px" }}>Borderline</label>
                        <input
                          type="number"
                          step="0.1"
                          className="form-input"
                          style={
                            isIotaSumInvalid
                              ? { borderColor: "#ef4444", backgroundColor: "#fff5f5" }
                              : isIotaSumValid
                              ? { borderColor: "#22c55e", backgroundColor: "#f0fdf4" }
                              : undefined
                          }
                          value={form.iota_borderline}
                          onChange={(e) => handleChange("iota_borderline", e.target.value)}
                        />
                      </div>

                      {/* Stage I */}
                      <div className="form-item">
                        <label className="field-label" style={{ fontSize: "14.5px" }}>Stage I</label>
                        <input
                          type="number"
                          step="0.1"
                          className="form-input"
                          style={
                            isIotaSumInvalid
                              ? { borderColor: "#ef4444", backgroundColor: "#fff5f5" }
                              : isIotaSumValid
                              ? { borderColor: "#22c55e", backgroundColor: "#f0fdf4" }
                              : undefined
                          }
                          value={form.iota_stage1}
                          onChange={(e) => handleChange("iota_stage1", e.target.value)}
                        />
                      </div>

                      {/* Stage II-IV */}
                      <div className="form-item">
                        <label className="field-label" style={{ fontSize: "14.5px" }}>Stage II-IV</label>
                        <input
                          type="number"
                          step="0.1"
                          className="form-input"
                          style={
                            isIotaSumInvalid
                              ? { borderColor: "#ef4444", backgroundColor: "#fff5f5" }
                              : isIotaSumValid
                              ? { borderColor: "#22c55e", backgroundColor: "#f0fdf4" }
                              : undefined
                          }
                          value={form.iota_stage2_4}
                          onChange={(e) => handleChange("iota_stage2_4", e.target.value)}
                        />
                      </div>

                      {/* Metastatic */}
                      <div className="form-item">
                        <label className="field-label" style={{ fontSize: "14.5px" }}>Metastatic (%)</label>
                        <input
                          type="number"
                          step="0.1"
                          className="form-input"
                          style={
                            isIotaSumInvalid
                              ? { borderColor: "#ef4444", backgroundColor: "#fff5f5" }
                              : isIotaSumValid
                              ? { borderColor: "#22c55e", backgroundColor: "#f0fdf4" }
                              : undefined
                          }
                          value={form.iota_metastatic}
                          onChange={(e) => handleChange("iota_metastatic", e.target.value)}
                        />
                      </div>
                    </div>

                    {isIotaSumInvalid && (
                      <div
                        style={{
                          marginTop: "16px",
                          padding: "12px 16px",
                          borderRadius: "8px",
                          background: "#fef2f2",
                          border: "1.5px solid #ef4444",
                          color: "#b91c1c",
                          fontSize: "14.5px",
                          fontWeight: 600,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          gap: "10px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "18px" }}>⚠️</span>
                          <span>
                            Cảnh báo sai lệch: Tổng 6 mục hiện là <strong>{currentIotaSum}%</strong>. Yêu cầu tổng phải bằng đúng <strong>100%</strong> (Hiện đang {currentIotaSum > 100 ? "vượt quá" : "còn thiếu"}{" "}
                            <strong>{Math.abs(parseFloat((100 - currentIotaSum).toFixed(1)))}%</strong>)!
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            type="button"
                            onClick={handleAutoBalanceIota}
                            style={{
                              padding: "6px 14px",
                              background: "#b91c1c",
                              color: "#ffffff",
                              border: "none",
                              borderRadius: "6px",
                              fontSize: "13.5px",
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            🎯 Tự động cân đối 100%
                          </button>
                          <button
                            type="button"
                            onClick={handleResetIota}
                            style={{
                              padding: "6px 12px",
                              background: "#ffffff",
                              color: "#64748b",
                              border: "1px solid #cbd5e1",
                              borderRadius: "6px",
                              fontSize: "13px",
                              fontWeight: 500,
                              cursor: "pointer",
                            }}
                          >
                            ↺ Xóa làm lại
                          </button>
                        </div>
                      </div>
                    )}

                    {isIotaSumValid && (
                      <div
                        style={{
                          marginTop: "16px",
                          padding: "10px 16px",
                          borderRadius: "8px",
                          background: "#f0fdf4",
                          border: "1.5px solid #86efac",
                          color: "#15803d",
                          fontSize: "14px",
                          fontWeight: 600,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          gap: "10px",
                        }}
                      >
                        <span> Tuyệt vời! Tổng 6 mục đã đạt chuẩn đúng 100%. Dữ liệu hoàn toàn hợp lệ để lưu phiếu.</span>
                        <button
                          type="button"
                          onClick={handleResetIota}
                          style={{
                            padding: "4px 10px",
                            background: "transparent",
                            color: "#15803d",
                            border: "1px solid #86efac",
                            borderRadius: "6px",
                            fontSize: "12.5px",
                            fontWeight: 500,
                            cursor: "pointer",
                          }}
                        >
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
          className={`section-accordion ${openSections.sec5 ? "is-open" : ""}`}
        >
          <button
            type="button"
            className="section-header-btn"
            onClick={() => toggleSection("sec5")}
          >
            <div className="section-header-left">
              <span className="section-roman-badge">V</span>
              <div className="section-title-wrap">
                <h3>ĐẶC ĐIỂM CỘNG HƯỞNG TỪ (MRI)</h3>
              </div>
            </div>
            <div className="section-header-right">
              <span className={`section-count-badge ${countSec5 === 15 ? "is-complete" : ""}`}>
                {countSec5}/15 câu
              </span>
            </div>
          </button>

          {openSections.sec5 && (
            <div className="section-body">
              <div className="form-grid-2">
                {/* 39. Mô buồng trứng */}
                <div className="form-item">
                  <label className="field-label">Mô buồng trứng</label>
                  <select
                    className="form-select"
                    value={form.mri_mo_buong_trung}
                    onChange={(e) => handleChange("mri_mo_buong_trung", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Còn">Còn</option>
                    <option value="Không quan sát thấy">Không quan sát thấy</option>
                    <option value="Không đánh giá">Không đánh giá</option>
                  </select>
                </div>

                {/* 40. Số lượng u */}
                <div className="form-item">
                  <label className="field-label">Số lượng u</label>
                  <select
                    className="form-select"
                    value={form.mri_so_luong_u}
                    onChange={(e) => handleChange("mri_so_luong_u", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="1 bên">1 bên</option>
                    <option value="2 bên">2 bên</option>
                  </select>
                </div>

                {/* 41. Dạng tổn thương */}
                <div className="form-item">
                  <label className="field-label">Dạng tổn thương</label>
                  <select
                    className="form-select"
                    value={form.mri_dang_ton_thuong}
                    onChange={(e) => handleChange("mri_dang_ton_thuong", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Nang đơn thùy">Nang đơn thùy</option>
                    <option value="Nang đa thùy">Nang đa thùy</option>
                    <option value="Nang và đặc">Nang và đặc</option>
                    <option value="chứa mỡ">chứa mỡ</option>
                    <option value="Nang">Nang</option>
                    <option value="U đặc">U đặc</option>
                  </select>
                </div>

                {/* 42. Kích thước u */}
                <div className="form-item">
                  <label className="field-label">Kích thước u</label>
                  <input
                    type="number"
                    className="form-input"
                    value={form.mri_kich_thuoc_u}
                    onChange={(e) => handleChange("mri_kich_thuoc_u", e.target.value)}
                  />
                </div>

                {/* 43. Dịch nang (T1W và T2W - 5 biến chuẩn) */}
                <div className="form-item">
                  <label className="field-label">Dịch nang (T1W)</label>
                  <select
                    className="form-select"
                    value={form.mri_dich_nang_t1w || ""}
                    onChange={(e) => {
                      const t1 = e.target.value;
                      handleChange("mri_dich_nang_t1w", t1);
                      const t2 = form.mri_dich_nang_t2w || "cao";
                      handleChange("mri_dich_nang", `T1w: ${t1}, T2w: ${t2}`);
                    }}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="thấp">Thấp</option>
                    <option value="cao">Cao</option>
                    <option value="trung gian">Trung gian</option>
                    <option value="cao và thấp">Cao và thấp (Không đồng nhất)</option>
                    <option value="không xác định">Không xác định</option>
                  </select>
                </div>

                <div className="form-item">
                  <label className="field-label">Dịch nang (T2W)</label>
                  <select
                    className="form-select"
                    value={form.mri_dich_nang_t2w || ""}
                    onChange={(e) => {
                      const t2 = e.target.value;
                      handleChange("mri_dich_nang_t2w", t2);
                      const t1 = form.mri_dich_nang_t1w || "thấp";
                      handleChange("mri_dich_nang", `T1w: ${t1}, T2w: ${t2}`);
                    }}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="cao">Cao</option>
                    <option value="thấp">Thấp</option>
                    <option value="trung gian">Trung gian</option>
                    <option value="cao và thấp">Cao và thấp (Không đồng nhất)</option>
                    <option value="không xác định">Không xác định</option>
                  </select>
                </div>

                {/* 44. Thành phần mỡ */}
                <div className="form-item">
                  <label className="field-label">Thành phần mỡ</label>
                  <select
                    className="form-select"
                    value={form.mri_thanh_phan_mo}
                    onChange={(e) => handleChange("mri_thanh_phan_mo", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                </div>

                {/* 45. Phần đặc */}
                <div className="form-item">
                  <label className="field-label">Phần đặc</label>
                  <select
                    className="form-select"
                    value={form.mri_phan_dac}
                    onChange={(e) => handleChange("mri_phan_dac", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                  {form.mri_phan_dac === "Có" && (
                    <div className="conditional-box">
                      <label style={{ fontSize: "14px", color: "#334155", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                        Kích thước phần đặc
                      </label>
                      <input
                        type="number"
                        className="form-input"
                        value={form.mri_kich_thuoc_phan_dac}
                        onChange={(e) => handleChange("mri_kich_thuoc_phan_dac", e.target.value)}
                      />
                    </div>
                  )}
                </div>

                {/* 47. Khuếch tán */}
                <div className="form-item">
                  <label className="field-label">Khuếch tán</label>
                  <select
                    className="form-select"
                    value={form.mri_khuech_tan}
                    onChange={(e) => handleChange("mri_khuech_tan", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không giới hạn">Không giới hạn</option>
                    <option value="Giới hạn">Giới hạn</option>
                    <option value="Không đánh giá">Không đánh giá</option>
                  </select>
                </div>

                {/* 48. Đặc điểm ngấm thuốc tương phản từ */}
                <div className="form-item">
                  <label className="field-label">Đặc điểm ngấm thuốc tương phản từ</label>
                  <select
                    className="form-select"
                    value={form.mri_ngam_thuoc}
                    onChange={(e) => handleChange("mri_ngam_thuoc", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
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
                  <label className="field-label">Hạch</label>
                  <select
                    className="form-select"
                    value={form.mri_hach}
                    onChange={(e) => handleChange("mri_hach", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                </div>

                {/* 50. Dịch ổ bụng */}
                <div className="form-item">
                  <label className="field-label">Dịch ổ bụng</label>
                  <select
                    className="form-select"
                    value={form.mri_dich_o_bung}
                    onChange={(e) => handleChange("mri_dich_o_bung", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Cùng đồ">Cùng đồ</option>
                    <option value="2 hố chậu">2 hố chậu</option>
                    <option value="khoảng gan thận">khoảng gan thận</option>
                    <option value="Dịch màng phổi">Dịch màng phổi</option>
                  </select>
                </div>

                {/* 51. Tổn thương cơ quan khác */}
                <div className="form-item">
                  <label className="field-label">Tổn thương cơ quan khác</label>
                  <input
                    type="text"
                    className="form-input"
                    value={form.mri_ton_thuong_co_quan_khac}
                    onChange={(e) => handleChange("mri_ton_thuong_co_quan_khac", e.target.value)}
                  />
                </div>

                {/* ORADS */}
                <div className="form-item">
                  <label className="field-label">ORADS</label>
                  <select
                    className="form-select"
                    value={form.sa_orads}
                    onChange={(e) => handleChange("sa_orads", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
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
                  <label className="field-label">Kết luận MRI</label>
                  <input
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
          className={`section-accordion ${openSections.sec6 ? "is-open" : ""}`}
        >
          <button
            type="button"
            className="section-header-btn"
            onClick={() => toggleSection("sec6")}
          >
            <div className="section-header-left">
              <span className="section-roman-badge">VI</span>
              <div className="section-title-wrap">
                <h3>PROTOCOL PHẪU THUẬT</h3>
              </div>
            </div>
            <div className="section-header-right">
              <span className={`section-count-badge ${countSec6 === 6 ? "is-complete" : ""}`}>
                {countSec6}/6 mục
              </span>
            </div>
          </button>

          {openSections.sec6 && (
            <div className="section-body">
              <div className="form-grid-2">
                {/* 1. Chẩn đoán trước phẫu thuật */}
                <div className="form-item">
                  <label className="field-label">1. Chẩn đoán trước phẫu thuật</label>
                  <select
                    className="form-select"
                    value={form.pt_chan_doan_truoc}
                    onChange={(e) => handleChange("pt_chan_doan_truoc", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="u buồng trứng">u buồng trứng</option>
                    <option value="ung thư buồng trứng">ung thư buồng trứng</option>
                  </select>
                </div>

                {/* 2. Chẩn đoán sau phẫu thuật */}
                <div className="form-item">
                  <label className="field-label">2. Chẩn đoán sau phẫu thuật</label>
                  <select
                    className="form-select"
                    value={form.pt_chan_doan_sau}
                    onChange={(e) => handleChange("pt_chan_doan_sau", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
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
                          className={`toggle-chip ${isChecked ? "active" : ""}`}
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
                  <label className="field-label">4. Sinh thiết lạnh</label>
                  <select
                    className="form-select"
                    value={form.pt_sinh_thiet_lanh}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleChange("pt_sinh_thiet_lanh", val);
                      if (val === "Không") {
                        handleChange("pt_sinh_thiet_lanh_ghi_chu", "");
                      }
                    }}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không">Không</option>
                    <option value="Có">Có</option>
                  </select>
                  {form.pt_sinh_thiet_lanh === "Có" && (
                    <div className="conditional-box">
                      <label style={{ fontSize: "14px", color: "#334155", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                        Ghi chú kết quả sinh thiết lạnh
                      </label>
                      <input
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

                {/* 5. Dịch ổ bụng khi phẫu thuật */}
                <div className="form-item">
                  <label className="field-label">5. Dịch ổ bụng khi phẫu thuật</label>
                  <select
                    className="form-select"
                    value={form.pt_dich_o_bung || ""}
                    onChange={(e) => handleChange("pt_dich_o_bung", e.target.value)}
                  >
                    <option value="" disabled>-- Chọn --</option>
                    <option value="Không có">Không có</option>
                    <option value="Lượng ít (< 100ml)">Lượng ít (&lt; 100ml)</option>
                    <option value="Lượng vừa (100 - 500ml)">Lượng vừa (100 - 500ml)</option>
                    <option value="Lượng nhiều (> 500ml)">Lượng nhiều (&gt; 500ml)</option>
                    <option value="Không đánh giá">Không đánh giá</option>
                  </select>
                </div>

                {/* 6. Mô tả tổn thương u khi phẫu thuật */}
                <div className="form-item form-col-span-full">
                  <label className="field-label">6. Mô tả tổn thương u khi phẫu thuật</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ví dụ: U buồng trứng P dạng nang đa thùy..."
                    value={form.pt_ton_thuong || ""}
                    onChange={(e) => handleChange("pt_ton_thuong", e.target.value)}
                  />
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
          className={`section-accordion ${openSections.sec7 ? "is-open" : ""}`}
        >
          <button
            type="button"
            className="section-header-btn"
            onClick={() => toggleSection("sec7")}
          >
            <div className="section-header-left">
              <span className="section-roman-badge">VII</span>
              <div className="section-title-wrap">
                <h3>PHÂN LOẠI GIẢI PHẪU BỆNH CỦA U BUỒNG TRỨNG THEO WHO</h3>
              </div>
            </div>
            <div className="section-header-right">
              <span className={`section-count-badge ${selectedPathologyId ? "is-complete" : ""}`}>
                {selectedPathologyId ? "Đã chọn 1" : "0/1 câu"}
              </span>
            </div>
          </button>

          {openSections.sec7 && (
            <div className="section-body">
              <div className="form-grid-2">
                {/* 1. Trường chính: Dropdown chọn kết quả GPB WHO chuẩn */}
                <div className="form-item form-col-span-full">
                  <label className="field-label">
                    <span>Kết quả Phân loại Giải phẫu bệnh theo WHO</span>
                    <span className="field-hint">(Chọn 1 trong các lựa chọn)</span>
                  </label>
                  <select
                    className="form-select"
                    value={selectedPathologyId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedPathologyId(val);
                      sessionStorage.setItem("clinical_form_draft_pathology", val);
                    }}
                  >
                    <option value="" disabled>-- Vui lòng chọn kết quả giải phẫu bệnh theo WHO --</option>
                    {WHO_PATHOLOGY_OPTIONS_V2.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  {/* Khi chọn Khác: Hiện conditional-box ghi rõ */}
                  {selectedPathologyId === "pathology_other" && (
                    <div className="conditional-box">
                      <label style={{ fontSize: "14px", color: "#334155", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                        Ghi rõ kết quả giải phẫu bệnh khác <span className="required-star">*</span>
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Nhập tên giải phẫu bệnh khác..."
                        value={pathologyOtherText}
                        onChange={(e) => setPathologyOtherText(e.target.value)}
                        autoFocus
                      />
                    </div>
                  )}
                </div>

                {/* Thông tin bản chất u tự động & Mã ICD-O tương ứng */}
                {selectedPathologyId && (
                  <div className="form-item form-col-span-full">
                    <div
                      style={{
                        padding: "16px 20px",
                        background: "#f8fafc",
                        border: "1.5px solid #e2e8f0",
                        borderRadius: "10px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: "12px",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "13px", color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          Bản chất u (Tự động xác định theo WHO)
                        </div>
                        <div style={{ marginTop: "6px" }}>
                          {(() => {
                            const matched = WHO_PATHOLOGY_OPTIONS_V2.find((o) => o.id === selectedPathologyId);
                            const cls = matched?.classification;
                            if (!cls || cls === "unspecified") {
                              return <span style={{ color: "#64748b", fontStyle: "italic", fontSize: "14.5px" }}>Chưa phân loại (tùy thuộc chẩn đoán khác)</span>;
                            }
                            return (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  padding: "5px 14px",
                                  borderRadius: "16px",
                                  fontSize: "14px",
                                  fontWeight: 700,
                                  backgroundColor:
                                    cls === "benign" ? "#dcfce7" :
                                    cls === "borderline" ? "#fef3c7" : "#fee2e2",
                                  color:
                                    cls === "benign" ? "#166534" :
                                    cls === "borderline" ? "#92400e" : "#991b1b",
                                  border:
                                    cls === "benign" ? "1px solid #86efac" :
                                    cls === "borderline" ? "1px solid #fde68a" : "1px solid #fca5a5",
                                }}
                              >
                                {cls === "benign" ? "🟢 Lành tính" :
                                 cls === "borderline" ? "🟠 Giáp biên ác" : "🔴 Ác tính"}
                              </span>
                            );
                          })()}
                        </div>
                      </div>

                      {selectedPathologyId !== "pathology_other" && (
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: "13px", color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                            Mã ICD-O
                          </div>
                          <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--primary)", marginTop: "4px" }}>
                            {WHO_PATHOLOGY_OPTIONS_V2.find((o) => o.id === selectedPathologyId)?.code || "--"}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Tùy chọn xem toàn bộ danh sách 20 lựa chọn (dạng danh sách radio chuẩn) */}
                <div className="form-item form-col-span-full" style={{ marginTop: "6px" }}>
                  <button
                    type="button"
                    onClick={() => setShowPathologyRadioList((prev) => !prev)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--primary)",
                      fontSize: "14.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "4px 0",
                      alignSelf: "flex-start",
                    }}
                  >
                    <span>{showPathologyRadioList ? "▲ Thu gọn danh sách lựa chọn" : "▼ Xem danh sách chi tiết tất cả 20 lựa chọn GPB theo WHO"}</span>
                  </button>

                  {showPathologyRadioList && (
                    <div className="options-list" style={{ marginTop: "12px" }}>
                      {WHO_PATHOLOGY_OPTIONS_V2.map((opt) => {
                        const isSelected = selectedPathologyId === opt.id;
                        return (
                          <label
                            key={opt.id}
                            className={`option-row ${isSelected ? "is-selected" : ""}`}
                            style={{
                              padding: "10px 14px",
                              border: isSelected ? "1.5px solid var(--primary)" : "1px solid #e2e8f0",
                              borderRadius: "8px",
                              marginBottom: "6px",
                              background: isSelected ? "var(--primary-light)" : "#ffffff",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: "12px",
                            }}
                          >
                            <input
                              type="radio"
                              name="who_pathology_radio_list"
                              value={opt.id}
                              checked={isSelected}
                              onChange={() => {
                                setSelectedPathologyId(opt.id);
                                sessionStorage.setItem("clinical_form_draft_pathology", opt.id);
                              }}
                            />
                            <span
                              className="option-label"
                              style={{
                                fontSize: "15px",
                                fontWeight: isSelected ? 600 : 400,
                                color: isSelected ? "var(--primary)" : "var(--text-primary)",
                              }}
                            >
                              {opt.label}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* FOOTER ACTIONS BAR: CHỈ GIỮ NÚT GỬI PHIẾU KHẢO SÁT */}
        {/* ============================================================== */}
        <div
          style={{
            background: "#ffffff",
            border: "1.5px solid #cbd5e1",
            borderRadius: "12px",
            padding: "20px 24px",
            marginTop: "26px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            boxShadow: "0 2px 6px rgba(0, 0, 0, 0.04)",
          }}
        >
          <button
            type="submit"
            className="btn-submit"
            disabled={isSubmitting}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              minWidth: "220px",
              padding: "12px 32px",
              fontSize: "16px",
              fontWeight: 600,
            }}
          >
            <Send size={19} />
            {isSubmitting ? "Đang gửi dữ liệu..." : "Gửi Phiếu Khảo Sát"}
          </button>
        </div>
      </form>
    </div>
  );
};
