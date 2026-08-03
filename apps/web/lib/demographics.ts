import type { DemographicsData } from "./types";

export const DEMO_BINS = [
  "#2563EB",
  "#93C5FD",
  "#D1D5DB",
  "#FCA5A5",
  "#DC2626",
] as const;

export function getBin(value: number, min: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (max === min) return 2;
  const ratio = (value - min) / (max - min);
  if (ratio < 0.2) return 0;
  if (ratio < 0.4) return 1;
  if (ratio < 0.6) return 2;
  if (ratio < 0.8) return 3;
  return 4;
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
  median_hh_income: "Median Income",
  median_age: "Median Age",
  poverty_rate_pct: "Poverty Rate",
  ed_less_than_hs_pct: "< HS Diploma",
  unemployment_rate_pct: "Unemployment",
  limited_english_pct: "Limited English",
  housing_cost_burden_pct: "Cost Burdened",
  pop_density_per_sq_mi: "Pop. Density",
  pop_growth_pct: "Pop. Growth",
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
