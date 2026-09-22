export interface FormOption {
  id: string;
  label: string;
  numericCode?: string | number | null;
  classification?: string | null;
  has_other_text?: boolean;
  other_placeholder?: string;
  children?: FormOption[];
}

export interface FormField {
  id: string;
  type: "checkbox-group" | "radio" | "text" | "textarea";
  label: string;
  required: boolean;
  error_message?: string;
  options: FormOption[];
}

export interface FormSchemaDefinition {
  form_key: string;
  version: number;
  title: string;
  description?: string;
  fields: FormField[];
}

export interface FormVersionResponse {
  id: number;
  form_key: string;
  version: number;
  status: string;
  schema_json: FormSchemaDefinition;
  schema_hash: string;
  published_at?: string;
}
