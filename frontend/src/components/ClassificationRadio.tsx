import React from "react";
import { FormOption } from "../types/schema";

interface ClassificationRadioProps {
  options: FormOption[];
  selectedValue: string;
  onChange: (value: string) => void;
}

export const ClassificationRadio: React.FC<ClassificationRadioProps> = ({
  options,
  selectedValue,
  onChange,
}) => {
  return (
    <div className="options-list" role="radiogroup" aria-label="Phân loại Lành/Ác">
      {options.map((opt) => {
        const isSelected = selectedValue === opt.id;
        return (
          <label
            key={opt.id}
            className={`option-row ${isSelected ? "is-selected" : ""}`}
            style={{
              padding: "10px 14px",
              border: isSelected ? "1.5px solid var(--primary)" : "1px solid #e2e8f0",
              borderRadius: "8px",
              marginBottom: "8px",
              background: isSelected ? "var(--primary-light)" : "#ffffff",
              transition: "all 0.15s ease",
            }}
          >
            <input
              type="radio"
              name="classification"
              id={`radio-${opt.id}`}
              value={opt.id}
              checked={isSelected}
              onChange={() => onChange(opt.id)}
            />
            <span
              className="option-label"
              style={{
                fontWeight: isSelected ? 600 : 500,
                color: isSelected ? "var(--primary)" : "var(--text-primary)",
              }}
            >
              {opt.label}
            </span>
          </label>
        );
      })}
    </div>
  );
};
