"use client";

import { useEffect, useState, useMemo } from "react";
import type { ZipNow, DemographicsData } from "@/lib/types";
import { categoryColor, categoryTextColor } from "@/lib/aqi";
import type { MapTier } from "@/components/TierControl";
import type { MapBounds, CountyBoundaryCollection } from "@/components/MapView";
import {
  DEMO_FIELD_LABELS,
  formatDemoValue,
  type DemoNumericField,
} from "@/lib/demographics";

// ── Types ──────────────────────────────────────────────────────────────────

type Metric = "aqi" | DemoNumericField;

interface TableRow {
  geoid: string;
  name: string;
  city?: string;
  aqi: number | null;
  category: string | null;
  demo: Partial<DemographicsData>;
}

type SortKey = "name" | "city" | "aqi" | DemoNumericField;

interface ColDef {
  key: SortKey;
  label: string;
  renderCell: (row: TableRow) => React.ReactNode;
  align: "left" | "right";
  numeric: boolean;
}

// ── Column definitions ─────────────────────────────────────────────────────

function demoLabel(field: DemoNumericField): string {
  return DEMO_FIELD_LABELS[field] ?? field;
}

function demoCell(row: TableRow, field: DemoNumericField): React.ReactNode {
  const val = row.demo[field] as number | null | undefined;
  if (val == null) return <span className="text-gray-400">—</span>;
  return <span className="tabular-nums">{formatDemoValue(field, val)}</span>;
}

function aqiCell(row: TableRow): React.ReactNode {
  if (row.aqi == null || row.category == null) {
    return <span className="text-gray-400">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tabular-nums font-semibold">{row.aqi}</span>
      <span
        className="rounded-full px-1.5 py-px text-[10px] font-semibold leading-tight"
        style={{ backgroundColor: categoryColor(row.category), color: categoryTextColor(row.category) }}
      >
        {row.category}
      </span>
    </span>
  );
}

function buildColumns(tier: MapTier, metric: Metric): ColDef[] {
  const cols: ColDef[] = [];

  // Region name column(s)
  if (tier === "zip") {
    cols.push({
      key: "name",
      label: "ZIP",
      renderCell: (r) => <span className="font-mono font-medium">{r.name}</span>,
      align: "left",
      numeric: false,
    });
    cols.push({
      key: "city",
      label: "City",
      renderCell: (r) => <span className="text-gray-600">{r.city ?? "—"}</span>,
      align: "left",
      numeric: false,
    });
  } else if (tier === "county") {
    cols.push({
      key: "name",
      label: "County",
      renderCell: (r) => <span className="font-medium">{r.name}</span>,
      align: "left",
      numeric: false,
    });
  } else {
    cols.push({
      key: "name",
      label: "State",
      renderCell: (r) => <span className="font-medium">{r.name}</span>,
      align: "left",
      numeric: false,
    });
  }

  // Selected metric — always comes immediately after region column(s)
  if (metric === "aqi") {
    cols.push({
      key: "aqi",
      label: "PM2.5 AQI",
      renderCell: aqiCell,
      align: "right",
      numeric: true,
    });
  } else {
    cols.push({
      key: metric,
      label: demoLabel(metric),
      renderCell: (r) => demoCell(r, metric),
      align: "right",
      numeric: true,
    });
  }

  // Secondary column
  const secondary = getSecondary(metric);
  if (secondary) {
    cols.push({
      key: secondary,
      label: demoLabel(secondary),
      renderCell: (r) => demoCell(r, secondary),
      align: "right",
      numeric: true,
    });
  }

  // Trailing Population (unless Population is the selected or secondary metric)
  const skipPopulation =
    metric === "population" ||
    metric === "pop_density_per_sq_mi" ||
    secondary === "population";
  if (!skipPopulation) {
    cols.push({
      key: "population" as DemoNumericField,
      label: "Population",
      renderCell: (r) => demoCell(r, "population"),
      align: "right",
      numeric: true,
    });
  }

  return cols;
}

