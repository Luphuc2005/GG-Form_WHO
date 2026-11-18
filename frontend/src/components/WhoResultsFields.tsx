import React from "react";
import { FormOption } from "../types/schema";
import { RecordAnswers } from "../api/workflow";
import "../styles/who-results.css";

export interface WhoResultValue {
  id: string;
  other: string;
}
export const whoValueAt = (
  answers: RecordAnswers,
  slot: 1 | 2,
): WhoResultValue => {
  const node = answers.pathology?.selected?.find(
    (item, index) => (item.slot || index + 1) === slot,
  );
  return {
    id: node?.id || "",
    other:
      node?.other_text ||
      (slot === 1 ? answers.pathology?.other_text : "") ||
      "",
  };
};
export const buildWhoPathology = (
  values: [WhoResultValue, WhoResultValue],
  options: FormOption[],
): RecordAnswers["pathology"] => ({
  selected: values.flatMap((value, index) =>
    value.id
      ? [
          {
            id: value.id,
            slot: (index + 1) as 1 | 2,
            children: [],
            other_text: options.find((o) => o.id === value.id)?.has_other_text
              ? value.other.trim()
              : null,
          },
        ]
      : [],
  ),
  other_text: null,
});

interface Props {
  options: FormOption[];
  values: [WhoResultValue, WhoResultValue];
  disabled: boolean;
  onChange: (slot: 1 | 2, value: WhoResultValue) => void;
}
const CLASS_NAMES: Record<string, string> = {
  benign: "Lành tính",
  borderline: "Giáp biên ác",
  malignant: "Ác tính",
};

export const WhoResultsFields: React.FC<Props> = ({
  options,
  values,
  disabled,
  onChange,
}) => (
  <div className="who-results-fields">
    {values.map((value, index) => {
      const slot = (index + 1) as 1 | 2;
      const option = options.find((o) => o.id === value.id);
      const classification = option?.classification || "unspecified";
      return (
        <section key={slot} className="who-result-field">
          <label className="field-label" htmlFor={`who-result-${slot}`}>
            <span>
              Kết quả giải phẫu bệnh WHO {slot}
              {slot === 1 && <span className="required-star"> *</span>}
            </span>
            <span className="field-hint">
              {slot === 1 ? "Kết quả chính" : "Không bắt buộc"}
            </span>
          </label>
          <select
            id={`who-result-${slot}`}
            name={`who_result_${slot}`}
            aria-label={`Kết quả giải phẫu bệnh WHO ${slot}`}
            aria-required={slot === 1}
            className="form-select"
            disabled={disabled}
            value={value.id}
            onChange={(e) => onChange(slot, { id: e.target.value, other: "" })}
          >
            <option value="">
              {slot === 1
                ? "-- Chọn kết quả WHO 1 --"
                : "-- Chưa có kết quả WHO 2 --"}
            </option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {option?.has_other_text && (
            <div className="conditional-box">
              <label
                htmlFor={`who-other-${slot}`}
                className="conditional-box-label"
              >
                Ghi rõ kết quả khác — WHO {slot} *
              </label>
              <input
                id={`who-other-${slot}`}
                className="form-input"
                aria-label={`Kết quả khác WHO ${slot}`}
                disabled={disabled}
                maxLength={4000}
                value={value.other}
                onChange={(e) =>
                  onChange(slot, { ...value, other: e.target.value })
                }
              />
            </div>
          )}
          {option && (
            <div className="who-summary-card">
              <div>
                <div className="who-summary-kicker">
                  Bản chất u — WHO {slot}
                </div>
                {CLASS_NAMES[classification] ? (
                  <span
                    className={`who-classification-badge is-${classification}`}
                  >
                    {CLASS_NAMES[classification]}
                  </span>
                ) : (
                  <span className="field-hint">Chưa phân loại</span>
                )}
              </div>
              <div>
                <div className="who-summary-kicker">Mã ICD-O</div>
                <div className="who-icdo-code">{option.numericCode || "—"}</div>
              </div>
            </div>
          )}
          <details className="who-result-catalog">
            <summary>
              Xem danh mục {options.length} lựa chọn WHO {slot}
            </summary>
            <div className="options-list">
              {options.map((o) => (
                <label
                  className={`option-row ${value.id === o.id ? "is-selected" : ""}`}
                  key={o.id}
                >
                  <input
                    type="radio"
                    name={`who_catalog_${slot}`}
                    disabled={disabled}
                    checked={value.id === o.id}
                    onChange={() => onChange(slot, { id: o.id, other: "" })}
                  />
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
          </details>
        </section>
      );
    })}
  </div>
);
