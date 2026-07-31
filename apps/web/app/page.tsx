"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { MapViewHandle, BoundaryCollection, CountyBoundaryCollection, StateBoundaryCollection } from "@/components/MapView";
import { Sidebar } from "@/components/Sidebar";
import { DetailPanel } from "@/components/DetailPanel";
import { FilterPanel, DEFAULT_RANGE, type AqiRange } from "@/components/FilterPanel";
import { AboutPanel } from "@/components/AboutPanel";
import { TierControl, type MapTier } from "@/components/TierControl";
import { TableViewModal } from "@/components/TableViewModal";
import { SearchBar } from "@/components/SearchBar";
import { RegionPanel, type SelectedRegion } from "@/components/RegionPanel";
import { fetchZipsNow, fetchZipBoundaries, fetchCountyBoundaries, fetchStateBoundaries, ApiError } from "@/lib/api";
import type { ZipNow, SearchResult } from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-gray-100">
      <span className="text-sm text-gray-500">Loading map…</span>
    </div>
  ),
});

type LoadState = "loading" | "ready" | "error";

export default function Home() {
  const [rows, setRows] = useState<ZipNow[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [boundaries, setBoundaries] = useState<BoundaryCollection | null>(null);
  const [countyBoundaries, setCountyBoundaries] = useState<CountyBoundaryCollection | null>(null);
  const [stateBoundaries, setStateBoundaries] = useState<StateBoundaryCollection | null>(null);
  const [tier, setTier] = useState<MapTier>("county");
  const [selectedStateGeoid, setSelectedStateGeoid] = useState("06");
  const [selectedCountyGeoid, setSelectedCountyGeoid] = useState("06019");

  const [selectedZip, setSelectedZip] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<SelectedRegion | null>(null);
  const [range, setRange] = useState<AqiRange>(DEFAULT_RANGE);
  const [filterOpen, setFilterOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tableViewOpen, setTableViewOpen] = useState(false);

  const mapRef = useRef<MapViewHandle | null>(null);

  // Fetch AQI rows and state boundaries once on mount.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchZipsNow(ctrl.signal)
      .then((data) => { setRows(data); setState("ready"); })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setErrorMsg(
          err instanceof ApiError
            ? err.message
            : "Could not reach HFA API. Is the server running?",
        );
        setState("error");
      });
    fetchStateBoundaries().then((b) => { if (b) setStateBoundaries(b); });
    return () => ctrl.abort();
  }, []);

  // Refetch county boundaries whenever the selected state changes.
  useEffect(() => {
    fetchCountyBoundaries(selectedStateGeoid).then((b) => { if (b) setCountyBoundaries(b); });
  }, [selectedStateGeoid]);

  // Refetch ZIP boundaries whenever the selected county changes.
  useEffect(() => {
    fetchZipBoundaries(selectedCountyGeoid).then((b) => { if (b) setBoundaries(b); });
  }, [selectedCountyGeoid]);

  const filtered = useMemo(
    () => rows.filter((r) => r.aqi >= range.min && r.aqi <= range.max),
    [rows, range],
  );

  const selectedRow = useMemo(
    () => rows.find((r) => r.zip === selectedZip) ?? null,
    [rows, selectedZip],
  );

  const fresnoAvgAqi = useMemo(() => {
    if (rows.length === 0) return null;
    return Math.round(rows.reduce((sum, r) => sum + r.aqi, 0) / rows.length);
  }, [rows]);

  const handleSelectZip = useCallback((zip: string) => {
    setSelectedZip(zip);
    mapRef.current?.flyToZip(zip);
    setSidebarOpen(false);
  }, []);

  const handleSearchSelect = useCallback((result: SearchResult) => {
    const targetTier = result.type === "state" ? "state" : result.type === "county" ? "county" : "zip";
    if (tier !== targetTier) setTier(targetTier);
    if (result.type === "state") {
      setSelectedStateGeoid(result.identifier);
    } else if (result.type === "county") {
      if (result.state_fp) setSelectedStateGeoid(result.state_fp);
      setSelectedCountyGeoid(result.identifier);
    } else {
      handleSelectZip(result.identifier);
    }
    mapRef.current?.flyToRegion(result);
  }, [tier, handleSelectZip]);

  const handleShare = useCallback(() => {
    if (typeof window !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href).catch(() => {});
    }
  }, []);

  // Tier change: reveal the new tier in-place. Pan only if detail is out of view.
  const handleTierChange = useCallback((newTier: MapTier) => {
    setTier(newTier);
    mapRef.current?.ensureVisible(newTier);
  }, []);

  // Map click on a state → update context + open RegionPanel, no tier switch.
  const handleStateSelect = useCallback((geoid: string, name: string) => {
    setSelectedStateGeoid(geoid);
    setSelectedRegion({ type: "state", geoid, name });
  }, []);

  // Map click on a county → update context + open RegionPanel, no tier switch.
  const handleCountySelect = useCallback((geoid: string, name: string) => {
    setSelectedCountyGeoid(geoid);
    setSelectedRegion({ type: "county", geoid, name });
  }, []);

  // Clicking a sidebar row in non-zip tier auto-switches to ZIP tier.
  const handleSidebarSelectZip = useCallback((zip: string) => {
    if (tier !== "zip") setTier("zip");
    handleSelectZip(zip);
  }, [tier, handleSelectZip]);

  const ingestionEmpty = state === "ready" && rows.length === 0;

  return (
    <div className="flex h-screen flex-col">
      {/* Header — reference layout: Search | divider | Tier radios | Share | Filter | About */}
      <header className="relative z-40 flex h-14 flex-shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4">
        {/* Search — grows to fill left portion */}
        <SearchBar onSelect={handleSearchSelect} />

        {/* Vertical divider */}
        <div className="h-7 w-px flex-shrink-0 bg-gray-200" aria-hidden="true" />

        {/* Tier radio buttons */}
        <TierControl tier={tier} onChange={handleTierChange} />

        {/* Share button */}
        <button
          onClick={handleShare}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
          aria-label="Share"
          title="Copy link"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
        </button>

        {/* Filter button */}
        <button
          onClick={() => { setFilterOpen((o) => !o); setAboutOpen(false); }}
          className="flex flex-shrink-0 items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 8h10M10 12h4" />
          </svg>
          Filter
        </button>

        {/* About — repurposes the avatar slot; accounts deferred */}
        <button
          onClick={() => { setAboutOpen(true); setFilterOpen(false); }}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-teal-500 text-sm font-bold text-white hover:bg-teal-600"
          aria-label="About"
          title="About Healthy Fresno Air"
        >
          HF
        </button>
      </header>

      {/* Body */}
      <div className="relative flex flex-1 overflow-hidden">
        <aside
          className={`absolute inset-y-0 left-0 z-30 w-[280px] flex-shrink-0 border-r border-gray-200 bg-white transition-transform duration-300 md:static md:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar
            data={filtered}
            onSelectZip={handleSidebarSelectZip}
            ingestionEmpty={ingestionEmpty}
            onTableView={() => { setTableViewOpen(true); setFilterOpen(false); setAboutOpen(false); }}
          />
        </aside>

        {sidebarOpen && (
          <div className="absolute inset-0 z-20 bg-black/30 md:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        <main className="relative flex-1">
          <MapView
            ref={mapRef}
            data={filtered}
            boundaries={boundaries}
            countyBoundaries={countyBoundaries}
            stateBoundaries={stateBoundaries}
            tier={tier}
            fresnoAvgAqi={fresnoAvgAqi}
            selectedStateGeoid={selectedStateGeoid}
            selectedCountyGeoid={selectedCountyGeoid}
            onSelectZip={handleSelectZip}
            onStateSelect={handleStateSelect}
            onCountySelect={handleCountySelect}
          />

          {state === "loading" && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
                <span className="text-sm text-gray-600">Loading air quality data…</span>
              </div>
            </div>
          )}

          {state === "error" && (
            <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-md bg-red-600 px-4 py-2 text-sm text-white shadow-lg">
              {errorMsg}
            </div>
          )}

          {ingestionEmpty && (
            <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-800 shadow-md ring-1 ring-amber-200">
              Air quality data unavailable — ingestion paused. Historical data shown when available.
            </div>
          )}

          <RegionPanel
            region={selectedRegion}
            fresnoAvgAqi={fresnoAvgAqi}
            onClose={() => setSelectedRegion(null)}
          />

          <FilterPanel open={filterOpen} range={range} onChange={setRange} onClose={() => setFilterOpen(false)} />
        </main>

        <DetailPanel zip={selectedRow} onClose={() => setSelectedZip(null)} />
      </div>

      <AboutPanel open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <TableViewModal
        open={tableViewOpen}
        tier={tier}
        rows={filtered}
        fresnoAvgAqi={fresnoAvgAqi}
        onClose={() => setTableViewOpen(false)}
      />
    </div>
  );
}
