export const BIOMARKER_KEYS = ["ca_125", "he4", "roma", "afp", "beta_hcg"] as const;
export interface BiomarkerDefinition {
  unit_field: string;
  other_unit_field: string;
}
export type BiomarkerDefinitions = Record<string, BiomarkerDefinition>;

export const unitMetadataKey = (key: string) =>
  BIOMARKER_KEYS.some(marker => key === `${marker}_unit` || key === `${marker}_unit_other`);

export const biomarkerWithUnit = (key: string) =>
  BIOMARKER_KEYS.find(marker => key === `${marker}_unit`);
