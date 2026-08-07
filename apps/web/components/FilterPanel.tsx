"use client";

export interface AqiRange {
  min: number;
  max: number;
}

export const DEFAULT_RANGE: AqiRange = { min: 0, max: 500 };

interface FilterPanelProps {
  open: boolean;
  range: AqiRange;
  onChange: (range: AqiRange) => void;
  onClose: () => void;
}

export function FilterPanel({
  open,
  range,
  onChange,
  onClose,
}: FilterPanelProps) {
  if (!open) return null;

  return (
    <div className="absolute left-4 top-20 z-30 w-80 rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">Filter by AQI</h3>
        <button
          onClick={onClose}
          aria-label="Close filter"
          className="text-xl leading-none text-gray-400 hover:text-gray-700"
        >
          ×
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <div className="mb-1 flex justify-between text-xs text-gray-500">
            <span>Min AQI: {range.min}</span>
            <span>Max AQI: {range.max}</span>
          </div>
          <div className="space-y-2">
            <input
              type="range"
              min={0}
              max={500}
              step={1}
              value={range.min}
              onChange={(e) =>
                onChange({
                  ...range,
                  min: Math.min(Number(e.target.value), range.max),
                })
              }
              className="w-full accent-blue-600"
              aria-label="Minimum AQI"
            />
            <input
              type="range"
              min={0}
              max={500}
              step={1}
              value={range.max}
              onChange={(e) =>
                onChange({
                  ...range,
                  max: Math.max(Number(e.target.value), range.min),
                })
              }
              className="w-full accent-blue-600"
              aria-label="Maximum AQI"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onChange({ min: 0, max: 50 })}
            className="rounded-md bg-green-100 px-3 py-1.5 text-xs font-medium text-green-800 hover:bg-green-200"
          >
            Cleanest Air
          </button>
          <button
            onClick={() => onChange({ min: 151, max: 500 })}
            className="rounded-md bg-red-100 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-200"
          >
            Most Polluted
          </button>
          <button
            onClick={() => onChange(DEFAULT_RANGE)}
            className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
