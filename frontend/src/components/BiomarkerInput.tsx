import React from "react";
import "../styles/biomarker.css";

interface Props {
  field: string;
  label: string;
  inputId: string;
  value: unknown;
  disabled: boolean;
  onChange: (field: string, value: string) => void;
  min?: number | null;
  max?: number | null;
  unit?: unknown;
  otherUnit?: unknown;
  unitChoices?: string[];
  unitDisabled?: boolean;
  requireUnit?: boolean;
}

export const BiomarkerInput: React.FC<Props> = ({ field, label, inputId, value, disabled, onChange,
  min = 0, max, unit, otherUnit, unitChoices, unitDisabled = disabled, requireUnit = false }) => {
  const numericValue = String(value ?? "");
  const unitValue = String(unit ?? "");
  const hasResult = numericValue.trim() !== "";
  const input = <input id={inputId} name={field} aria-label={label} className="form-input" type="number"
    step="any" min={min ?? undefined} max={max ?? undefined} disabled={disabled}
    value={numericValue} onChange={event => onChange(field, event.target.value)}/>;
  if (!unitChoices?.length) return input;
  const unitId = `${inputId}-unit`, otherId = `${inputId}-unit-other`;
  return <div className="biomarker-control">
    <div className="biomarker-value-box"><label className="biomarker-control-label" htmlFor={inputId}>Giá trị gốc</label>{input}</div>
    <div className="biomarker-unit-box">
      <label className="biomarker-control-label" htmlFor={unitId}>Đơn vị / dạng kết quả</label>
      <select id={unitId} name={`${field}_unit`} aria-label={`Đơn vị ${label}`} title={unitValue || "Chọn theo phiếu xét nghiệm"}
        className="form-select" disabled={unitDisabled} value={unitValue} required={requireUnit && hasResult}
        onChange={event => onChange(`${field}_unit`, event.target.value)}>
        <option value="">-- Chọn đơn vị --</option>
        {unitChoices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
        {unitValue && !unitChoices.includes(unitValue) && <option value={unitValue}>{unitValue} (đã lưu)</option>}
      </select>
    </div>
    {unitValue === "Khác" && <div className="biomarker-other-box">
      <label className="biomarker-control-label" htmlFor={otherId}>Ghi rõ đơn vị / dạng kết quả trên phiếu gốc</label>
      <input id={otherId} name={`${field}_unit_other`} aria-label={`Đơn vị khác của ${label}`} className="form-input"
        type="text" maxLength={200} disabled={unitDisabled} value={String(otherUnit ?? "")}
        required={requireUnit && hasResult} onChange={event => onChange(`${field}_unit_other`, event.target.value)}/>
    </div>}
    {hasResult && (!unitValue || unitValue === "Chưa xác nhận") && <small className="biomarker-unit-notice">
      {unitValue ? "Đơn vị chưa xác nhận. Cần đối chiếu phiếu xét nghiệm trước khi phân tích." : "Chưa ghi đơn vị. Chọn theo phiếu gốc; không suy đoán theo bệnh viện."}
    </small>}
  </div>;
};
