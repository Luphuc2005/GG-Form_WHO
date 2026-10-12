import csv
import io
from datetime import datetime, timedelta
from typing import Any, Dict, Generator, List, Optional, Tuple
from sqlalchemy.orm import Session
from app.models.submission import Submission
from app.repositories.form_repo import FormRepository
from app.repositories.submission_repo import SubmissionRepository
from app.schemas.form import FormOptionSchema, FormSchemaDefinition


FORM_COLUMNS: List[Tuple[str, str]] = [
    # Thông tin định danh phiếu
    ("submission_uuid", "Mã phiếu"),
    ("created_at", "Thời gian gửi"),

    # I. Hành chính
    ("so_hs", "Số HS"),
    ("ho_ten", "Họ Tên"),
    ("nam_sinh", "Năm Sinh"),
    ("nam_kham", "Năm Khám"),
    ("tuoi_phau_thuat", "Tuổi BN khi phẫu thuật"),
    ("dia_chi", "Địa chỉ"),
    ("nghe_nghiep", "Nghề nghiệp"),

    # II. Tiền sử & Lâm sàng
    ("para", "PARA"),
    ("kinh_nguyet", "Kinh nguyệt"),
    ("thoi_diem_phat_hien", "Thời điểm phát hiện UBT"),
    ("tien_can_phau_thuat_ubt", "Tiền căn phẫu thuật UBT"),
    ("tien_can_ung_thu_khac", "Tiền căn ung thư khác"),
    ("tien_can_lac_nmtc", "Tiền căn lạc nội mạc tử cung"),
    ("co_thai", "Có thai"),
    ("ubt_xoan", "UBT xoắn"),
    ("ubt_vo", "UBT vỡ"),
    ("ubt_nhiem_trung", "UBT nhiễm trùng"),

    # III. Dấu ấn sinh học (Serum Tumor Markers)
    ("ca_125", "CA 125"),
    ("he4", "HE4"),
    ("roma", "ROMA"),
    ("afp", "AFP"),
    ("beta_hcg", "beta hCG"),

    # IV. Siêu âm (IOTA / O-RADS)
    ("sa_so_luong_u", "Số lượng u (Siêu âm)"),
    ("sa_mo_buong_trung", "Mô buồng trứng (Siêu âm)"),
    ("sa_phan_loai_u", "Phân loại u (Siêu âm)"),
    ("sa_phan_am", "Phản âm"),
    ("sa_kich_thuoc_u", "Kích thước u (Siêu âm)"),
    ("sa_bo_ngoai", "Bờ ngoài"),
    ("sa_bo_trong", "Bờ trong"),
    ("sa_so_luong_thuy", "Số lượng thùy"),
    ("sa_kich_thuoc_phan_dac", "Kích thước phần đặc (Siêu âm)"),
    ("sa_bong_lung", "Bóng lưng"),
    ("sa_nang_trong_phan_dac", "Nang trong phần đặc"),
    ("sa_choi", "Chồi"),
    ("sa_tang_sinh_mach_mau", "Tăng sinh mạch máu"),
    ("sa_dich_o_bung", "Dịch ổ bụng (Siêu âm)"),
    ("sa_ton_thuong_nmtc", "Tổn thương NMTC"),
    ("iota_benign", "IOTA - Benign (%)"),
    ("iota_malignant", "IOTA - Malignant (%)"),
    ("iota_borderline", "IOTA - Borderline (%)"),
    ("iota_stage1", "IOTA - Stage I (%)"),
    ("iota_stage2_4", "IOTA - Stage II-IV (%)"),
    ("iota_metastatic", "IOTA - Metastatic (%)"),
    ("sa_orads", "ORADS (Siêu âm)"),

    # V. Cộng hưởng từ (MRI)
    ("mri_mo_buong_trung", "Mô buồng trứng (MRI)"),
    ("mri_so_luong_u", "Số lượng u (MRI)"),
    ("mri_dang_ton_thuong", "Dạng tổn thương (MRI)"),
    ("mri_kich_thuoc_u", "Kích thước u (MRI)"),
    ("mri_dich_nang", "Dịch nang (T1w/T2w)"),
    ("mri_thanh_phan_mo", "Thành phần mỡ"),
    ("mri_phan_dac", "Phần đặc (MRI)"),
    ("mri_kich_thuoc_phan_dac", "Kích thước phần đặc (MRI)"),
    ("mri_khuech_tan", "Khuếch tán"),
    ("mri_ngam_thuoc", "Đặc điểm ngấm thuốc tương phản từ"),
    ("mri_hach", "Hạch"),
    ("mri_dich_o_bung", "Dịch ổ bụng (MRI)"),
    ("mri_ton_thuong_co_quan_khac", "Tổn thương cơ quan khác"),
    ("mri_ket_luan", "Kết luận MRI"),

    # VI. Protocol phẫu thuật (Các biến số mới)
    ("pt_chan_doan_truoc", "Chẩn đoán trước phẫu thuật"),
    ("pt_chan_doan_sau", "Chẩn đoán sau phẫu thuật"),
    ("pt_phuong_phap", "Phương pháp phẫu thuật"),
    ("pt_sinh_thiet_lanh", "Sinh thiết lạnh"),
    ("pt_ton_thuong", "Mô tả tổn thương u khi phẫu thuật"),
    ("pt_dich_o_bung", "Dịch ổ bụng khi phẫu thuật"),

    # VII. Phân loại GPB WHO (Gộp lại thành 1 cột duy nhất theo yêu cầu)
    ("who_diagnosis", "Phân loại Giải phẫu bệnh theo WHO"),
]

