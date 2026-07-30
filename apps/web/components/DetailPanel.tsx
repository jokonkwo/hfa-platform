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
