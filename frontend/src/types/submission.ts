export interface SelectedOptionNode {
  id: string;
  children?: SelectedOptionNode[];
  other_text?: string;
}

export interface PathologyAnswers {
  selected: SelectedOptionNode[];
  other_text?: string;
}

export interface AnswersState {
  pathology: PathologyAnswers;
  classification: string;
}

export interface SubmissionPayload {
  submission_uuid: string;
  form_version: number;
  answers: AnswersState;
}

export interface SubmissionResponse {
  submission_uuid: string;
  reference_code: string;
  form_version: number;
  status: string;
  created_at: string;
  message: string;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: string[];
  };
}

export interface AdminStats {
  total_submissions: number;
  today_submissions: number;
  by_classification: Record<string, number>;
  by_form_version: Record<number, number>;
  by_workflow: Record<string, number>;
  by_sync: Record<string, number>;
  by_sheet_removal?: Record<string, number>;
  google_sheet_url?: string | null;
}

export interface AdminSubmissionItem {
  id: number;
  submission_uuid: string;
  reference_code: string;
  form_version: number;
  classification: string;
  created_at: string;
  so_hs?: string;
  ho_ten?: string;
  nam_sinh?: string;
  tuoi?: string;
}

export interface AdminSubmissionsPage {
  items: AdminSubmissionItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}
