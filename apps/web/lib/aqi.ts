// EPA AQI category colors. Keyed by the `category` string from the API.
export const AQI_CATEGORIES = [
  { name: "Good", range: "0–50", color: "#00e400" },
  { name: "Moderate", range: "51–100", color: "#ffff00" },
  {
    name: "Unhealthy for Sensitive Groups",
    range: "101–150",
    color: "#ff7e00",
  },
  { name: "Unhealthy", range: "151–200", color: "#ff0000" },
  { name: "Very Unhealthy", range: "201–300", color: "#8f3f97" },
  { name: "Hazardous", range: "301+", color: "#7e0023" },
] as const;

const CATEGORY_COLOR: Record<string, string> = AQI_CATEGORIES.reduce(
  (acc, c) => {
    acc[c.name.toLowerCase()] = c.color;
    return acc;
  },
  {} as Record<string, string>,
);

const DEFAULT_COLOR = "#00e400"; // green fallback for unrecognized category

// Map an API `category` string to its EPA color. Defaults to green.
export function categoryColor(category: string | null | undefined): string {
  if (!category) return DEFAULT_COLOR;
  return CATEGORY_COLOR[category.toLowerCase()] ?? DEFAULT_COLOR;
}

// Text color that reads well on top of the given category swatch.
export function categoryTextColor(category: string | null | undefined): string {
  const c = categoryColor(category);
  // Yellow / green / orange -> dark text; red / purple / maroon -> light text
  if (c === "#ffff00" || c === "#00e400" || c === "#ff7e00") return "#1a1a1a";
  return "#ffffff";
}
