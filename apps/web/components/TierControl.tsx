"use client";

export type MapTier = "state" | "county" | "zip";

interface TierControlProps {
  tier: MapTier;
  onChange: (tier: MapTier) => void;
}

const TIERS: { id: MapTier; label: string }[] = [
  { id: "state", label: "State" },
  { id: "county", label: "County" },
  { id: "zip", label: "ZIP" },
];

export function TierControl({ tier, onChange }: TierControlProps) {
  return (
    <div className="flex items-center overflow-hidden rounded-full border border-gray-300 bg-white text-sm font-semibold">
      {TIERS.map(({ id, label }, i) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          aria-pressed={tier === id}
          className={`px-4 py-1.5 transition-colors ${i > 0 ? "border-l border-gray-300" : ""} ${
            tier === id
              ? "bg-gray-900 text-white"
              : "text-gray-600 hover:bg-gray-50"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
