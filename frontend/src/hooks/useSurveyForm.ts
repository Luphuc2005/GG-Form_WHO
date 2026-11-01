import { useState, useCallback } from "react";
import { FormOption, FormSchemaDefinition } from "../types/schema";
import { SelectedOptionNode, SubmissionPayload, SubmissionResponse } from "../types/submission";
import { submitSurveyAnswers } from "../api/client";
import { useSessionDraft } from "./useSessionDraft";

interface FormDraftState {
  selectedIds: string[];
  otherTexts: Record<string, string>;
  classification: string;
}

export function useSurveyForm(schema: FormSchemaDefinition | null, isPreview: boolean = false) {
  const version = schema?.version || 1;
  const draftKey = isPreview ? `survey-draft:preview` : `survey-draft:v${version}`;

  const [draft, setDraft, clearDraft] = useSessionDraft<FormDraftState>(draftKey, {
    selectedIds: [],
    otherTexts: {},
    classification: "",
  });

  const selectedIds = new Set(draft.selectedIds);
  const otherTexts = draft.otherTexts;
  const classification = draft.classification;

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionResponse, setSubmissionResponse] = useState<SubmissionResponse | null>(null);

  // Helper: Collect all descendant IDs of a node recursively
  const getAllDescendantIds = useCallback((node: FormOption): string[] => {
    let ids: string[] = [];
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        ids.push(child.id);
        ids = ids.concat(getAllDescendantIds(child));
      }
    }
    return ids;
  }, []);

  // Handle Checkbox Toggle
  const handleToggle = useCallback(
    (node: FormOption, isChecked: boolean) => {
      setDraft((prev) => {
        const nextSet = new Set(prev.selectedIds);
        const nextOtherTexts = { ...prev.otherTexts };

        let autoClass = prev.classification;
        if (isChecked) {
          nextSet.add(node.id);
          const autoMap: Record<string, string> = {
            serous_benign: "benign",
            endometrioma_benign: "benign",
            seromucinous_benign: "benign",
            fibroma: "benign",
            cellular_fibroma: "benign",
            thecoma: "benign",
            mature_teratoma: "benign",
            serous_borderline: "borderline",
            seromucinous_borderline: "borderline",
            serous_carcinoma_low_grade: "malignant",
            serous_carcinoma_high_grade: "malignant",
            endometrioid_carcinoma: "malignant",
            immature_teratoma: "malignant",
            dysgerminoma: "malignant",
            yolk_sac_tumor: "malignant",
          };
          if (autoMap[node.id]) {
            autoClass = autoMap[node.id];
          } else if (node.id.includes("benign") || node.id.includes("lanh")) {
            autoClass = "benign";
          } else if (node.id.includes("borderline") || node.id.includes("giap_bien")) {
            autoClass = "borderline";
          } else if (node.id.includes("carcinoma") || node.id.includes("malignant") || node.id.includes("ac")) {
            autoClass = "malignant";
          }
        } else {
          // Unchecking parent: clear parent AND ALL recursive descendants!
          const idsToRemove = [node.id, ...getAllDescendantIds(node)];
          for (const id of idsToRemove) {
            nextSet.delete(id);
            delete nextOtherTexts[id];
          }
        }

        return {
          ...prev,
          selectedIds: Array.from(nextSet),
          classification: autoClass,
          otherTexts: nextOtherTexts,
        };
      });

      // Clear pathology error on interaction
      setErrors((prev) => {
        if (prev.pathology) {
          const next = { ...prev };
          delete next.pathology;
          return next;
        }
        return prev;
      });
    },
    [getAllDescendantIds, setDraft]
  );

  // Handle "Khác" text change
  const handleOtherTextChange = useCallback(
    (nodeId: string, text: string) => {
      setDraft((prev) => ({
        ...prev,
        otherTexts: {
          ...prev.otherTexts,
          [nodeId]: text,
        },
      }));
    },
    [setDraft]
  );

  // Handle Classification Radio change
  const handleClassificationChange = useCallback(
    (value: string) => {
      setDraft((prev) => ({
        ...prev,
        classification: value,
      }));

      // Clear classification error on interaction
      setErrors((prev) => {
        if (prev.classification) {
          const next = { ...prev };
          delete next.classification;
          return next;
        }
        return prev;
      });
    },
    [setDraft]
  );

  // Build recursive selected tree matching server schema
  const buildSelectedTree = useCallback(
    (options: FormOption[]): SelectedOptionNode[] => {
      const result: SelectedOptionNode[] = [];

      for (const opt of options) {
        if (selectedIds.has(opt.id)) {
          const node: SelectedOptionNode = { id: opt.id };

          if (opt.has_other_text && otherTexts[opt.id]) {
            node.other_text = otherTexts[opt.id];
          }

          if (opt.children && opt.children.length > 0) {
            const childNodes = buildSelectedTree(opt.children);
            if (childNodes.length > 0) {
              node.children = childNodes;
            }
          }

          result.push(node);
        }
      }

      return result;
    },
    [selectedIds, otherTexts]
  );

  // Validate form client-side
  const validateForm = useCallback((): boolean => {
    if (!schema) return false;
    const newErrors: Record<string, string> = {};

    const pathField = schema.fields.find((f) => f.id === "pathology");
    if (pathField && pathField.required && selectedIds.size === 0) {
      newErrors.pathology = pathField.error_message || "Vui lòng chọn ít nhất một kết quả giải phẫu bệnh.";
    }

    const classField = schema.fields.find((f) => f.id === "classification");
    if (classField && classField.required && !classification) {
      newErrors.classification = classField.error_message || "Đây là câu hỏi bắt buộc.";
    }

    // Check if any selected node requires "Khác" text but is empty
    for (const id of selectedIds) {
      // Find if this node has has_other_text
      const findNode = (opts: FormOption[]): FormOption | null => {
        for (const o of opts) {
          if (o.id === id) return o;
          if (o.children) {
            const found = findNode(o.children);
            if (found) return found;
          }
        }
        return null;
      };

      const node = findNode(pathField?.options || []);
      if (node && node.has_other_text && (!otherTexts[id] || !otherTexts[id].trim())) {
        newErrors.pathology = "Vui lòng điền thông tin chi tiết vào mục 'Khác'.";
        break;
      }
    }

    setErrors(newErrors);

    // If there are errors, scroll to the first invalid card
    if (Object.keys(newErrors).length > 0) {
      const firstFieldId = Object.keys(newErrors)[0];
      const element = document.getElementById(`card-${firstFieldId}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return false;
    }

    return true;
  }, [schema, selectedIds, classification, otherTexts]);

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schema || isSubmitting) return;

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      if (isPreview) {
        clearDraft();
        setSubmissionResponse({
          submission_uuid: "PREVIEW-" + crypto.randomUUID().slice(0, 8),
          reference_code: "PREVIEW-TEST",
          form_version: schema.version,
          status: "success",
          created_at: new Date().toISOString(),
          message: "Biểu mẫu xem trước hợp lệ.",
        });
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      const pathField = schema.fields.find((f) => f.id === "pathology");
      const tree = buildSelectedTree(pathField?.options || []);

      const payload: SubmissionPayload = {
        submission_uuid: crypto.randomUUID(),
        form_version: schema.version,
        answers: {
          pathology: {
            selected: tree,
          },
          classification,
        },
      };

      const res = await submitSurveyAnswers(payload);
      clearDraft();
      if (!isPreview) {
        sessionStorage.setItem("survey_submitted", "true");
        sessionStorage.setItem("survey_submission_uuid", res.submission_uuid);
        sessionStorage.setItem("survey_reference_code", res.reference_code);
        sessionStorage.setItem("survey_form_version", String(res.form_version));
        window.history.pushState(null, "", "/success");
      }
      setSubmissionResponse(res);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: any) {
      setErrors((prev) => ({
        ...prev,
        submit: err.message || "Đã xảy ra lỗi khi gửi phiếu. Vui lòng thử lại.",
      }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRestart = () => {
    clearDraft();
    sessionStorage.removeItem("survey_submitted");
    sessionStorage.removeItem("survey_submission_uuid");
    sessionStorage.removeItem("survey_reference_code");
    sessionStorage.removeItem("survey_form_version");
    if (window.location.pathname === "/success") {
      window.history.pushState(null, "", "/");
    }
    setSubmissionResponse(null);
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return {
    selectedIds,
    otherTexts,
    classification,
    errors,
    isSubmitting,
    submissionResponse,
    handleToggle,
    handleOtherTextChange,
    handleClassificationChange,
    handleSubmit,
    handleRestart,
    clearDraft,
  };
}
