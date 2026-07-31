"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import type * as GeoJSON from "geojson";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import mapboxgl from "mapbox-gl";
import type { ZipNow, SearchResult } from "@/lib/types";
import { categoryColor, aqiToCategory } from "@/lib/aqi";
import { ZIP_CENTROIDS, FRESNO_CENTER, FRESNO_ZOOM } from "@/lib/zipCentroids";
import type { MapTier } from "@/components/TierControl";

const MAPBOX_OUTDOORS_STYLE = "mapbox://styles/mapbox/outdoors-v12";
const CA_CENTER: [number, number] = [-119.5, 37.2];
const CA_ZOOM = 5;
const FRESNO_COUNTY_GEOID = "06019";
const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// ── Source / layer IDs ─────────────────────────────────────────────────────

const ZIP_CIRCLE_SOURCE = "zips";
const ZIP_CIRCLE_LAYER = "zip-circles";
const ZIP_BOUNDARY_SOURCE = "zip-boundaries";
const ZIP_BOUNDARY_FILL = "zip-boundary-fill";
const ZIP_BOUNDARY_OUTLINE = "zip-boundary-outline";
const COUNTY_SOURCE = "county-boundaries";
const COUNTY_FILL = "county-boundary-fill";
const COUNTY_OUTLINE = "county-boundary-outline";
const STATE_SOURCE = "state-boundaries";
const STATE_FILL = "state-boundary-fill";
const STATE_OUTLINE = "state-boundary-outline";

// ── Exported types ─────────────────────────────────────────────────────────

export interface MapViewHandle {
  flyToZip: (zip: string) => void;
  ensureVisible: (tier: MapTier) => void;
  flyToRegion: (result: SearchResult) => void;
}

export type BoundaryCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  { ZCTA5: string }
>;

export type CountyBoundaryCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  { GEOID: string; NAME: string; NAMELSAD: string }
>;

export type StateBoundaryCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  { GEOID: string; NAME: string; STUSPS: string; isCalifornia: boolean }
>;

// ── Geometry bbox helper ───────────────────────────────────────────────────