CLASSIFICATION_LABELS = {
    "benign": "Lành tính",
    "borderline": "Giáp biên ác",
    "malignant": "Ác tính",
    "unspecified": "Chưa phân loại",
}

AUTO_CLASSIFICATION_MAP = {
    # Lành tính (/0)
    "serous_cystadenoma_8441_0": "benign",
    "mucinous_cystadenoma_8470_0": "benign",
    "endometrioma_benign": "benign",
    "brenner_tumor_9000_0": "benign",
    "mature_teratoma_9080_0": "benign",
    "fibroma_8810_0": "benign",
    "thecoma_8600_0": "benign",
    "serous_benign": "benign",
    "seromucinous_benign": "benign",
    "fibroma": "benign",
    "cellular_fibroma": "benign",
    "thecoma": "benign",
    "mature_teratoma": "benign",

    # Giáp biên ác (/1)
    "serous_borderline_8442_1": "borderline",
    "mucinous_borderline_8472_1": "borderline",
    "cellular_fibroma_8810_1": "borderline",
    "serous_borderline": "borderline",
    "seromucinous_borderline": "borderline",

    # Ác tính (/3)
    "lgsc_8460_3": "malignant",
    "hgsc_8461_3": "malignant",
    "mucinous_adenocarcinoma_8480_3": "malignant",
    "endometrioid_adenocarcinoma_8380_3": "malignant",
    "seromucinous_carcinoma_8474_3": "malignant",
    "clear_cell_adenocarcinoma_8310_3": "malignant",
    "immature_teratoma_9080_3": "malignant",
    "dysgerminoma_9060_3": "malignant",
    "yolk_sac_tumor_9071_3": "malignant",
    "serous_carcinoma_low_grade": "malignant",
    "serous_carcinoma_high_grade": "malignant",
    "endometrioid_carcinoma": "malignant",
    "immature_teratoma": "malignant",
    "dysgerminoma": "malignant",
    "yolk_sac_tumor": "malignant",
}


def infer_classification(pathology_data: dict, current_classification: Optional[str] = None) -> str:
    if current_classification and current_classification not in ("unspecified", ""):
        return current_classification
    selected = pathology_data.get("selected", []) if isinstance(pathology_data, dict) else []
    for node in selected:
        nid = node.get("id", "")
        if nid in AUTO_CLASSIFICATION_MAP:
            return AUTO_CLASSIFICATION_MAP[nid]
        if nid.endswith("/0") or "benign" in nid or "lanh" in nid:
            return "benign"
        if nid.endswith("/1") or "borderline" in nid or "giap_bien" in nid:
            return "borderline"
        if nid.endswith("/3") or "carcinoma" in nid or "malignant" in nid or "adenocarcinoma" in nid or "ac" in nid:
            return "malignant"
    return current_classification or "unspecified"


