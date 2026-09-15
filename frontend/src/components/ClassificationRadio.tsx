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
      {options.map((opt) => (
        <label key={opt.id} className="option-row">
          <input
            type="radio"
            name="classification"
            id={`radio-${opt.id}`}
            value={opt.id}
            checked={selectedValue === opt.id}
            onChange={() => onChange(opt.id)}
          />
          <span className="option-label">{opt.label}</span>
        </label>
      ))}
    </div>
  );
};
