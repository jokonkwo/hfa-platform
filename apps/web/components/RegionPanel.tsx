"use client";

const CA_GEOID = "06";
const FRESNO_COUNTY_GEOID = "06019";

export interface SelectedRegion {
  type: "state" | "county";
  geoid: string;
  name: string;
}

interface RegionPanelProps {
  region: SelectedRegion | null;
  fresnoAvgAqi: number | null;
  onClose: () => void;
}

export function RegionPanel({ region, fresnoAvgAqi, onClose }: RegionPanelProps) {
  if (!region) return null;

  const hasData =
    (region.type === "state" && region.geoid === CA_GEOID) ||
    (region.type === "county" && region.geoid === FRESNO_COUNTY_GEOID);

  const typeLabel = region.type === "state" ? "State" : "County";

  return (
    <div
      data-region-panel
      className="absolute bottom-6 left-6 z-20 w-64 rounded-lg border border-gray-200 bg-white shadow-lg"
    >
      <div className="flex items-start justify-between p-4 pb-3">
        <div className="min-w-0 flex-1">
          <span className="mb-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
            {typeLabel}
          </span>
          <p className="truncate text-base font-bold text-gray-900">{region.name}</p>
        </div>
        <button
          onClick={onClose}
          className="ml-2 flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="border-t border-gray-100 px-4 py-3">
        {hasData ? (
          fresnoAvgAqi !== null ? (
            <div>
              <p className="text-2xl font-bold text-gray-900">AQI {fresnoAvgAqi}</p>
              <p className="mt-0.5 text-xs text-gray-500">Avg across Fresno pilot ZIPs</p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Loading air quality data…</p>
          )
        ) : (
          <div>
            <p className="text-sm font-medium text-gray-700">No sensor data yet</p>
            <p className="mt-1 text-xs text-gray-500">
              Fresno County is the current pilot area. Coverage will expand as the program grows.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
