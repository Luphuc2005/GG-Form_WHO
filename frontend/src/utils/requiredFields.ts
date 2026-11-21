import type { FormSchemaDefinition } from "../types/schema";
import type { RecordAnswers } from "../api/workflow";
import { matchesFieldCondition } from "./fieldConditions";

export interface RequiredFieldIssue { id: string; section: string; label: string }
export const hasRequiredValue = (value: unknown): boolean =>
  Array.isArray(value) ? value.some(hasRequiredValue)
    : typeof value === "string" ? value.trim().length > 0
    : value !== undefined && value !== null;

export function missingRequiredFields(schema: FormSchemaDefinition, answers: RecordAnswers, identityVersion: number): RequiredFieldIssue[] {
  const data = answers.clinical_data;
  const managed = schema.clinical_fields != null;
  const issues: RequiredFieldIssue[] = [];
  const add = (id: string, section: string, label: string, value: unknown) => {
    if (!hasRequiredValue(value) && !issues.some(issue => issue.id === id)) issues.push({id, section, label});
  };
  const identitySection = managed ? "identity" : "meta";
  add(managed ? "managed-hospital_code" : "study-hospital", identitySection, "Bệnh viện", data.hospital_code);
  if (identityVersion >= 2 || hasRequiredValue(data.study_phase)) {
    add(managed ? "managed-study_phase" : "study-phase", identitySection, "Giai đoạn nghiên cứu", data.study_phase);
  } else {
    add(managed ? "managed-encounter_code" : "entry-encounter_code", identitySection, "Mã đợt điều trị", data.encounter_code);
  }
  if (managed) {
    const sections = ["sec1", "sec2", "sec3", "sec4", "sec5", "sec6", "extra"];
    const fields = [...(schema.clinical_fields || [])].sort((a, b) => sections.indexOf(a.section)-sections.indexOf(b.section));
    for (const field of fields) {
      if (field.active && (field.required || field.id === "so_hs") && matchesFieldCondition(field, data)) {
        add(`managed-${field.id}`, field.section, field.label, data[field.id]);
      }
    }
  } else add("entry-so_hs", "sec1", "Số HS", data.so_hs);
  const pathology = schema.fields.find(field => field.id === "pathology");
  const values = answers.pathology.selected;
  const primary = values.find((value, index) => (value.slot || index+1) === 1);
  const whoSection = managed ? "who" : "sec7";
  if (pathology?.required !== false) add("who-result-1", whoSection, "Kết quả giải phẫu bệnh WHO 1", primary?.id);
  for (const slot of [1, 2]) {
    const value = values.find((item, index) => (item.slot || index+1) === slot);
    if (pathology?.options.find(option => option.id === value?.id)?.has_other_text) {
      add(`who-other-${slot}`, whoSection, `Kết quả khác WHO ${slot}`, value?.other_text || (slot === 1 ? answers.pathology.other_text : ""));
    }
  }
  return issues;
}
