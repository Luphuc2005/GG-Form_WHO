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

export interface ClinicalField {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "multiselect";
  section: "sec1" | "sec2" | "sec3" | "sec4" | "sec5" | "sec6" | "extra";
  active: boolean;
  required: boolean;
  export: boolean;
  choices: string[];
  help_text: string;
  min_value: number | null;
  max_value: number | null;
  show_when: string | null;
  show_values: string[];
}

export interface FormSchemaDefinition {
  form_key: string;
  version: number;
  title: string;
  description?: string;
  fields: FormField[];
  clinical_fields?: ClinicalField[] | null;
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
