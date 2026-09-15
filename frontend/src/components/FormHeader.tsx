import React from "react";

interface FormHeaderProps {
  title: string;
  description?: string;
  hasRequiredFields?: boolean;
}

export const FormHeader: React.FC<FormHeaderProps> = ({
  title,
  description,
  hasRequiredFields = true,
}) => {
  return (
    <div className="form-card header-card">
      <h1 className="form-title">{title}</h1>
      {description && <div className="form-description">{description}</div>}
      {hasRequiredFields && (
        <div className="required-notice">
          * Biểu thị câu hỏi bắt buộc
        </div>
      )}
    </div>
  );
};
