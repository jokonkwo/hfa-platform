"use client";

export type MapTier = "state" | "county" | "zip";

interface TierControlProps {
  tier: MapTier;
  onChange: (tier: MapTier) => void;
}

const TIERS: { id: MapTier; label: string }[] = [
  { id: "state", label: "State" },
  { id: "county", label: "County" },
  { id: "zip", label: "Zip" },
];

export function TierControl({ tier, onChange }: TierControlProps) {
  return (
    <div className="flex items-center gap-4" role="group" aria-label="Map tier">
      {TIERS.map(({ id, label }) => {
        const checked = tier === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            aria-pressed={checked}
            className="flex cursor-pointer items-center gap-1.5 focus:outline-none"
          >
            {/* Radio circle — aria-hidden so accessible name = label text only */}
            <span
              aria-hidden="true"
              className={`flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                checked
                  ? "border-red-500 bg-red-500"
                  : "border-gray-300 bg-white"
              }`}
            >
              {checked && (
                <span className="h-[5px] w-[5px] rounded-full bg-white" />
              )}
            </span>
            <span
              className={`text-sm ${
                checked
                  ? "font-semibold text-gray-900"
                  : "font-normal text-gray-600"
              }`}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
