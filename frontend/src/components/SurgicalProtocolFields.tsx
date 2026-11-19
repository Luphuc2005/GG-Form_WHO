import React from "react";

export const SURGICAL_FINDINGS = [
  { id: "pt_co_dich_o_bung", label: "Dịch ổ bụng", description: "Mô tả dịch ổ bụng" },
  { id: "pt_u_dinh_co_quan_khac", label: "U dính với cơ quan khác", description: "Mô tả u dính với cơ quan khác" },
  { id: "pt_nghi_ngo_di_can", label: "Tổn thương nghi ngờ di căn", description: "Mô tả tổn thương nghi ngờ di căn" },
] as const;

interface Props {
  values: Record<string, unknown>;
  disabled: boolean;
  onChange: (field: string, value: string) => void;
  choiceOptions: (field: string) => React.ReactNode;
}

export const SurgicalProtocolFields: React.FC<Props> = ({ values, disabled, onChange, choiceOptions }) => (
  <>
    <div className="form-item">
      <label className="field-label" htmlFor="entry-pt_so_luong_u">Số lượng u</label>
      <select id="entry-pt_so_luong_u" name="pt_so_luong_u" aria-label="Số lượng u (Phẫu thuật)"
        className="form-select" disabled={disabled} value={String(values.pt_so_luong_u || "")}
        onChange={event => onChange("pt_so_luong_u", event.target.value)}>
        {choiceOptions("pt_so_luong_u")}
      </select>
    </div>
    {SURGICAL_FINDINGS.map(({ id, label, description }) => {
      const detail = `${id}_ghi_chu`;
      return <div className="form-item" key={id}>
        <label className="field-label" htmlFor={`entry-${id}`}>{label}</label>
        <select id={`entry-${id}`} name={id} aria-label={`${label} (Phẫu thuật)`}
          className="form-select" disabled={disabled} value={String(values[id] || "")}
          onChange={event => onChange(id, event.target.value)}>
          {choiceOptions(id)}
        </select>
        {values[id] === "Có" && <div className="conditional-box">
          <label className="conditional-box-label" htmlFor={`entry-${detail}`}>{description}</label>
          <textarea id={`entry-${detail}`} name={detail} aria-label={`${description} (Phẫu thuật)`}
            className="form-input" rows={3} maxLength={4000} disabled={disabled}
            value={String(values[detail] || "")} onChange={event => onChange(detail, event.target.value)}/>
        </div>}
      </div>;
    })}
  </>
);