function geomBbox(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): [[number, number], [number, number]] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  function processRing(ring: GeoJSON.Position[]) {
    for (const coord of ring) {
      const lng = coord[0], lat = coord[1];
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (geom.type === "Polygon") {
    geom.coordinates.forEach(processRing);
  } else {
    geom.coordinates.forEach((polygon) => polygon.forEach(processRing));
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}

// ── GeoJSON builders ───────────────────────────────────────────────────────

type ZipFeatureProps = {
  zip: string; town: string; aqi: number; category: string; color: string;
};

function buildPointGeoJSON(
  data: ZipNow[],
): GeoJSON.FeatureCollection<GeoJSON.Point, ZipFeatureProps> {
  const features: GeoJSON.Feature<GeoJSON.Point, ZipFeatureProps>[] = [];
  for (const row of data) {
    const centroid = ZIP_CENTROIDS[row.zip];
    if (!centroid) continue;
    const [lat, lon] = centroid;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        zip: row.zip, town: row.town, aqi: row.aqi, category: row.category,
        color: categoryColor(row.category),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function buildZipBoundaryGeoJSON(
  boundaries: BoundaryCollection,
  data: ZipNow[],
): GeoJSON.FeatureCollection {
  const aqiByZip = new Map(data.map((r) => [r.zip, r]));
  return {
    type: "FeatureCollection",
    features: boundaries.features.map(
      (ft: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, { ZCTA5: string }>) => {
        const zip = ft.properties?.ZCTA5 ?? "";
        const row = aqiByZip.get(zip);
        return {
          ...ft,
          properties: {
            zip,
            color: row ? categoryColor(row.category) : "#cccccc",
            hasData: row ? 1 : 0,
            aqi: row?.aqi ?? null,
            category: row?.category ?? null,
            town: row?.town ?? null,
          },
        };
      },
    ),
  };
}

function buildCountyGeoJSON(
  countyBoundaries: CountyBoundaryCollection,
  fresnoAvgAqi: number | null,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: countyBoundaries.features.map(
      (ft: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, { GEOID: string; NAME: string; NAMELSAD: string }>) => {
        const geoid = ft.properties?.GEOID ?? "";
        const name = ft.properties?.NAME ?? "";
        const namelsad = ft.properties?.NAMELSAD ?? "";
        const isFresno = geoid === FRESNO_COUNTY_GEOID;
        const avgAqi = isFresno ? fresnoAvgAqi : null;
        const color =
          isFresno && avgAqi !== null
            ? categoryColor(aqiToCategory(avgAqi))
            : "#cccccc";
        return {
          ...ft,
          properties: { geoid, name, namelsad, color, hasData: isFresno ? 1 : 0, avgAqi },
        };
      },
    ),
  };
}

function buildStateGeoJSON(
  stateBoundaries: StateBoundaryCollection,
  fresnoAvgAqi: number | null,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: stateBoundaries.features.map(
      (ft: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, { GEOID: string; NAME: string; STUSPS: string; isCalifornia: boolean }>) => {
        const { GEOID, NAME, STUSPS, isCalifornia } = ft.properties ?? {};
        const color = isCalifornia
          ? (fresnoAvgAqi !== null ? categoryColor(aqiToCategory(fresnoAvgAqi)) : "#3B82F6")
          : "#cccccc";
        return {
          ...ft,
          properties: { geoid: GEOID, name: NAME, stusps: STUSPS, isCalifornia: isCalifornia ?? false, color },
        };
      },
    ),
  };
}

// ── Tier styling ───────────────────────────────────────────────────────────
//
// All three tiers are rendered simultaneously. The active tier is "primary"
// (full opacity, interactive). Outer tiers stay visible as context at
// reduced opacity. Only ZIP/circle layers are fully hidden in non-zip tiers.

function applyTierStyling(map: mapboxgl.Map, tier: MapTier) {
  // ── State layer: always visible, fades as you drill deeper ────────────
  if (map.getLayer(STATE_FILL)) {
    const caFill  = tier === "state" ? 0.30 : tier === "county" ? 0.08 : 0.05;
    const otFill  = tier === "state" ? 0.08 : tier === "county" ? 0.03 : 0.02;
    const caHover = tier === "state" ? 0.50 : caFill;
    map.setPaintProperty(STATE_FILL, "fill-opacity", [
      "case",
      ["boolean", ["feature-state", "hover"], false], caHover,
      ["==", ["get", "isCalifornia"], true], caFill,
      otFill,
    ] as unknown as number);
    const caLine  = tier === "state" ? 0.85 : tier === "county" ? 0.30 : 0.15;
    const otLine  = tier === "state" ? 0.30 : tier === "county" ? 0.10 : 0.08;
    map.setPaintProperty(STATE_OUTLINE, "line-opacity", [
      "case",
      ["boolean", ["feature-state", "hover"], false], 1.0,
      ["==", ["get", "isCalifornia"], true], caLine,
      otLine,
    ] as unknown as number);
    map.setPaintProperty(STATE_OUTLINE, "line-width", [
      "case",
      ["boolean", ["feature-state", "hover"], false], tier === "state" ? 3.0 : 1.5,
      ["==", ["get", "isCalifornia"], true],
      tier === "state" ? 1.8 : 0.8,
      tier === "state" ? 1.0 : 0.5,
    ] as unknown as number);
    map.setPaintProperty(STATE_OUTLINE, "line-color", [
      "case",
      ["boolean", ["feature-state", "hover"], false], "#000000",
      "#444444",
    ] as unknown as string);
  }

  // ── County layer: hidden in state tier; primary in county; context in zip
  if (map.getLayer(COUNTY_FILL)) {
    const countyVisible = tier !== "state";
    map.setLayoutProperty(COUNTY_FILL,    "visibility", countyVisible ? "visible" : "none");
    map.setLayoutProperty(COUNTY_OUTLINE, "visibility", countyVisible ? "visible" : "none");
    if (countyVisible) {
      if (tier === "county") {
        map.setPaintProperty(COUNTY_FILL, "fill-opacity", [
          "case",
          ["boolean", ["feature-state", "hover"], false], 0.65,
          ["==", ["get", "hasData"], 1], 0.40,
          0.10,
        ] as unknown as number);
        map.setPaintProperty(COUNTY_OUTLINE, "line-opacity", [
          "case",
          ["boolean", ["feature-state", "hover"], false], 1.0,
          ["==", ["get", "hasData"], 1], 0.9, 0.30,
        ] as unknown as number);
        map.setPaintProperty(COUNTY_OUTLINE, "line-width", [
          "case",
          ["boolean", ["feature-state", "hover"], false], 3.0, 1.8,
        ] as unknown as number);
        map.setPaintProperty(COUNTY_OUTLINE, "line-color", [
          "case",
          ["boolean", ["feature-state", "hover"], false], "#000000",
          "#111111",
        ] as unknown as string);
      } else {
        // zip tier — county is secondary context
        map.setPaintProperty(COUNTY_FILL, "fill-opacity", [
          "case", ["==", ["get", "hasData"], 1], 0.10, 0.04,
        ] as unknown as number);
        map.setPaintProperty(COUNTY_OUTLINE, "line-opacity", [
          "case", ["==", ["get", "hasData"], 1], 0.40, 0.18,
        ] as unknown as number);
        map.setPaintProperty(COUNTY_OUTLINE, "line-width", 1.2);
      }
    }
  }

  // ── ZIP layer + circles: only in zip tier ─────────────────────────────
  const zipVisible = tier === "zip";
  if (map.getLayer(ZIP_BOUNDARY_FILL)) {
    map.setLayoutProperty(ZIP_BOUNDARY_FILL,    "visibility", zipVisible ? "visible" : "none");
    map.setLayoutProperty(ZIP_BOUNDARY_OUTLINE, "visibility", zipVisible ? "visible" : "none");
    if (zipVisible) {
      map.setPaintProperty(ZIP_BOUNDARY_FILL, "fill-opacity", [
        "case",
        ["boolean", ["feature-state", "hover"], false], 0.60,
        ["==", ["get", "hasData"], 1], 0.35,
        0.18,
      ] as unknown as number);
      map.setPaintProperty(ZIP_BOUNDARY_OUTLINE, "line-opacity", [
        "case",
        ["boolean", ["feature-state", "hover"], false], 1.0,
        ["==", ["get", "hasData"], 1], 0.90, 0.55,
      ] as unknown as number);
      map.setPaintProperty(ZIP_BOUNDARY_OUTLINE, "line-width", [
        "case",
        ["boolean", ["feature-state", "hover"], false], 4.0,
        2.5,
      ] as unknown as number);
      map.setPaintProperty(ZIP_BOUNDARY_OUTLINE, "line-color", [
        "case",
        ["boolean", ["feature-state", "hover"], false], "#000000",
        "#111111",
      ] as unknown as string);
    }
  }
  if (map.getLayer(ZIP_CIRCLE_LAYER)) {
    map.setLayoutProperty(ZIP_CIRCLE_LAYER, "visibility", zipVisible ? "visible" : "none");
  }
}

// ── Tooltip HTML helpers ───────────────────────────────────────────────────

function stateTooltipHtml(name: string, isCalifornia: boolean, fresnoAvgAqi: number | null): string {
  const aqiLine = isCalifornia && fresnoAvgAqi !== null
    ? `<br/><span style="font-weight:600">Avg AQI ${fresnoAvgAqi}</span><span style="color:#6b7280"> across pilot ZIPs</span>`
    : isCalifornia
    ? `<br/><span style="color:#9ca3af">Air quality data available</span>`
    : `<br/><span style="color:#9ca3af">No program data yet</span>`;
  return `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:7px 10px;background:#fff;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.15);border:1px solid #e5e7eb;white-space:nowrap;"><span style="font-weight:700">${name}</span>${aqiLine}<br/><span style="font-size:11px;color:#2563eb">Click for summary →</span></div>`;
}

function countyTooltipHtml(namelsad: string, hasData: number, avgAqi: number | null): string {
  const aqiLine = hasData
    ? `<br/><span style="font-weight:600">Avg AQI ${avgAqi ?? "—"}</span><span style="color:#6b7280"> across pilot ZIPs</span>`
    : `<br/><span style="color:#9ca3af">No sensor data yet</span>`;
  return `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:7px 10px;background:#fff;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.15);border:1px solid #e5e7eb;white-space:nowrap;"><span style="font-weight:700">${namelsad}</span>${aqiLine}<br/><span style="font-size:11px;color:#2563eb">Click for summary →</span></div>`;
}

function zipTooltipHtml(zip: string, town: string | null, hasData: number, aqi: number | null, category: string | null): string {
  if (hasData) {
    return `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:7px 10px;background:#fff;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.15);border:1px solid #e5e7eb;white-space:nowrap;"><span style="font-weight:700">${zip}</span><span style="color:#6b7280;margin-left:4px">${town ?? ""}</span><br/><span style="font-weight:600">AQI ${aqi}</span><span style="color:#6b7280"> · ${category ?? ""}</span></div>`;
  }
  return `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:7px 10px;background:#fff;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.15);border:1px solid #e5e7eb;white-space:nowrap;"><span style="font-weight:700">${zip}</span><br/><span style="color:#9ca3af">No sensor data</span></div>`;
}

// ── MapView ────────────────────────────────────────────────────────────────

interface MapViewProps {
  data: ZipNow[];
  boundaries: BoundaryCollection | null;
  countyBoundaries: CountyBoundaryCollection | null;
  stateBoundaries: StateBoundaryCollection | null;
  tier: MapTier;
  fresnoAvgAqi: number | null;
  selectedStateGeoid?: string;
  selectedCountyGeoid?: string;
  onSelectZip: (zip: string) => void;
  onStateSelect: (geoid: string, name: string) => void;
  onCountySelect: (geoid: string, name: string) => void;
}

const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { data, boundaries, countyBoundaries, stateBoundaries, tier, fresnoAvgAqi,
    selectedStateGeoid = "06", selectedCountyGeoid = "06019",
    onSelectZip, onStateSelect, onCountySelect },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const readyRef = useRef(false);

  const dataRef = useRef<ZipNow[]>(data);
  const boundariesRef = useRef<BoundaryCollection | null>(boundaries);
  const countyBoundariesRef = useRef<CountyBoundaryCollection | null>(countyBoundaries);
  const stateBoundariesRef = useRef<StateBoundaryCollection | null>(stateBoundaries);
  const tierRef = useRef<MapTier>(tier);
  const fresnoAvgAqiRef = useRef<number | null>(fresnoAvgAqi);
  const selectedStateGeoidRef = useRef(selectedStateGeoid);
  const selectedCountyGeoidRef = useRef(selectedCountyGeoid);
  const onSelectRef = useRef(onSelectZip);
  const onStateSelectRef = useRef(onStateSelect);
  const onCountySelectRef = useRef(onCountySelect);

  // Hover ID refs — cleared on tier change so stale hover state doesn't persist.
  const hoveredStateIdRef = useRef<string | number | undefined>(undefined);
  const hoveredCountyIdRef = useRef<string | number | undefined>(undefined);
  const hoveredZipIdRef = useRef<string | number | undefined>(undefined);

  dataRef.current = data;
  boundariesRef.current = boundaries;
  countyBoundariesRef.current = countyBoundaries;
  stateBoundariesRef.current = stateBoundaries;
  tierRef.current = tier;
  fresnoAvgAqiRef.current = fresnoAvgAqi;
  selectedStateGeoidRef.current = selectedStateGeoid;
  selectedCountyGeoidRef.current = selectedCountyGeoid;
  onSelectRef.current = onSelectZip;
  onStateSelectRef.current = onStateSelect;
  onCountySelectRef.current = onCountySelect;

  useImperativeHandle(ref, () => ({
    flyToZip(zip: string) {
      const centroid = ZIP_CENTROIDS[zip];
      const map = mapRef.current;
      if (!centroid || !map) return;
      const [lat, lon] = centroid;
      map.flyTo({ center: [lon, lat], zoom: 12, duration: 450 });
    },
    ensureVisible(newTier: MapTier) {
      const map = mapRef.current;
      if (!map) return;

      if (newTier === "state") {
        // Fit to selected state; fallback to CONUS bbox.
        const stateFeature = stateBoundariesRef.current?.features.find(
          (f) => f.properties.GEOID === selectedStateGeoidRef.current,
        );
        const bounds: mapboxgl.LngLatBoundsLike = stateFeature
          ? geomBbox(stateFeature.geometry)
          : [[-124.5, 32.5], [-114.1, 42.1]];
        map.fitBounds(bounds, { padding: 20, duration: 600, maxZoom: 7 });
      } else if (newTier === "county") {
        // Fit to selected county's actual geometry bbox.
        const countyFeature = countyBoundariesRef.current?.features.find(
          (f) => f.properties.GEOID === selectedCountyGeoidRef.current,
        );
        if (countyFeature) {
          map.fitBounds(geomBbox(countyFeature.geometry), { padding: 60, duration: 600, maxZoom: 11 });
        } else {
          // Fallback: fit to CA until boundaries load.
          map.fitBounds([[-124.5, 32.5], [-114.1, 42.1]], { padding: 20, duration: 600, maxZoom: 7 });
        }
      } else if (newTier === "zip") {
        // No forced re-zoom; pan to selected county centroid only if out of view.
        const countyFeature = countyBoundariesRef.current?.features.find(
          (f) => f.properties.GEOID === selectedCountyGeoidRef.current,
        );
        let center: [number, number];
        let targetZoom: number;
        if (countyFeature) {
          const [[w, s], [e, n]] = geomBbox(countyFeature.geometry);
          center = [(w + e) / 2, (s + n) / 2];
          targetZoom = FRESNO_ZOOM;
        } else {
          center = FRESNO_CENTER as [number, number];
          targetZoom = FRESNO_ZOOM;
        }
        const canvas = map.getCanvas();
        const margin = 80;
        const pt = map.project(center);
        const outOfView =
          pt.x < margin || pt.x > canvas.width - margin ||
          pt.y < margin || pt.y > canvas.height - margin;
        if (outOfView) {
          map.flyTo({ center, zoom: Math.max(map.getZoom(), targetZoom), duration: 500 });
        }
      }
    },
    flyToRegion(result: SearchResult) {
      const map = mapRef.current;
      if (!map) return;
      if (result.bbox) {
        const [west, south, east, north] = result.bbox;
        map.fitBounds([[west, south], [east, north]], { padding: 40, duration: 600 });
      } else {
        map.flyTo({ center: [result.lon, result.lat], zoom: 13, duration: 450 });
      }
    },
  }));

  // ── Sync functions: just setData; layers are added at map load ───────────

  const syncPoints = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource(ZIP_CIRCLE_SOURCE) as mapboxgl.GeoJSONSource)
      ?.setData(buildPointGeoJSON(dataRef.current));
  };

  const syncZipBoundaries = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !boundariesRef.current) return;
    (map.getSource(ZIP_BOUNDARY_SOURCE) as mapboxgl.GeoJSONSource)
      ?.setData(buildZipBoundaryGeoJSON(boundariesRef.current, dataRef.current));
    if (dataRef.current.length > 0) {
      type ZipNowWin = Window & typeof globalThis & { __hfaZipNowLoaded?: boolean };
      (window as ZipNowWin).__hfaZipNowLoaded = true;
    }
    type BoundaryWin = Window & typeof globalThis & { __hfaBoundariesLoaded?: boolean };
    (window as BoundaryWin).__hfaBoundariesLoaded = true;
  };

  const syncCountyBoundaries = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !countyBoundariesRef.current) return;
    (map.getSource(COUNTY_SOURCE) as mapboxgl.GeoJSONSource)
      ?.setData(buildCountyGeoJSON(countyBoundariesRef.current, fresnoAvgAqiRef.current));
    type BoundaryWin = Window & typeof globalThis & { __hfaCountyBoundariesLoaded?: boolean };
    (window as BoundaryWin).__hfaCountyBoundariesLoaded = true;
  };

  const syncStateBoundaries = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !stateBoundariesRef.current) return;
    (map.getSource(STATE_SOURCE) as mapboxgl.GeoJSONSource)
      ?.setData(buildStateGeoJSON(stateBoundariesRef.current, fresnoAvgAqiRef.current));
    type StateWin = Window & typeof globalThis & { __hfaStateBoundariesLoaded?: boolean };
    (window as StateWin).__hfaStateBoundariesLoaded = true;
  };

  // ── Map initialisation ────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const container = containerRef.current;
    let isDestroyed = false;
    let ro: ResizeObserver | null = null;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) throw new Error("[HFA] NEXT_PUBLIC_MAPBOX_TOKEN is not set.");

    const rafId = requestAnimationFrame(() => {
      if (isDestroyed || mapRef.current) return;

      const map = new mapboxgl.Map({
        accessToken: token,
        container,
        style: MAPBOX_OUTDOORS_STYLE,
        center: CA_CENTER,
        zoom: CA_ZOOM,
        attributionControl: true,
        preserveDrawingBuffer: true,
      });
      mapRef.current = map;
      map.addControl(new mapboxgl.NavigationControl(), "top-left");

      const tooltipEl = document.createElement("div");
      tooltipEl.id = "hfa-hover-tooltip";
      tooltipEl.style.cssText =
        "position:absolute;z-index:10;display:none;pointer-events:none;top:0;left:0";
      container.appendChild(tooltipEl);
      tooltipRef.current = tooltipEl;

      ro = new ResizeObserver(() => { mapRef.current?.resize(); });
      ro.observe(container);

      map.on("load", () => {
        // ── Add all sources (empty; populated by sync* functions) ───────
        map.addSource(STATE_SOURCE, { type: "geojson", data: EMPTY_FC, generateId: true });
        map.addSource(COUNTY_SOURCE, { type: "geojson", data: EMPTY_FC, generateId: true });
        map.addSource(ZIP_BOUNDARY_SOURCE, { type: "geojson", data: EMPTY_FC, generateId: true });
        map.addSource(ZIP_CIRCLE_SOURCE, { type: "geojson", data: buildPointGeoJSON([]) });

        // ── Add layers bottom → top (z-order is fixed from the start) ──
        map.addLayer({ id: STATE_FILL, type: "fill", source: STATE_SOURCE,
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.08 },
        });
        map.addLayer({ id: STATE_OUTLINE, type: "line", source: STATE_SOURCE,
          paint: { "line-color": "#444444", "line-width": 1.0, "line-opacity": 0.30 },
        });
        map.addLayer({ id: COUNTY_FILL, type: "fill", source: COUNTY_SOURCE,
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.10 },
        });
        map.addLayer({ id: COUNTY_OUTLINE, type: "line", source: COUNTY_SOURCE,
          paint: { "line-color": "#111111", "line-width": 1.8, "line-opacity": 0.30 },
        });
        map.addLayer({ id: ZIP_BOUNDARY_FILL, type: "fill", source: ZIP_BOUNDARY_SOURCE,
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.35 },
        });
        map.addLayer({ id: ZIP_BOUNDARY_OUTLINE, type: "line", source: ZIP_BOUNDARY_SOURCE,
          paint: { "line-color": "#111111", "line-width": 2.5, "line-opacity": 0.90 },
        });
        map.addLayer({ id: ZIP_CIRCLE_LAYER, type: "circle", source: ZIP_CIRCLE_SOURCE,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 6, 12, 10],
            "circle-color": ["get", "color"],
            "circle-opacity": 0.9,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
          },
        });

        // Apply correct styling for the default tier
        applyTierStyling(map, tierRef.current);
        readyRef.current = true;

        // ── Set up test globals ─────────────────────────────────────────
        type TestWin = Window & typeof globalThis & {
          __hfaMapLoaded?: boolean;
          __hfaMap?: mapboxgl.Map;
          __hfaProjectLngLat?: (lng: number, lat: number) => { x: number; y: number };
          __hfaTier?: MapTier;
        };
        const tw = window as TestWin;
        tw.__hfaMapLoaded = true;
        tw.__hfaMap = map;
        tw.__hfaProjectLngLat = (lng, lat) => map.project([lng, lat]);
        tw.__hfaTier = tierRef.current;

        // ── Event handlers ──────────────────────────────────────────────
        const tooltip = tooltipRef.current;

        // State layer
        map.on("mousemove", STATE_FILL, (e: mapboxgl.MapLayerMouseEvent) => {
          if (tierRef.current !== "state") return;
          const feature = e.features?.[0] as mapboxgl.GeoJSONFeature | undefined;
          if (!feature || feature.id == null) return;
          const fid = feature.id as string | number;
          if (hoveredStateIdRef.current !== undefined && hoveredStateIdRef.current !== fid) {
            map.setFeatureState({ source: STATE_SOURCE, id: hoveredStateIdRef.current }, { hover: false });
          }
          hoveredStateIdRef.current = fid;
          map.setFeatureState({ source: STATE_SOURCE, id: fid }, { hover: true });
          map.getCanvas().style.cursor = "pointer";
          const props = (feature.properties ?? {}) as { name: string; isCalifornia: boolean };
          if (tooltip) {
            const pt = e.point;
            tooltip.style.display = "block";
            tooltip.style.left = `${pt.x + 14}px`;
            tooltip.style.top = `${pt.y - 12}px`;
            tooltip.innerHTML = stateTooltipHtml(props.name, props.isCalifornia, fresnoAvgAqiRef.current);
          }
          type HoverWin = Window & typeof globalThis & { __hfaHoveredState?: string };
          (window as HoverWin).__hfaHoveredState = props.name;
        });

        map.on("mouseleave", STATE_FILL, () => {
          if (hoveredStateIdRef.current !== undefined) {
            map.setFeatureState({ source: STATE_SOURCE, id: hoveredStateIdRef.current }, { hover: false });
            hoveredStateIdRef.current = undefined;
          }
          if (tierRef.current === "state") {
            map.getCanvas().style.cursor = "";
            if (tooltip) tooltip.style.display = "none";
          }
          type HoverWin = Window & typeof globalThis & { __hfaHoveredState?: string };
          (window as HoverWin).__hfaHoveredState = undefined;
        });

        map.on("click", STATE_FILL, (e: mapboxgl.MapLayerMouseEvent) => {
          if (tierRef.current !== "state") return;
          const feature = e.features?.[0] as mapboxgl.GeoJSONFeature | undefined;
          if (!feature) return;
          const props = (feature.properties ?? {}) as { geoid: string; name: string; isCalifornia: boolean };
          popupRef.current?.remove();
          onStateSelectRef.current(props.geoid ?? "", props.name ?? "");
        });

        // County layer
        map.on("mousemove", COUNTY_FILL, (e: mapboxgl.MapLayerMouseEvent) => {
          if (tierRef.current !== "county") return;
          const feature = e.features?.[0] as mapboxgl.GeoJSONFeature | undefined;
          if (!feature || feature.id == null) return;
          const fid = feature.id as string | number;
          if (hoveredCountyIdRef.current !== undefined && hoveredCountyIdRef.current !== fid) {
            map.setFeatureState({ source: COUNTY_SOURCE, id: hoveredCountyIdRef.current }, { hover: false });
          }
          hoveredCountyIdRef.current = fid;
          map.setFeatureState({ source: COUNTY_SOURCE, id: fid }, { hover: true });
          map.getCanvas().style.cursor = "pointer";
          const props = (feature.properties ?? {}) as { geoid: string; name: string; namelsad: string; hasData: number; avgAqi: number | null };
          if (tooltip) {
            const pt = e.point;
            tooltip.style.display = "block";
            tooltip.style.left = `${pt.x + 14}px`;
            tooltip.style.top = `${pt.y - 12}px`;
            tooltip.innerHTML = countyTooltipHtml(props.namelsad, props.hasData, props.avgAqi);
          }
          type HoverWin = Window & typeof globalThis & { __hfaHoveredCounty?: string };
          (window as HoverWin).__hfaHoveredCounty = props.name;
        });

        map.on("mouseleave", COUNTY_FILL, () => {
          if (hoveredCountyIdRef.current !== undefined) {
            map.setFeatureState({ source: COUNTY_SOURCE, id: hoveredCountyIdRef.current }, { hover: false });
            hoveredCountyIdRef.current = undefined;
          }
          if (tierRef.current === "county") {
            map.getCanvas().style.cursor = "";
            if (tooltip) tooltip.style.display = "none";
          }
          type HoverWin = Window & typeof globalThis & { __hfaHoveredCounty?: string };
          (window as HoverWin).__hfaHoveredCounty = undefined;
        });

        map.on("click", COUNTY_FILL, (e: mapboxgl.MapLayerMouseEvent) => {
          if (tierRef.current !== "county") return;
          const feature = e.features?.[0] as mapboxgl.GeoJSONFeature | undefined;
          if (!feature) return;
          const props = (feature.properties ?? {}) as { geoid: string; name: string; namelsad: string; hasData: number; avgAqi: number | null };
          popupRef.current?.remove();
          onCountySelectRef.current(props.geoid, props.namelsad ?? props.name ?? "");
        });

        // ZIP boundary layer
        map.on("mousemove", ZIP_BOUNDARY_FILL, (e: mapboxgl.MapLayerMouseEvent) => {
          if (tierRef.current !== "zip") return;
          const feature = e.features?.[0] as mapboxgl.GeoJSONFeature | undefined;
          if (!feature || feature.id == null) return;
          const fid = feature.id as string | number;
          if (hoveredZipIdRef.current !== undefined && hoveredZipIdRef.current !== fid) {
            map.setFeatureState({ source: ZIP_BOUNDARY_SOURCE, id: hoveredZipIdRef.current }, { hover: false });
          }
          hoveredZipIdRef.current = fid;
          map.setFeatureState({ source: ZIP_BOUNDARY_SOURCE, id: fid }, { hover: true });
          map.getCanvas().style.cursor = "pointer";
          const props = (feature.properties ?? {}) as { zip: string; town: string | null; aqi: number | null; category: string | null; hasData: number };
          if (tooltip) {
            const pt = e.point;
            tooltip.style.display = "block";
            tooltip.style.left = `${pt.x + 14}px`;
            tooltip.style.top = `${pt.y - 12}px`;
            tooltip.innerHTML = zipTooltipHtml(props.zip, props.town, props.hasData, props.aqi, props.category);
          }
          type HoverWin = Window & typeof globalThis & { __hfaHoveredZip?: string };
          (window as HoverWin).__hfaHoveredZip = props.zip ?? undefined;
        });

        map.on("mouseleave", ZIP_BOUNDARY_FILL, () => {
          if (hoveredZipIdRef.current !== undefined) {
            map.setFeatureState({ source: ZIP_BOUNDARY_SOURCE, id: hoveredZipIdRef.current }, { hover: false });
            hoveredZipIdRef.current = undefined;
          }
          map.getCanvas().style.cursor = "";
          if (tooltip) tooltip.style.display = "none";
          type HoverWin = Window & typeof globalThis & { __hfaHoveredZip?: string };
          (window as HoverWin).__hfaHoveredZip = undefined;
        });

        map.on("click", ZIP_BOUNDARY_FILL, (e: mapboxgl.MapLayerMouseEvent) => {
          const feature = e.features?.[0] as mapboxgl.GeoJSONFeature | undefined;
          if (!feature) return;
          const props = (feature.properties ?? {}) as { zip: string; town: string; aqi: number; category: string; hasData: number };
          if (!props.hasData) return;
          const centroid = ZIP_CENTROIDS[props.zip];
          const lngLat = centroid ? ([centroid[1], centroid[0]] as [number, number]) : e.lngLat;
          popupRef.current?.remove();
          const html = `<div style="font-family:system-ui,sans-serif;padding:10px 12px;min-width:150px;"><div style="font-size:15px;font-weight:700;">${props.zip}</div><div style="font-size:12px;color:#4b5563;margin-bottom:6px;">${props.town ?? ""}</div><div style="font-size:13px;"><b>AQI ${props.aqi}</b> · ${props.category}</div><div style="font-size:11px;color:#2563eb;margin-top:6px;">Click for details →</div></div>`;
          popupRef.current = new mapboxgl.Popup({ closeButton: true, offset: 14 })
            .setLngLat(lngLat).setHTML(html).addTo(map);
          onSelectRef.current(props.zip);
        });

        // ZIP circle layer
        map.on("mouseenter", ZIP_CIRCLE_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", ZIP_CIRCLE_LAYER, () => { map.getCanvas().style.cursor = ""; });
        map.on("click", ZIP_CIRCLE_LAYER, (e: mapboxgl.MapLayerMouseEvent) => {
          const feature = e.features?.[0] as mapboxgl.GeoJSONFeature | undefined;
          if (!feature) return;
          const props = feature.properties as ZipFeatureProps;
          const centroid = ZIP_CENTROIDS[props.zip];
          if (!centroid) return;
          const [lat, lon] = centroid;
          popupRef.current?.remove();
          const html = `<div style="font-family:system-ui,sans-serif;padding:10px 12px;min-width:150px;"><div style="font-size:15px;font-weight:700;">${props.zip}</div><div style="font-size:12px;color:#4b5563;margin-bottom:6px;">${props.town ?? ""}</div><div style="font-size:13px;"><b>AQI ${props.aqi}</b> · ${props.category}</div><div style="font-size:11px;color:#2563eb;margin-top:6px;">Click for details →</div></div>`;
          popupRef.current = new mapboxgl.Popup({ closeButton: true, offset: 14 })
            .setLngLat([lon, lat]).setHTML(html).addTo(map);
          onSelectRef.current(props.zip);
        });

        // ── Populate with data that arrived before map was ready ────────
        syncPoints();
        if (stateBoundariesRef.current) syncStateBoundaries();
        if (countyBoundariesRef.current) syncCountyBoundaries();
        if (boundariesRef.current) syncZipBoundaries();
      });
    });

    return () => {
      isDestroyed = true;
      cancelAnimationFrame(rafId);
      ro?.disconnect();
      tooltipRef.current?.remove();
      tooltipRef.current = null;
      type CleanWin = Window & typeof globalThis & {
        __hfaProjectLngLat?: unknown; __hfaMap?: unknown;
        __hfaTier?: unknown; __hfaZipNowLoaded?: unknown;
        __hfaBoundariesLoaded?: unknown; __hfaCountyBoundariesLoaded?: unknown;
        __hfaStateBoundariesLoaded?: unknown;
        __hfaHoveredState?: unknown; __hfaHoveredCounty?: unknown; __hfaHoveredZip?: unknown;
      };
      const cw = window as CleanWin;
      cw.__hfaProjectLngLat = undefined;
      cw.__hfaMap = undefined;
      cw.__hfaTier = undefined;
      cw.__hfaZipNowLoaded = undefined;
      cw.__hfaBoundariesLoaded = undefined;
      cw.__hfaCountyBoundariesLoaded = undefined;
      cw.__hfaStateBoundariesLoaded = undefined;
      cw.__hfaHoveredState = undefined;
      cw.__hfaHoveredCounty = undefined;
      cw.__hfaHoveredZip = undefined;
      popupRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync ZIP data on change ─────────────────────────────────────────────
  useEffect(() => {
    syncPoints();
    if (boundariesRef.current) syncZipBoundaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // ── Sync boundaries when they arrive ───────────────────────────────────
  useEffect(() => {
    if (boundaries) syncZipBoundaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundaries]);

  useEffect(() => {
    if (countyBoundaries) syncCountyBoundaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countyBoundaries]);

  useEffect(() => {
    if (stateBoundaries) syncStateBoundaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateBoundaries]);

  // ── Re-color state/county layers when AQI data changes ─────────────────
  useEffect(() => {
    if (countyBoundariesRef.current) syncCountyBoundaries();
    if (stateBoundariesRef.current) syncStateBoundaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresnoAvgAqi]);

  // ── Apply tier styling + clear stale hover when tier changes ───────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    // Clear any hover state from the previous tier
    if (hoveredStateIdRef.current !== undefined) {
      map.setFeatureState({ source: STATE_SOURCE, id: hoveredStateIdRef.current }, { hover: false });
      hoveredStateIdRef.current = undefined;
    }
    if (hoveredCountyIdRef.current !== undefined) {
      map.setFeatureState({ source: COUNTY_SOURCE, id: hoveredCountyIdRef.current }, { hover: false });
      hoveredCountyIdRef.current = undefined;
    }
    if (hoveredZipIdRef.current !== undefined) {
      map.setFeatureState({ source: ZIP_BOUNDARY_SOURCE, id: hoveredZipIdRef.current }, { hover: false });
      hoveredZipIdRef.current = undefined;
    }
    if (tooltipRef.current) tooltipRef.current.style.display = "none";
    map.getCanvas().style.cursor = "";

    applyTierStyling(map, tier);
    type TierWin = Window & typeof globalThis & { __hfaTier?: MapTier };
    (window as TierWin).__hfaTier = tier;
  }, [tier]);

  return <div ref={containerRef} className="h-full w-full" />;
});

export default MapView;