function getSecondary(metric: Metric): DemoNumericField | null {
  if (metric === "aqi") return null;
  if (metric === "population") return "median_hh_income";
  if (metric === "pop_density_per_sq_mi") return "median_hh_income";
  if (metric === "median_hh_income" || metric === "income_growth_pct") return "poverty_rate_pct";
  return "median_hh_income";
}

// ── Row builders ───────────────────────────────────────────────────────────

function buildZipRows(
  zctaDemographics: DemographicsData[],
  zipNow: ZipNow[],
  zipCities: Record<string, string>,
): TableRow[] {
  const aqiByZip = new Map(zipNow.map((r) => [r.zip, { aqi: r.aqi, category: r.category }]));
  return zctaDemographics.map((d) => {
    const live = aqiByZip.get(d.geoid);
    return {
      geoid: d.geoid,
      name: d.geoid,
      city: zipCities[d.geoid],
      aqi: live?.aqi ?? null,
      category: live?.category ?? null,
      demo: d,
    };
  });
}

function buildCountyRows(
  countyDemographics: DemographicsData[],
  fresnoAvgAqi: number | null,
): TableRow[] {
  return countyDemographics.map((d) => {
    const isFresno = d.geoid === "06019";
    const aqi = isFresno ? fresnoAvgAqi : null;
    const category = aqi != null ? aqiCategory(aqi) : null;
    return { geoid: d.geoid, name: d.name, aqi, category, demo: d };
  });
}

function buildStateRows(
  stateDemographic: DemographicsData | null,
  fresnoAvgAqi: number | null,
): TableRow[] {
  if (!stateDemographic) return [];
  const aqi = fresnoAvgAqi;
  const category = aqi != null ? aqiCategory(aqi) : null;
  return [{ geoid: stateDemographic.geoid, name: stateDemographic.name, aqi, category, demo: stateDemographic }];
}

