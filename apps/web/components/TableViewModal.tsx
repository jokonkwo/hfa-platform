"use client";

import { useEffect } from "react";
import type { ZipNow } from "@/lib/types";
import { categoryColor, categoryTextColor } from "@/lib/aqi";
import type { MapTier } from "@/components/TierControl";

// ── AQI cell with inline category badge ──────────────────────────────────────

function AqiBadge({ aqi, category }: { aqi: number; category: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-semibold tabular-nums">{aqi}</span>
      <span
        className="rounded-full px-1.5 py-px text-[10px] font-semibold leading-tight"
        style={{ backgroundColor: categoryColor(category), color: categoryTextColor(category) }}
      >
        {category}
      </span>
    </span>
  );
}

// ── ZIP tier table ────────────────────────────────────────────────────────────

function ZipTable({ rows }: { rows: ZipNow[] }) {
  const ranked = [...rows].sort((a, b) => a.aqi - b.aqi);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
          <th className="pb-2 pr-4 w-10">#</th>
          <th className="pb-2 pr-4">ZIP · Town</th>
          <th className="pb-2 pr-4 w-24">Population</th>
          <th className="pb-2">AQI</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {ranked.map((row, i) => (
          <tr key={row.zip} className="hover:bg-gray-50">
            <td className="py-2 pr-4 tabular-nums text-gray-400">{i + 1}</td>
            <td className="py-2 pr-4 font-medium text-gray-900">
              {row.zip}
              <span className="ml-1.5 text-xs font-normal text-gray-500">{row.town}</span>
            </td>
            <td className="py-2 pr-4 text-gray-400">{row.population != null ? row.population.toLocaleString() : "—"}</td>
            <td className="py-2">
              <AqiBadge aqi={row.aqi} category={row.category} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── County tier table ─────────────────────────────────────────────────────────

interface CountyRow {
  name: string;
  aqi: number | null;
  category: string | null;
}

function CountyTable({ fresnoAvgAqi }: { fresnoAvgAqi: number | null }) {
  const fresnoCategory = fresnoAvgAqi != null
    ? (fresnoAvgAqi <= 50 ? "Good" : fresnoAvgAqi <= 100 ? "Moderate" : fresnoAvgAqi <= 150 ? "Unhealthy for Sensitive Groups" : fresnoAvgAqi <= 200 ? "Unhealthy" : fresnoAvgAqi <= 300 ? "Very Unhealthy" : "Hazardous")
    : null;

  const rows: CountyRow[] = [
    { name: "Fresno County", aqi: fresnoAvgAqi, category: fresnoCategory },
  ];

  // Remaining CA counties shown as N/A (no sensor data)
  const otherCounties = [
    "Alameda", "Alpine", "Amador", "Butte", "Calaveras", "Colusa", "Contra Costa",
    "Del Norte", "El Dorado", "Glenn", "Humboldt", "Imperial", "Inyo", "Kern",
    "Kings", "Lake", "Lassen", "Los Angeles", "Madera", "Marin", "Mariposa",
    "Mendocino", "Merced", "Modoc", "Mono", "Monterey", "Napa", "Nevada",
    "Orange", "Placer", "Plumas", "Riverside", "Sacramento", "San Benito",
    "San Bernardino", "San Diego", "San Francisco", "San Joaquin", "San Luis Obispo",
    "San Mateo", "Santa Barbara", "Santa Clara", "Santa Cruz", "Shasta", "Sierra",
    "Siskiyou", "Solano", "Sonoma", "Stanislaus", "Sutter", "Tehama", "Trinity",
    "Tulare", "Tuolumne", "Ventura", "Yolo", "Yuba",
  ];
  for (const name of otherCounties) {
    rows.push({ name: `${name} County`, aqi: null, category: null });
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
          <th className="pb-2 pr-4 w-10">#</th>
          <th className="pb-2 pr-4">County</th>
          <th className="pb-2 pr-4 w-24">Population</th>
          <th className="pb-2">AQI</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((row, i) => (
          <tr key={row.name} className="hover:bg-gray-50">
            <td className="py-2 pr-4 tabular-nums text-gray-400">
              {row.aqi != null ? i + 1 : "—"}
            </td>
            <td className="py-2 pr-4 font-medium text-gray-900">{row.name}</td>
            <td className="py-2 pr-4 text-gray-400">—</td>
            <td className="py-2">
              {row.aqi != null && row.category != null
                ? <AqiBadge aqi={row.aqi} category={row.category} />
                : <span className="text-gray-400">N/A</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── State tier table ──────────────────────────────────────────────────────────

function StateTable({ fresnoAvgAqi }: { fresnoAvgAqi: number | null }) {
  const caCategory = fresnoAvgAqi != null
    ? (fresnoAvgAqi <= 50 ? "Good" : fresnoAvgAqi <= 100 ? "Moderate" : fresnoAvgAqi <= 150 ? "Unhealthy for Sensitive Groups" : fresnoAvgAqi <= 200 ? "Unhealthy" : fresnoAvgAqi <= 300 ? "Very Unhealthy" : "Hazardous")
    : null;

  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <th className="pb-2 pr-4 w-10">#</th>
            <th className="pb-2 pr-4">State</th>
            <th className="pb-2 pr-4 w-24">Population</th>
            <th className="pb-2">AQI</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          <tr className="hover:bg-gray-50">
            <td className="py-2 pr-4 tabular-nums text-gray-400">{fresnoAvgAqi != null ? 1 : "—"}</td>
            <td className="py-2 pr-4 font-medium text-gray-900">California</td>
            <td className="py-2 pr-4 text-gray-400">—</td>
            <td className="py-2">
              {fresnoAvgAqi != null && caCategory != null
                ? <AqiBadge aqi={fresnoAvgAqi} category={caCategory} />
                : <span className="text-gray-400">N/A</span>}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-xs text-gray-400">
        Only California has sensor data in this program. Switch to County or ZIP tier to explore further.
      </p>
    </div>
  );
}

// ── Modal shell ───────────────────────────────────────────────────────────────

interface TableViewModalProps {
  open: boolean;
  tier: MapTier;
  rows: ZipNow[];
  fresnoAvgAqi: number | null;
  onClose: () => void;
}

export function TableViewModal({ open, tier, rows, fresnoAvgAqi, onClose }: TableViewModalProps) {
  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const title =
    tier === "zip" ? "ZIP Rankings — Fresno County"
    : tier === "county" ? "County Rankings — California"
    : "State Rankings";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-16 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-2xl rounded-xl bg-white shadow-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close table view"
          >
            ✕
          </button>
        </div>

        {/* Scrollable table body */}
        <div className="overflow-y-auto px-6 py-4">
          {tier === "zip" && <ZipTable rows={rows} />}
          {tier === "county" && <CountyTable fresnoAvgAqi={fresnoAvgAqi} />}
          {tier === "state" && <StateTable fresnoAvgAqi={fresnoAvgAqi} />}
        </div>

        {/* Footer note */}
        <div className="border-t border-gray-100 px-6 py-3">
          <p className="text-[11px] text-gray-400">
            Population data not yet available — Census ACS hookup planned for phase 2.
          </p>
        </div>
      </div>
    </div>
  );
}
