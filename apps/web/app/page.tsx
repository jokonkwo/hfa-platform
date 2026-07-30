"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { MapViewHandle, BoundaryCollection, CountyBoundaryCollection } from "@/components/MapView";
import { Sidebar } from "@/components/Sidebar";
import { DetailPanel } from "@/components/DetailPanel";
import { FilterPanel, DEFAULT_RANGE, type AqiRange } from "@/components/FilterPanel";
import { AboutPanel } from "@/components/AboutPanel";
import { TierControl, type MapTier } from "@/components/TierControl";
import { fetchZipsNow, fetchZipBoundaries, fetchCountyBoundaries, ApiError } from "@/lib/api";
import type { ZipNow } from "@/lib/types";

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
  const [tier, setTier] = useState<MapTier>("county");

  const [selectedZip, setSelectedZip] = useState<string | null>(null);
  const [range, setRange] = useState<AqiRange>(DEFAULT_RANGE);
  const [filterOpen, setFilterOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const mapRef = useRef<MapViewHandle | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchZipsNow(ctrl.signal)
      .then((data) => {
        setRows(data);
        setState("ready");
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setErrorMsg(
          err instanceof ApiError
            ? err.message
            : "Could not reach HFA API. Is the server running?",
        );
        setState("error");
      });
    fetchZipBoundaries().then((b) => { if (b) setBoundaries(b); });
    fetchCountyBoundaries().then((b) => { if (b) setCountyBoundaries(b); });
    return () => ctrl.abort();
  }, []);

  const filtered = useMemo(
    () => rows.filter((r) => r.aqi >= range.min && r.aqi <= range.max),
    [rows, range],
  );

  const selectedRow = useMemo(
    () => rows.find((r) => r.zip === selectedZip) ?? null,
    [rows, selectedZip],
  );

  // Fresno County aggregate AQI shown in county-tier hover/popup.
  // All data rows are Fresno County ZIPs for the pilot.
  const fresnoAvgAqi = useMemo(() => {
    if (rows.length === 0) return null;
    return Math.round(rows.reduce((sum, r) => sum + r.aqi, 0) / rows.length);
  }, [rows]);

  const handleSelectZip = useCallback((zip: string) => {
    setSelectedZip(zip);
    mapRef.current?.flyToZip(zip);
    setSidebarOpen(false);
  }, []);

  // Tier change: fly the camera to match the new tier.
  const handleTierChange = useCallback((newTier: MapTier) => {
    setTier(newTier);
    if (newTier === "county") {
      mapRef.current?.flyToCA();
    } else {
      mapRef.current?.flyToFresno();
    }
  }, []);

  // Fresno county click → switch to ZIP tier and fly to Fresno.
  const handleCountyClick = useCallback((_geoid: string) => {
    setTier("zip");
    mapRef.current?.flyToFresno();
  }, []);

  // Clicking a sidebar row in county tier auto-switches to ZIP tier.
  const handleSidebarSelectZip = useCallback((zip: string) => {
    if (tier === "county") setTier("zip");
    handleSelectZip(zip);
  }, [tier, handleSelectZip]);

  const ingestionEmpty = state === "ready" && rows.length === 0;

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="relative z-40 flex h-14 flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 md:hidden"
            aria-label="Toggle sidebar"
          >
            ☰
          </button>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-gray-900">
              Healthy Fresno Air
            </span>
            <span className="hidden text-xs text-gray-400 sm:inline">
              Fresno County · v1 POC
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setFilterOpen((o) => !o);
              setAboutOpen(false);
            }}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Filter
          </button>
          <button
            onClick={() => setAboutOpen(true)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            aria-label="About"
          >
            About
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`absolute inset-y-0 left-0 z-30 w-[280px] flex-shrink-0 border-r border-gray-200 bg-white transition-transform duration-300 md:static md:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar
            data={filtered}
            onSelectZip={handleSidebarSelectZip}
            ingestionEmpty={ingestionEmpty}
          />
        </aside>

        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 z-20 bg-black/30 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Map area */}
        <main className="relative flex-1">
          <MapView
            ref={mapRef}
            data={filtered}
            boundaries={boundaries}
            countyBoundaries={countyBoundaries}
            tier={tier}
            fresnoAvgAqi={fresnoAvgAqi}
            onSelectZip={handleSelectZip}
            onCountyClick={handleCountyClick}
          />

          {/* Tier control — bottom-center map overlay */}
          <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
            <TierControl tier={tier} onChange={handleTierChange} />
          </div>

          {/* Loading overlay */}
          {state === "loading" && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
                <span className="text-sm text-gray-600">
                  Loading air quality data…
                </span>
              </div>
            </div>
          )}

          {/* Error banner */}
          {state === "error" && (
            <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-md bg-red-600 px-4 py-2 text-sm text-white shadow-lg">
              {errorMsg}
            </div>
          )}

          {/* Empty / ingestion-paused banner */}
          {ingestionEmpty && (
            <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-800 shadow-md ring-1 ring-amber-200">
              Air quality data unavailable — ingestion paused. Historical data
              shown when available.
            </div>
          )}

          <FilterPanel
            open={filterOpen}
            range={range}
            onChange={setRange}
            onClose={() => setFilterOpen(false)}
          />
        </main>

        {/* Tier-2 detail panel */}
        <DetailPanel zip={selectedRow} onClose={() => setSelectedZip(null)} />
      </div>

      <AboutPanel open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
