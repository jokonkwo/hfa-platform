"use client";

interface AboutPanelProps {
  open: boolean;
  onClose: () => void;
}

export function AboutPanel({ open, onClose }: AboutPanelProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            About Healthy Fresno Air
          </h2>
          <button
            onClick={onClose}
            aria-label="Close about"
            className="text-2xl leading-none text-gray-400 hover:text-gray-700"
          >
            ×
          </button>
        </div>

        <div className="space-y-4 text-sm leading-relaxed text-gray-700">
          <p>
            South Central Fresno is designated by California&apos;s AB 617
            program as a community overburdened by air pollution. On
            CalEnviroScreen — the state&apos;s cumulative pollution-burden index
            — Fresno ranks in the 99th percentile statewide, combining high
            pollution exposure with social vulnerability factors including
            poverty, asthma rates, and limited educational access. A ~10-year
            life expectancy gap exists between north and south Fresno, linked in
            part to chronic air quality disparities.
          </p>
          <p>
            <span className="font-semibold text-gray-900">
              What HFA adds:
            </span>{" "}
            Real-time, ZIP-level PM2.5 readings — updated every 10 minutes —
            versus CalEnviroScreen&apos;s static, infrequently-updated
            tract-level scores.
          </p>
          <p>
            <span className="font-semibold text-gray-900">Data source:</span>{" "}
            PurpleAir community sensors, corrected using the EPA/Barkjohn formula
            (Barkjohn et al., 2021) — the same correction used on AirNow&apos;s
            Fire and Smoke Map.
          </p>
          <p>
            <span className="font-semibold text-gray-900">Coverage:</span>{" "}
            Fresno County, California. v1 POC, Oct 2025.
          </p>
        </div>
      </div>
    </div>
  );
}
