import type { ClinicalField } from "../types/schema";

export const matchesFieldCondition = (
  field: ClinicalField,
  data: Record<string, unknown>,
): boolean => {
  if (!field.show_when) return true;
  const value = data[field.show_when];
  const values = Array.isArray(value) ? value : [value];
  return values.some((item) => field.show_values.includes(String(item ?? "")));
};
