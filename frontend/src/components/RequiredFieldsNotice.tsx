import type { RequiredFieldIssue } from "../utils/requiredFields";

export function RequiredFieldsNotice({issues, onFocus}: {issues: RequiredFieldIssue[]; onFocus: (issue: RequiredFieldIssue) => void}) {
  if (!issues.length) return null;
  return <div className="required-fields-notice" role="alert">
    <strong>Còn {issues.length} mục bắt buộc chưa nhập.</strong>
    <button type="button" onClick={() => onFocus(issues[0])}>Đến mục: {issues[0].label}</button>
  </div>;
}
