"use client";

export type MapTier = "county" | "zip";

interface TierControlProps {
  tier: MapTier;
  onChange: (tier: MapTier) => void;
}

export function TierControl({ tier, onChange }: TierControlProps) {
  return (
    <div className="flex items-center overflow-hidden rounded-full border border-gray-300 bg-white text-sm font-semibold">
      <button
        onClick={() => onChange("county")}
        aria-pressed={tier === "county"}
        className={`px-4 py-1.5 transition-colors ${
          tier === "county"
            ? "bg-gray-900 text-white"
            : "text-gray-600 hover:bg-gray-50"
        }`}
      >
        County
      </button>
      <button
        onClick={() => onChange("zip")}
        aria-pressed={tier === "zip"}
        className={`border-l border-gray-300 px-4 py-1.5 transition-colors ${
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
