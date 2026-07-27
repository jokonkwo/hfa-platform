// AQI category colors — pastel palette chosen for readability on Voyager basemap.
// Hazardous is intentionally less pastel than the others so severity still reads.
export const AQI_CATEGORIES = [
  { name: "Good", range: "0–50", color: "#8FE3A8" },
  { name: "Moderate", range: "51–100", color: "#FCE083" },
  {
    name: "Unhealthy for Sensitive Groups",
    range: "101–150",
    color: "#F5B375",
  },
  { name: "Unhealthy", range: "151–200", color: "#EF8C8C" },
  { name: "Very Unhealthy", range: "201–300", color: "#B994D1" },
  { name: "Hazardous", range: "301+", color: "#8B4B5C" },
] as const;

const CATEGORY_COLOR: Record<string, string> = AQI_CATEGORIES.reduce(
  (acc, c) => {
    acc[c.name.toLowerCase()] = c.color;
    return acc;
  },
  {} as Record<string, string>,
);

const DEFAULT_COLOR = "#8FE3A8"; // Good-green fallback for unrecognized category

// Map an API `category` string to its pastel color. Defaults to Good green.
export function categoryColor(category: string | null | undefined): string {
  if (!category) return DEFAULT_COLOR;
  return CATEGORY_COLOR[category.toLowerCase()] ?? DEFAULT_COLOR;
}

// Text color that reads well on top of the given category swatch.
// Hazardous (#8B4B5C) is dark enough to need white; all other pastels use dark text.
export function categoryTextColor(category: string | null | undefined): string {
  const c = categoryColor(category);
  return c === "#8B4B5C" ? "#ffffff" : "#1a1a1a";
}