function aqiCategory(aqi: number): string {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

// ── Viewport filtering ─────────────────────────────────────────────────────

function filterByViewport(
  rows: TableRow[],
  countyBoundaries: CountyBoundaryCollection | null,
  bounds: MapBounds | null,
): TableRow[] {
  if (!countyBoundaries || !bounds) return rows;
  const visible = new Set(
    countyBoundaries.features
      .filter((f) => {
        const lon = f.properties.CENTROID_LON;
        const lat = f.properties.CENTROID_LAT;
        return (
          lon != null && lat != null &&
          lon >= bounds.west && lon <= bounds.east &&
          lat >= bounds.south && lat <= bounds.north
        );
      })
      .map((f) => f.properties.GEOID),
  );
  return rows.filter((r) => visible.has(r.geoid));
}

// ── Sorting ────────────────────────────────────────────────────────────────

function getRowSortValue(row: TableRow, key: SortKey): number | string | null {
  if (key === "name") return row.name;
  if (key === "city") return row.city ?? null;
  if (key === "aqi") return row.aqi;
  return (row.demo[key as DemoNumericField] as number | null | undefined) ?? null;
}

function sortRows(rows: TableRow[], key: SortKey, dir: "asc" | "desc"): TableRow[] {
  return [...rows].sort((a, b) => {
    const va = getRowSortValue(a, key);
    const vb = getRowSortValue(b, key);
    // Nulls always at bottom
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === "string" && typeof vb === "string") {
      return dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    const na = va as number, nb = vb as number;
    return dir === "desc" ? nb - na : na - nb;
  });
}

// ── Sort header ────────────────────────────────────────────────────────────

function SortArrow({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) {
    return (
      <span className="ml-0.5 inline-block text-gray-300 text-[9px]">↕</span>
    );
  }
  return (
    <span className="ml-0.5 inline-block text-blue-600 text-[9px]">
      {dir === "desc" ? "↓" : "↑"}
    </span>
  );
}

// ── TableViewModal ─────────────────────────────────────────────────────────

interface TableViewModalProps {
  open: boolean;
  tier: MapTier;
  rows: ZipNow[];
  fresnoAvgAqi: number | null;
  countyDemographics: DemographicsData[];
  stateDemographic: DemographicsData | null;
  zctaDemographics: DemographicsData[];
  countyBoundaries: CountyBoundaryCollection | null;
  activeMetric: Metric;
  mapBounds: MapBounds | null;
  zipCities: Record<string, string>;
  onClose: () => void;
}

export function TableViewModal({
  open, tier, rows, fresnoAvgAqi,
  countyDemographics, stateDemographic, zctaDemographics,
  countyBoundaries, activeMetric, mapBounds, zipCities,
  onClose,
}: TableViewModalProps) {
  const defaultSortKey = activeMetric === "aqi" ? "aqi" : (activeMetric as SortKey);
  const [sortKey, setSortKey] = useState<SortKey>(defaultSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Reset sort when metric or tier changes
  useEffect(() => {
    setSortKey(activeMetric === "aqi" ? "aqi" : (activeMetric as SortKey));
    setSortDir("desc");
  }, [activeMetric, tier]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const allRows = useMemo<TableRow[]>(() => {
    if (tier === "zip") return buildZipRows(zctaDemographics, rows, zipCities);
    if (tier === "county") return buildCountyRows(countyDemographics, fresnoAvgAqi);
    return buildStateRows(stateDemographic, fresnoAvgAqi);
  }, [tier, zctaDemographics, rows, zipCities, countyDemographics, stateDemographic, fresnoAvgAqi]);

  const filteredRows = useMemo<TableRow[]>(() => {
    if (tier !== "county") return allRows;
    return filterByViewport(allRows, countyBoundaries, mapBounds);
  }, [tier, allRows, countyBoundaries, mapBounds]);

  const displayRows = useMemo(
    () => sortRows(filteredRows, sortKey, sortDir),
    [filteredRows, sortKey, sortDir],
  );

  const cols = useMemo(() => buildColumns(tier, activeMetric), [tier, activeMetric]);

  const totalCount = allRows.length;
  const showingCount = filteredRows.length;

  function handleHeaderClick(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  if (!open) return null;

  const tierLabel = tier === "zip" ? "ZIP" : tier === "county" ? "County" : "State";
  const tierLabelPlural = tier === "zip" ? "ZIPs" : tier === "county" ? "Counties" : "States";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-16"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative flex w-full max-w-3xl flex-col rounded-xl bg-white shadow-2xl"
        style={{ maxHeight: "80vh" }}>
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-gray-900">{tierLabel} Rankings</h2>
            <p className="mt-0.5 text-[11px] text-gray-400" data-testid="table-subtitle">
              {tier === "county" && totalCount !== showingCount
                ? `Showing ${showingCount} of ${totalCount} counties (map viewport)`
                : `Showing ${showingCount} ${showingCount === 1 ? tierLabel : tierLabelPlural}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close table view"
          >
            ✕
          </button>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <table className="w-full text-sm" data-testid="table-view">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-gray-200">
                <th className="pb-2 pr-3 w-9 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
                  RK
                </th>
                {cols.map((col) => (
                  <th
                    key={col.key}
                    className={`pb-2 pr-3 text-xs font-semibold uppercase tracking-wide text-gray-500 cursor-pointer select-none hover:text-gray-800 ${col.align === "right" ? "text-right" : "text-left"}`}
                    onClick={() => handleHeaderClick(col.key)}
                  >
                    {col.label}
                    <SortArrow active={sortKey === col.key} dir={sortDir} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayRows.length === 0 ? (
                <tr>
                  <td colSpan={cols.length + 1} className="py-8 text-center text-sm text-gray-400">
                    No data in current viewport
                  </td>
                </tr>
              ) : (
                displayRows.map((row, i) => (
                  <tr key={row.geoid} className="hover:bg-gray-50">
                    <td className="py-2 pr-3 text-xs tabular-nums text-gray-400">{i + 1}</td>
                    {cols.map((col) => (
                      <td
                        key={col.key}
                        className={`py-2 pr-3 text-sm ${col.align === "right" ? "text-right" : ""}`}
                      >
                        {col.renderCell(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-gray-100 px-6 py-3">
          <p className="text-[11px] text-gray-400">
            Demographics: ACS 5-Year 2024 · AQI: PurpleAir sensors (EPA/Barkjohn correction)
          </p>
        </div>
      </div>
    </div>
  );
}
