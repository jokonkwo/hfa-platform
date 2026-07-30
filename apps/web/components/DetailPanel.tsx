"use client";

import type { ZipNow } from "@/lib/types";
import { CategoryBadge } from "./CategoryBadge";

function formatLocal(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function QcIndicator({ badge }: { badge: string }) {
  const map: Record<string, { color: string; label: string }> = {
    ok: { color: "bg-green-500", label: "Good quality" },
    good: { color: "bg-green-500", label: "Good quality" },
    verified: { color: "bg-green-500", label: "Verified" },
    warning: { color: "bg-amber-500", label: "Warning" },
    warn: { color: "bg-amber-500", label: "Warning" },
    poor: { color: "bg-red-400", label: "Poor quality" },
    stale: { color: "bg-gray-400", label: "Stale" },
    error: { color: "bg-red-500", label: "Error" },
  };
  const cfg = map[(badge ?? "").toLowerCase()] ?? {
    color: "bg-gray-400",
    label: badge || "Unknown",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
      <span className={`h-2.5 w-2.5 rounded-full ${cfg.color}`} />
      {cfg.label}
    </span>
  );
}

function CigaretteCard({ zip, pm25 }: { zip: string; pm25: number }) {
  if (!(pm25 > 0)) return null;

  const cigs = pm25 / 22;
  // 30 cigs ≈ 660 µg/m³ — treat as full burn for the visual
  const fillPct = Math.min(cigs / 30, 1);

  const cigStr =
    cigs < 0.1
      ? "< 0.1"
      : cigs < 10
        ? cigs.toFixed(1)
        : Math.round(cigs).toString();
  const cigWord = Math.abs(cigs - 1) < 0.05 ? "cigarette" : "cigarettes";

  // SVG layout
  const W = 200, H = 20;
  const EMBER_X = 6;
  const BODY_X = 10, BODY_W = 164;
  const FILTER_X = 174, FILTER_W = 26;
  const burnW = Math.round(fillPct * BODY_W);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="mb-3">
        <span className="text-4xl font-bold text-gray-900">≈ {cigStr}</span>
        <span className="ml-2 text-sm font-medium text-amber-700">
          cigarettes/day
        </span>
      </div>

      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Cigarette severity fill: ${Math.round(fillPct * 100)}%`}
        className="mb-3"
      >
        <defs>
          <linearGradient id="hfa-cig-burn" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#F97316" />
            <stop offset="70%" stopColor="#FCD34D" />
            <stop offset="100%" stopColor="#E5C840" />
          </linearGradient>
        </defs>
        {/* Cigarette body (cream) */}
        <rect
          x={BODY_X}
          y={4}
          width={BODY_W}
          height={H - 8}
          rx={2}
          fill="#F5F1E8"
          stroke="#D6D3D1"
          strokeWidth={0.5}
        />
        {/* Burn fill from the lit (left) end */}
        {burnW > 0 && (
          <rect
            x={BODY_X}
            y={4}
            width={burnW}
            height={H - 8}
            rx={2}
            fill="url(#hfa-cig-burn)"
          />
        )}
        {/* Filter (tan) on right end */}
        <rect
          x={FILTER_X}
          y={3}
          width={FILTER_W}
          height={H - 6}
          rx={2}
          fill="#D4A574"
          stroke="#C09060"
          strokeWidth={0.5}
        />
        {/* Ember at lit (left) end — glows brighter with severity */}
        <circle
          cx={EMBER_X}
          cy={H / 2}
          r={6}
          fill="#FF6B35"
          opacity={0.12 + fillPct * 0.25}
        />
        <circle
          cx={EMBER_X}
          cy={H / 2}
          r={3}
          fill="#FF8C42"
          opacity={0.55 + fillPct * 0.35}
        />
        <circle cx={EMBER_X} cy={H / 2} r={1.5} fill="#FBBF24" opacity={0.9} />
      </svg>

      <p className="text-xs leading-relaxed text-gray-600">
        {`Air in ${zip} today carries about the same long-term health risk as smoking ${cigStr} ${cigWord} — based on Berkeley Earth's PM2.5 research. This reflects long-term exposure risk, not how today will feel.`}
      </p>
    </div>
  );
}

interface DetailPanelProps {
  zip: ZipNow | null;
  onClose: () => void;
}

export function DetailPanel({ zip, onClose }: DetailPanelProps) {
  const open = zip !== null;
  return (
    <aside
      className={`fixed right-0 top-14 z-30 h-[calc(100vh-3.5rem)] w-full max-w-sm transform border-l border-gray-200 bg-white shadow-2xl transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
      aria-hidden={!open}
    >
      {zip && (
        <div className="flex h-full flex-col overflow-y-auto">
          <div className="flex items-start justify-between border-b border-gray-200 p-5">
            <div>
              <h2 className="text-3xl font-bold text-gray-900">{zip.zip}</h2>
              <p className="text-sm text-gray-500">{zip.town}</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close details"
              className="rounded-md p-1 text-2xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              ×
            </button>
          </div>

          <div className="space-y-5 p-5">
            <div>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-bold text-gray-900">
                  {zip.aqi}
                </span>
                <span className="text-sm text-gray-500">AQI</span>
              </div>
              <div className="mt-2">
                <CategoryBadge category={zip.category} className="text-sm px-3 py-1" />
              </div>
            </div>

            <CigaretteCard zip={zip.zip} pm25={zip.pm25} />

            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-gray-500">PM2.5</dt>
                <dd className="font-medium text-gray-900">
                  {zip.pm25.toFixed(1)} µg/m³
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Sensors</dt>
                <dd className="font-medium text-gray-900">{zip.sample_size}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Freshness</dt>
                <dd className="font-medium text-gray-900">
                  {zip.freshness_pct.toFixed(0)}%
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Quality</dt>
                <dd>
                  <QcIndicator badge={zip.qc_badge} />
                </dd>
              </div>
            </dl>

            <div className="text-sm">
              <span className="text-gray-500">Updated: </span>
              <span className="font-medium text-gray-900">
                {formatLocal(zip.updated_ts)}
              </span>
            </div>

            <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
              PurpleAir sensors · EPA/Barkjohn corrected
            </p>

            <div className="rounded-lg border border-dashed border-gray-300 p-5 text-center">
              <p className="text-sm font-medium text-gray-500">
                Not enough historical data yet
              </p>
              <p className="mt-1 text-xs text-gray-400">
                A trend chart will appear here once air quality readings
                accumulate over multiple days. Check back as more data comes in.
              </p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