class ExportService:
    @staticmethod
    def get_columns_from_schema(_: FormSchemaDefinition) -> List[Tuple[str, str, str]]:
        return [(key, label, label) for key, label in FORM_COLUMNS]

    @classmethod
    def stream_csv(
        cls,
        db: Session,
        form_version_num: Optional[int] = None
    ) -> Generator[str, None, None]:
        yield "\ufeff"

        if form_version_num is not None:
            form_ver = FormRepository.get_by_key_and_version(db, "ovarian-pathology-who", form_version_num)
        else:
            form_ver = FormRepository.get_published_by_key(db, "ovarian-pathology-who")

        if not form_ver:
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(["Error: Form version not found"])
            yield output.getvalue()
            return

        schema_def = FormSchemaDefinition.model_validate(form_ver.schema_json)
        columns = cls.get_columns_from_schema(schema_def)

        # Write header row
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([col[1] for col in columns])
        yield output.getvalue()

        label_map, code_map = cls._build_maps(schema_def)

        for sub in SubmissionRepository.stream_all(db, form_version=form_version_num, batch_size=1000):
            row_data = cls._flatten_submission_to_row(sub, columns, label_map, code_map)
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(row_data)
            yield output.getvalue()

    @classmethod
    def _build_label_map(cls, schema_def: FormSchemaDefinition) -> Dict[str, str]:
        label_map, _ = cls._build_maps(schema_def)
        return label_map

    @staticmethod
    def _build_maps(schema_def: FormSchemaDefinition) -> Tuple[Dict[str, str], Dict[str, str]]:
        label_map: Dict[str, str] = {}
        code_map: Dict[str, str] = {}
        pathology_field = next((f for f in schema_def.fields if f.id == "pathology"), None)
        if pathology_field:
            def recurse(options: List[FormOptionSchema]):
                for opt in options:
                    label_map[opt.id] = opt.label
                    if opt.numericCode:
                        code_map[opt.id] = str(opt.numericCode)
                    if opt.children:
                        recurse(opt.children)
            recurse(pathology_field.options)
        return label_map, code_map

    @classmethod
    def _flatten_submission_to_row(
        cls,
        submission: Submission,
        columns: List[Tuple[str, str, str]],
        label_map: Optional[Dict[str, str]] = None,
        code_map: Optional[Dict[str, str]] = None,
    ) -> List[Any]:
        answers = submission.answers or {}
        clinical_data = answers.get("clinical_data", {})
        pathology = answers.get("pathology", {})
        selected_nodes = pathology.get("selected", [])
        top_other_text = pathology.get("other_text", "")

        diagnosis_labels: List[str] = []
        diagnosis_codes: List[str] = []

        for node in selected_nodes:
            node_id = node.get("id")
            if not node_id:
                continue
            lbl = label_map.get(node_id, node_id) if label_map else node_id
            code = code_map.get(node_id, "") if code_map else ""
            if not code and "(" in lbl and ")" in lbl:
                # Extract code from label like (8441/0)
                import re
                m = re.search(r"\(([^)]+)\)", lbl)
                if m:
                    code = m.group(1)

            if node.get("other_text"):
                lbl += f" ({node['other_text']})"
                code = node["other_text"]

            diagnosis_labels.append(lbl)
            if code:
                diagnosis_codes.append(code)

        if not diagnosis_labels and top_other_text:
            diagnosis_labels.append(top_other_text)
            diagnosis_codes.append("Khác")

        created_vn = ""
        if submission.created_at:
            created_vn = (submission.created_at + timedelta(hours=7)).strftime("%H:%M:%S %d/%m/%Y")

        raw_cls = (submission.classification or "").lower()
        if not raw_cls or raw_cls == "unspecified":
            raw_cls = infer_classification(pathology, raw_cls)
        cls_vn = CLASSIFICATION_LABELS.get(raw_cls, raw_cls or "Chưa phân loại")

        who_diag_str = ", ".join(diagnosis_labels) if diagnosis_labels else ""
        who_code_str = ", ".join(diagnosis_codes) if diagnosis_codes else ""

        row = []
        for col_info in columns:
            col_key = col_info[0]
            if col_key == "submission_uuid":
                row.append(str(submission.submission_uuid))
            elif col_key == "created_at":
                row.append(created_vn)
            elif col_key == "classification":
                row.append(cls_vn)
            elif col_key == "who_icdo_code":
                row.append(who_code_str)
            elif col_key == "who_diagnosis":
                row.append(who_diag_str)
            elif col_key == "tien_can_phau_thuat_ubt":
                val = clinical_data.get("tien_can_phau_thuat_ubt", "")
                note = clinical_data.get("tien_can_phau_thuat_ubt_ghi_chu", "")
                row.append(f"{val} ({note})" if note and val == "Có" else (val or ""))
            elif col_key == "tien_can_ung_thu_khac":
                val = clinical_data.get("tien_can_ung_thu_khac", "")
                note = clinical_data.get("tien_can_ung_thu_khac_ghi_chu", "")
                row.append(f"{val} ({note})" if note and val == "Có" else (val or ""))
            elif col_key == "sa_ton_thuong_nmtc":
                val = clinical_data.get("sa_ton_thuong_nmtc", "")
                note = clinical_data.get("sa_ton_thuong_nmtc_ghi_chu", "")
                row.append(f"{val} ({note})" if note and val == "Có" else (val or ""))
            elif col_key == "pt_sinh_thiet_lanh":
                val = clinical_data.get("pt_sinh_thiet_lanh", "")
                note = clinical_data.get("pt_sinh_thiet_lanh_ghi_chu", "")
                row.append(f"{val} ({note})" if note and val == "Có" else (val or ""))
            elif col_key == "pt_phuong_phap":
                val = clinical_data.get("pt_phuong_phap", "")
                if isinstance(val, list):
                    val = ", ".join(str(x) for x in val)
                row.append(val or "")
            elif col_key == "so_hs":
                val = str(clinical_data.get("so_hs", "") or "").strip()
                if val:
                    # Tiền tố ' giúp Google Sheets và Excel không biến 0000 thành 0 hoặc 0001 thành 1
                    row.append(f"'{val}" if not val.startswith("'") else val)
                else:
                    row.append("")
            elif col_key == "para":
                val = str(clinical_data.get("para", "") or "").strip()
                if val:
                    if val.isdigit() and len(val) < 4:
                        val = val.zfill(4)
                    # Tiền tố ' giúp Google Sheets và Excel nhận diện là dạng Chuỗi (Text) không bị mất số 0000
                    row.append(f"'{val}" if not val.startswith("'") else val)
                else:
                    row.append("")
            else:
                val = clinical_data.get(col_key, "")
                if isinstance(val, list):
                    val = ", ".join(str(x) for x in val)
                row.append(val if val is not None else "")

        return row
