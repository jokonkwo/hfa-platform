import type { DemographicsData } from "./types";

// 7-bin palette interpolated from Reventure's confirmed 5-bin legend colors:
//   bin0=rgb(0,0,255), bin1=rgb(147,151,250), bin2=rgb(255,222,215),
//   bin3=rgb(255,129,116), bin4=rgb(255,0,0)
// Linear interpolation at 0, 1/6, 2/6, 3/6, 4/6, 5/6, 1 across the 5-stop gradient.
// Fill-opacity is set in MapView.tsx (0.65 active, 0.80 hover) — calibrated to
// match Reventure's measured ~0.63 opacity from inland blue-county pixel samples.
export const DEMO_BINS = [
  "#0000FF",  // bin 0 lowest — pure blue
  "#6265FC",  // bin 1 — interpolated
  "#B7AFEE",  // bin 2 — interpolated
  "#FFDED7",  // bin 3 — neutral pink (Reventure legend exact)
  "#FFA095",  // bin 4 — interpolated
  "#FF564D",  // bin 5 — interpolated
  "#FF0000",  // bin 6 highest — pure red
] as const;

// Compute 6 quantile breakpoints that divide `allData` into 7 equal-count bins.
// Returns null when there is insufficient data to bin.
export function getQuantileBreakpoints(
  field: DemoNumericField,
  allData: DemographicsData[],
): number[] | null {
  const vals = allData
    .map((d) => d[field] as number | null)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  if (vals.length < 7) return null;
  const n = vals.length;
  // 6 thresholds at fractional positions 1/7 … 6/7 through the sorted array
  return [1, 2, 3, 4, 5, 6].map((i) => {
    const pos = (i / 7) * n;
    const lo = Math.floor(pos);
    const hi = Math.min(Math.ceil(pos), n - 1);
    return (vals[lo] + vals[hi]) / 2;
  });
}

// Assign a bin index (0–6) given pre-computed quantile breakpoints.
export function getBin(value: number, breakpoints: number[]): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  for (let i = 0; i < breakpoints.length; i++) {
    if (value < breakpoints[i]) return i as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  }
  return 6;
}

export function demoBinColor(value: number | null, breakpoints: number[] | null): string {
  if (value === null || !breakpoints) return "#E5E7EB";
  return DEMO_BINS[getBin(value, breakpoints)];
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
