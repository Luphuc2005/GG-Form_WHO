import React from "react";
import { AlertCircle } from "lucide-react";

interface FormCardProps {
  id: string;
  title: string;
  required?: boolean;
  error?: string | null;
  children: React.ReactNode;
}

export const FormCard: React.FC<FormCardProps> = ({
  id,
  title,
  required = false,
  error = null,
  children,
}) => {
  return (
    <div id={`card-${id}`} className={`form-card ${error ? "has-error" : ""}`}>
      <div className="question-title">
        <span>{title}</span>
        {required && <span className="required-star">*</span>}
      </div>

      {children}

      {error && (
        <div className="error-feedback" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
