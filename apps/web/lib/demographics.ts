import type { DemographicsData } from "./types";

export const DEMO_BINS = [
  "#1D4ED8",
  "#3B82F6",
  "#93C5FD",
  "#E5E7EB",
  "#FCA5A5",
  "#EF4444",
  "#B91C1C",
] as const;

export function getBin(value: number, min: number, max: number): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  if (max === min) return 3;
  const ratio = (value - min) / (max - min);
  if (ratio < 1 / 7) return 0;
  if (ratio < 2 / 7) return 1;
  if (ratio < 3 / 7) return 2;
  if (ratio < 4 / 7) return 3;
  if (ratio < 5 / 7) return 4;
  if (ratio < 6 / 7) return 5;
  return 6;
}

export function demoBinColor(value: number | null, min: number, max: number): string {
  if (value === null) return "#E5E7EB";
  return DEMO_BINS[getBin(value, min, max)];
}

export function formatDemoValue(field: keyof DemographicsData, value: number | null): string {
  if (value === null) return "N/A";
  switch (field) {
    case "population": return value.toLocaleString();
    case "median_hh_income": return `$${Math.round(value).toLocaleString()}`;
    case "median_age": return `${value.toFixed(1)} yrs`;
    case "pop_density_per_sq_mi": return `${Math.round(value).toLocaleString()}/mi²`;
    case "pop_growth_pct":
    case "income_growth_pct":
      return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
    default: return `${value.toFixed(1)}%`;
  }
}

export const DEMO_FIELD_LABELS: Partial<Record<keyof DemographicsData, string>> = {
  population: "Population",
  median_hh_income: "Median Household Income",
  median_age: "Median Age",
  poverty_rate_pct: "Poverty Rate",
  ed_less_than_hs_pct: "Less Than HS Diploma",
  unemployment_rate_pct: "Unemployment Rate",
  limited_english_pct: "Limited English Proficiency",
  housing_cost_burden_pct: "Housing Cost Burden",
  pop_density_per_sq_mi: "Population Density",
  pop_growth_pct: "Population Growth",
  income_growth_pct: "Income Growth",
};

export const DEMO_NUMERIC_FIELDS = [
  "population",
  "median_hh_income",
  "median_age",
  "poverty_rate_pct",
  "ed_less_than_hs_pct",
  "unemployment_rate_pct",
  "limited_english_pct",
  "housing_cost_burden_pct",
  "pop_density_per_sq_mi",
  "pop_growth_pct",
  "income_growth_pct",
] as const satisfies ReadonlyArray<keyof DemographicsData>;

export type DemoNumericField = typeof DEMO_NUMERIC_FIELDS[number];

export function getFieldRange(
  field: DemoNumericField,
  allData: DemographicsData[],
): { min: number; max: number } | null {
  const vals = allData.map((d) => d[field] as number | null).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return { min: Math.min(...vals), max: Math.max(...vals) };
}
