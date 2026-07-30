"use client";

export type MapTier = "county" | "zip";

interface TierControlProps {
  tier: MapTier;
  onChange: (tier: MapTier) => void;
}

export function TierControl({ tier, onChange }: TierControlProps) {
  return (
    <div className="flex items-center rounded-full border border-gray-200 bg-white shadow-md overflow-hidden text-xs font-semibold">
      <button
        onClick={() => onChange("county")}
        className={`px-3 py-1.5 transition-colors ${
          tier === "county"
            ? "bg-gray-900 text-white"
            : "text-gray-600 hover:bg-gray-50"
        }`}
      >
        County
      </button>
      <button
        onClick={() => onChange("zip")}
        className={`px-3 py-1.5 transition-colors border-l border-gray-200 ${
          tier === "zip"
            ? "bg-gray-900 text-white"
            : "text-gray-600 hover:bg-gray-50"
        }`}
      >
        ZIP
      </button>
    </div>
  );
}
