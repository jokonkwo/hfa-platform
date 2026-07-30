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

// Convert corrected PM2.5 (µg/m³) to US EPA AQI integer.
export function pm25ToAqi(pm25: number): number {
  if (pm25 <= 12.0)  return Math.round((50 / 12) * pm25);
  if (pm25 <= 35.4)  return Math.round(((100-51)/(35.4-12.1))*(pm25-12.1)+51);
  if (pm25 <= 55.4)  return Math.round(((150-101)/(55.4-35.5))*(pm25-35.5)+101);
  if (pm25 <= 150.4) return Math.round(((200-151)/(150.4-55.5))*(pm25-55.5)+151);
  if (pm25 <= 250.4) return Math.round(((300-201)/(250.4-150.5))*(pm25-150.5)+201);
  if (pm25 <= 350.4) return Math.round(((400-301)/(350.4-250.5))*(pm25-250.5)+301);
  if (pm25 <= 500.4) return Math.round(((500-401)/(500.4-350.5))*(pm25-350.5)+401);
  return 500;
}

// Map an AQI integer to a category name.
export function aqiToCategory(aqi: number): string {
  if (aqi <= 50)  return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

// Text color that reads well on top of the given category swatch.
// Hazardous (#8B4B5C) is dark enough to need white; all other pastels use dark text.
export function categoryTextColor(category: string | null | undefined): string {
  const c = categoryColor(category);
  return c === "#8B4B5C" ? "#ffffff" : "#1a1a1a";
}
