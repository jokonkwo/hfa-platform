"use client";

import { useEffect } from "react";
import type { ZipNow, DemographicsData } from "@/lib/types";
import { categoryColor, categoryTextColor } from "@/lib/aqi";
import type { MapTier } from "@/components/TierControl";

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

function ZipTable({ rows }: { rows: ZipNow[] }) {
  const ranked = [...rows].sort((a, b) => a.aqi - b.aqi);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
          <th className="pb-2 pr-4 w-10">#</th>
          <th className="pb-2 pr-4">ZIP · Town</th>
          <th className="pb-2 pr-4 w-28">Population</th>
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
            <td className="py-2 pr-4 text-gray-700 tabular-nums">
              {row.population != null ? row.population.toLocaleString() : "—"}
            </td>
            <td className="py-2">
              <AqiBadge aqi={row.aqi} category={row.category} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface CountyRow {
  name: string;
  aqi: number | null;
  category: string | null;
  population: number | null;
}

function CountyTable({ fresnoAvgAqi, countyDemographics }: { fresnoAvgAqi: number | null; countyDemographics: DemographicsData[] }) {
  const fresnoCategory = fresnoAvgAqi != null
    ? (fresnoAvgAqi <= 50 ? "Good" : fresnoAvgAqi <= 100 ? "Moderate" : fresnoAvgAqi <= 150 ? "Unhealthy for Sensitive Groups" : fresnoAvgAqi <= 200 ? "Unhealthy" : fresnoAvgAqi <= 300 ? "Very Unhealthy" : "Hazardous")
    : null;

  const popByGeoid = Object.fromEntries(countyDemographics.map((d) => [d.geoid, d.population]));

  const rows: CountyRow[] = [
    { name: "Fresno County", aqi: fresnoAvgAqi, category: fresnoCategory, population: popByGeoid["06019"] ?? null },
  ];

  const otherCounties = [
    { name: "Alameda", geoid: "06001" }, { name: "Alpine", geoid: "06003" }, { name: "Amador", geoid: "06005" },
    { name: "Butte", geoid: "06007" }, { name: "Calaveras", geoid: "06009" }, { name: "Colusa", geoid: "06011" },
    { name: "Contra Costa", geoid: "06013" }, { name: "Del Norte", geoid: "06015" }, { name: "El Dorado", geoid: "06017" },
    { name: "Glenn", geoid: "06021" }, { name: "Humboldt", geoid: "06023" }, { name: "Imperial", geoid: "06025" },
    { name: "Inyo", geoid: "06027" }, { name: "Kern", geoid: "06029" }, { name: "Kings", geoid: "06031" },
    { name: "Lake", geoid: "06033" }, { name: "Lassen", geoid: "06035" }, { name: "Los Angeles", geoid: "06037" },
    { name: "Madera", geoid: "06039" }, { name: "Marin", geoid: "06041" }, { name: "Mariposa", geoid: "06043" },
    { name: "Mendocino", geoid: "06045" }, { name: "Merced", geoid: "06047" }, { name: "Modoc", geoid: "06049" },
    { name: "Mono", geoid: "06051" }, { name: "Monterey", geoid: "06053" }, { name: "Napa", geoid: "06055" },
    { name: "Nevada", geoid: "06057" }, { name: "Orange", geoid: "06059" }, { name: "Placer", geoid: "06061" },
    { name: "Plumas", geoid: "06063" }, { name: "Riverside", geoid: "06065" }, { name: "Sacramento", geoid: "06067" },
    { name: "San Benito", geoid: "06069" }, { name: "San Bernardino", geoid: "06071" }, { name: "San Diego", geoid: "06073" },
    { name: "San Francisco", geoid: "06075" }, { name: "San Joaquin", geoid: "06077" }, { name: "San Luis Obispo", geoid: "06079" },
    { name: "San Mateo", geoid: "06081" }, { name: "Santa Barbara", geoid: "06083" }, { name: "Santa Clara", geoid: "06085" },
    { name: "Santa Cruz", geoid: "06087" }, { name: "Shasta", geoid: "06089" }, { name: "Sierra", geoid: "06091" },
    { name: "Siskiyou", geoid: "06093" }, { name: "Solano", geoid: "06095" }, { name: "Sonoma", geoid: "06097" },
    { name: "Stanislaus", geoid: "06099" }, { name: "Sutter", geoid: "06101" }, { name: "Tehama", geoid: "06103" },
    { name: "Trinity", geoid: "06105" }, { name: "Tulare", geoid: "06107" }, { name: "Tuolumne", geoid: "06109" },
    { name: "Ventura", geoid: "06111" }, { name: "Yolo", geoid: "06113" }, { name: "Yuba", geoid: "06115" },
  ];
  for (const { name, geoid } of otherCounties) {
    rows.push({ name: `${name} County`, aqi: null, category: null, population: popByGeoid[geoid] ?? null });
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
          <th className="pb-2 pr-4 w-10">#</th>
          <th className="pb-2 pr-4">County</th>
          <th className="pb-2 pr-4 w-28">Population</th>
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
            <td className="py-2 pr-4 text-gray-700 tabular-nums">
              {row.population != null ? row.population.toLocaleString() : "—"}
            </td>
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

function StateTable({ fresnoAvgAqi, stateDemographic }: { fresnoAvgAqi: number | null; stateDemographic: DemographicsData | null }) {
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
            <th className="pb-2 pr-4 w-28">Population</th>
            <th className="pb-2">AQI</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          <tr className="hover:bg-gray-50">
            <td className="py-2 pr-4 tabular-nums text-gray-400">{fresnoAvgAqi != null ? 1 : "—"}</td>
            <td className="py-2 pr-4 font-medium text-gray-900">California</td>
            <td className="py-2 pr-4 text-gray-700 tabular-nums">
              {stateDemographic?.population != null ? stateDemographic.population.toLocaleString() : "—"}
            </td>
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

interface TableViewModalProps {
  open: boolean;
  tier: MapTier;
  rows: ZipNow[];
  fresnoAvgAqi: number | null;
  countyDemographics: DemographicsData[];
  stateDemographic: DemographicsData | null;
  onClose: () => void;
}

export function TableViewModal({ open, tier, rows, fresnoAvgAqi, countyDemographics, stateDemographic, onClose }: TableViewModalProps) {
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

        <div className="overflow-y-auto px-6 py-4">
          {tier === "zip" && <ZipTable rows={rows} />}
          {tier === "county" && <CountyTable fresnoAvgAqi={fresnoAvgAqi} countyDemographics={countyDemographics} />}
          {tier === "state" && <StateTable fresnoAvgAqi={fresnoAvgAqi} stateDemographic={stateDemographic} />}
        </div>

        <div className="border-t border-gray-100 px-6 py-3">
          <p className="text-[11px] text-gray-400">
            Population from ACS 2024 5-Year estimates.
          </p>
        </div>
      </div>
    </div>
  );
}
