"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import type * as GeoJSON from "geojson";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import mapboxgl from "mapbox-gl";
import type { ZipNow } from "@/lib/types";
import { categoryColor, aqiToCategory } from "@/lib/aqi";
import {
  ZIP_CENTROIDS,
  FRESNO_CENTER,
  FRESNO_ZOOM,
} from "@/lib/zipCentroids";
import type { MapTier } from "@/components/TierControl";

const MAPBOX_OUTDOORS_STYLE = "mapbox://styles/mapbox/outdoors-v12";

// California view for county tier
const CA_CENTER: [number, number] = [-119.5, 37.2]; // [lng, lat]
const CA_ZOOM = 5;

const FRESNO_COUNTY_GEOID = "06019";

// ── Source / layer IDs ─────────────────────────────────────────────────────

const ZIP_CIRCLE_SOURCE = "zips";
const ZIP_CIRCLE_LAYER = "zip-circles";
const ZIP_BOUNDARY_SOURCE = "zip-boundaries";
const ZIP_BOUNDARY_FILL = "zip-boundary-fill";
const ZIP_BOUNDARY_OUTLINE = "zip-boundary-outline";

const COUNTY_SOURCE = "county-boundaries";
const COUNTY_FILL = "county-boundary-fill";
const COUNTY_OUTLINE = "county-boundary-outline";

// ── Exported types ─────────────────────────────────────────────────────────

export interface MapViewHandle {
  flyToZip: (zip: string) => void;
  flyToFresno: () => void;
  flyToCA: () => void;
}

export type BoundaryCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  { ZCTA5: string }
>;

export type CountyBoundaryCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  { GEOID: string; NAME: string; NAMELSAD: string }
>;

// ── GeoJSON builders ───────────────────────────────────────────────────────

type ZipFeatureProps = {
  zip: string;
  town: string;
  aqi: number;
  category: string;
  color: string;
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
        zip: row.zip,
        town: row.town,
        aqi: row.aqi,
        category: row.category,
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
          properties: {
            geoid,
            name,
            namelsad,
            color,
            hasData: isFresno ? 1 : 0,
            avgAqi,
          },
        };
      },
    ),
  };
}

// ── MapView ────────────────────────────────────────────────────────────────

interface MapViewProps {
  data: ZipNow[];
  boundaries: BoundaryCollection | null;
  countyBoundaries: CountyBoundaryCollection | null;
  tier: MapTier;
  fresnoAvgAqi: number | null;
  onSelectZip: (zip: string) => void;
  onCountyClick: (geoid: string) => void;
}

function setLayerVisibility(
  map: mapboxgl.Map,
  layerId: string,
  visible: boolean,
) {
  if (map.getLayer(layerId)) {
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  }
}

function applyTierVisibility(map: mapboxgl.Map, tier: MapTier) {
  const zipVisible = tier === "zip";
  const countyVisible = tier === "county";
  setLayerVisibility(map, ZIP_CIRCLE_LAYER, zipVisible);
  setLayerVisibility(map, ZIP_BOUNDARY_FILL, zipVisible);
  setLayerVisibility(map, ZIP_BOUNDARY_OUTLINE, zipVisible);
  setLayerVisibility(map, COUNTY_FILL, countyVisible);
  setLayerVisibility(map, COUNTY_OUTLINE, countyVisible);
}

const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { data, boundaries, countyBoundaries, tier, fresnoAvgAqi, onSelectZip, onCountyClick },
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
  const tierRef = useRef<MapTier>(tier);
  const fresnoAvgAqiRef = useRef<number | null>(fresnoAvgAqi);
  const onSelectRef = useRef(onSelectZip);
  const onCountyClickRef = useRef(onCountyClick);

  dataRef.current = data;
  boundariesRef.current = boundaries;
  countyBoundariesRef.current = countyBoundaries;
  tierRef.current = tier;
  fresnoAvgAqiRef.current = fresnoAvgAqi;
  onSelectRef.current = onSelectZip;
  onCountyClickRef.current = onCountyClick;

  useImperativeHandle(ref, () => ({
    flyToZip(zip: string) {
      const centroid = ZIP_CENTROIDS[zip];
      const map = mapRef.current;
      if (!centroid || !map) return;
      const [lat, lon] = centroid;
      map.flyTo({ center: [lon, lat], zoom: 12, duration: 450 });
    },
    flyToFresno() {
      mapRef.current?.flyTo({ center: FRESNO_CENTER, zoom: FRESNO_ZOOM, duration: 600 });
    },
    flyToCA() {
      mapRef.current?.flyTo({ center: CA_CENTER, zoom: CA_ZOOM, duration: 700 });
    },
  }));

  // ── County layer management ──────────────────────────────────────────────

  const syncCountyBoundaries = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const bounds = countyBoundariesRef.current;
    if (!bounds) return;
    const countyData = buildCountyGeoJSON(bounds, fresnoAvgAqiRef.current);

    const src = map.getSource(COUNTY_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (src) {
      src.setData(countyData);
      return;
    }

    // First time — add source + layers
    map.addSource(COUNTY_SOURCE, {
      type: "geojson",
      data: countyData,
      generateId: true,
    });

    map.addLayer(
      {
        id: COUNTY_FILL,
        type: "fill",
        source: COUNTY_SOURCE,
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.65,
            ["==", ["get", "hasData"], 1],
            0.4,
            0.1,
          ],
        },
        layout: { visibility: tierRef.current === "county" ? "visible" : "none" },
      },
      ZIP_CIRCLE_LAYER,
    );
    map.addLayer(
      {
        id: COUNTY_OUTLINE,
        type: "line",
        source: COUNTY_SOURCE,
        paint: {
          "line-color": "#111111",
          "line-width": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            3.0,
            1.8,
          ],
          "line-opacity": [
            "case",
            ["==", ["get", "hasData"], 1],
            0.9,
            0.3,
          ],
        },
        layout: { visibility: tierRef.current === "county" ? "visible" : "none" },
      },
      ZIP_CIRCLE_LAYER,
    );

    // Hover state
    let hoveredCountyId: string | number | undefined;
    const tooltip = tooltipRef.current;

    map.on("mousemove", COUNTY_FILL, (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0] as mapboxgl.GeoJSONFeature | undefined;
      if (!feature || feature.id == null) return;
      const featureId = feature.id as string | number;

      if (hoveredCountyId !== undefined && hoveredCountyId !== featureId) {
        map.setFeatureState({ source: COUNTY_SOURCE, id: hoveredCountyId }, { hover: false });
      }
      hoveredCountyId = featureId;
      map.setFeatureState({ source: COUNTY_SOURCE, id: hoveredCountyId }, { hover: true });
      map.getCanvas().style.cursor = "pointer";

      const props = (feature as mapboxgl.GeoJSONFeature & {
        properties: {
          geoid: string;
          name: string;
          namelsad: string;
          hasData: number;
          avgAqi: number | null;
        };
      }).properties;

      if (tooltip) {
        const pt = e.point;
        tooltip.style.display = "block";
        tooltip.style.left = `${pt.x + 14}px`;
        tooltip.style.top = `${pt.y - 12}px`;
        if (props?.hasData) {
          tooltip.innerHTML = `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:7px 10px;background:#fff;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.15);border:1px solid #e5e7eb;white-space:nowrap;"><span style="font-weight:700">${props.namelsad}</span><br/><span style="font-weight:600">Avg AQI ${props.avgAqi ?? "—"}</span><span style="color:#6b7280"> across pilot ZIPs</span><br/><span style="font-size:11px;color:#2563eb">Click to explore ZIPs →</span></div>`;
        } else {
          tooltip.innerHTML = `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:7px 10px;background:#fff;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.15);border:1px solid #e5e7eb;white-space:nowrap;"><span style="font-weight:700">${props.namelsad}</span><br/><span style="color:#9ca3af">No sensor data yet</span></div>`;
        }
      }

      type HoverWin = Window & typeof globalThis & { __hfaHoveredCounty?: string };
      (window as HoverWin).__hfaHoveredCounty = props?.name;
    });

    map.on("mouseleave", COUNTY_FILL, () => {
      if (hoveredCountyId !== undefined) {
        map.setFeatureState({ source: COUNTY_SOURCE, id: hoveredCountyId }, { hover: false });
        hoveredCountyId = undefined;
      }
      map.getCanvas().style.cursor = "";
      if (tooltip) tooltip.style.display = "none";
      type HoverWin = Window & typeof globalThis & { __hfaHoveredCounty?: string };
      (window as HoverWin).__hfaHoveredCounty = undefined;
    });

    map.on("click", COUNTY_FILL, (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0] as mapboxgl.GeoJSONFeature | undefined;
      if (!feature) return;
      const props = (feature as mapboxgl.GeoJSONFeature & {
        properties: { geoid: string; name: string; namelsad: string; hasData: number; avgAqi: number | null };
      }).properties;

      popupRef.current?.remove();

      if (props?.hasData) {
        // Fresno county → delegate to page.tsx to switch tier
        onCountyClickRef.current(props.geoid);
      } else {
        // Other county → show no-data popup at click location
        const html = `
          <div style="font-family:system-ui,sans-serif;padding:10px 12px;min-width:180px;">
            <div style="font-size:15px;font-weight:700;">${props.namelsad}</div>
            <div style="font-size:12px;color:#4b5563;margin-top:4px;">No sensor data available yet.</div>
            <div style="font-size:11px;color:#6b7280;margin-top:6px;line-height:1.4;">Fresno County is the current pilot area. Other CA counties will be added as the program expands.</div>
          </div>`;
        popupRef.current = new mapboxgl.Popup({ closeButton: true, offset: 14 })
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(map);
      }
    });

    // Signal for test automation
    type BoundaryWindow = Window & typeof globalThis & { __hfaCountyBoundariesLoaded?: boolean };
    (window as BoundaryWindow).__hfaCountyBoundariesLoaded = true;
  };

  // ── ZIP layer management ─────────────────────────────────────────────────

  const syncPoints = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource(ZIP_CIRCLE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(buildPointGeoJSON(dataRef.current));
  };

  const syncZipBoundaries = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const bounds = boundariesRef.current;
    if (!bounds) return;
    const boundaryData = buildZipBoundaryGeoJSON(bounds, dataRef.current);

    const src = map.getSource(ZIP_BOUNDARY_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (src) {
      src.setData(boundaryData);
      return;
    }

    map.addSource(ZIP_BOUNDARY_SOURCE, {
      type: "geojson",
      data: boundaryData,
      generateId: true,
    });
    type BoundaryWindow = Window & typeof globalThis & { __hfaBoundariesLoaded?: boolean };
    (window as BoundaryWindow).__hfaBoundariesLoaded = true;

    map.addLayer(
      {
        id: ZIP_BOUNDARY_FILL,
        type: "fill",
        source: ZIP_BOUNDARY_SOURCE,
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.6,
            ["==", ["get", "hasData"], 1],
            0.35,
            0.08,
          ],
        },
        layout: { visibility: tierRef.current === "zip" ? "visible" : "none" },
      },
      ZIP_CIRCLE_LAYER,
    );
    map.addLayer(
      {
        id: ZIP_BOUNDARY_OUTLINE,
        type: "line",
        source: ZIP_BOUNDARY_SOURCE,
        paint: {
          "line-color": "#111111",
          "line-width": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            3.5,
            2.5,
          ],
          "line-opacity": [
            "case",
            ["==", ["get", "hasData"], 1],
            0.9,
            0.35,
          ],
        },
        layout: { visibility: tierRef.current === "zip" ? "visible" : "none" },
      },
      ZIP_CIRCLE_LAYER,
    );

    let hoveredFeatureId: string | number | undefined;
    const tooltip = tooltipRef.current;
    type HoverWindow = Window & typeof globalThis & { __hfaHoveredZip?: string };

    map.on("mousemove", ZIP_BOUNDARY_FILL, (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0] as mapboxgl.GeoJSONFeature | undefined;
      if (!feature || feature.id == null) return;
      const featureId = feature.id as string | number;
      if (hoveredFeatureId !== undefined && hoveredFeatureId !== featureId) {
        map.setFeatureState({ source: ZIP_BOUNDARY_SOURCE, id: hoveredFeatureId }, { hover: false });
      }
      hoveredFeatureId = featureId;
      map.setFeatureState({ source: ZIP_BOUNDARY_SOURCE, id: hoveredFeatureId }, { hover: true });
      map.getCanvas().style.cursor = "pointer";

      const props = (feature as mapboxgl.GeoJSONFeature & {
        properties: { zip: string; town: string; aqi: number | null; category: string | null; hasData: number };
      }).properties;

      if (tooltip) {
        if (props?.hasData) {
          const pt = e.point;
          tooltip.style.display = "block";
          tooltip.style.left = `${pt.x + 14}px`;
          tooltip.style.top = `${pt.y - 12}px`;
          tooltip.innerHTML = `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:7px 10px;background:#fff;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.15);border:1px solid #e5e7eb;white-space:nowrap;"><span style="font-weight:700">${props.zip}</span><span style="color:#6b7280;margin-left:4px">${props.town ?? ""}</span><br/><span style="font-weight:600">AQI ${props.aqi}</span><span style="color:#6b7280"> · ${props.category ?? ""}</span></div>`;
        } else {
          tooltip.style.display = "none";
        }
      }
      (window as HoverWindow).__hfaHoveredZip = props?.hasData ? props.zip : undefined;
    });

    map.on("mouseleave", ZIP_BOUNDARY_FILL, () => {
      if (hoveredFeatureId !== undefined) {
        map.setFeatureState({ source: ZIP_BOUNDARY_SOURCE, id: hoveredFeatureId }, { hover: false });
        hoveredFeatureId = undefined;
      }
      map.getCanvas().style.cursor = "";
      if (tooltip) tooltip.style.display = "none";
      (window as HoverWindow).__hfaHoveredZip = undefined;
    });

    map.on("click", ZIP_BOUNDARY_FILL, (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0] as mapboxgl.GeoJSONFeature | undefined;
      if (!feature) return;
      const props = (feature as mapboxgl.GeoJSONFeature & {
        properties: { zip: string; town: string; aqi: number; category: string; hasData: number };
      }).properties;
      if (!props?.hasData) return;
      const centroid = ZIP_CENTROIDS[props.zip];
      const lngLat = centroid ? ([centroid[1], centroid[0]] as [number, number]) : e.lngLat;

      popupRef.current?.remove();
      const html = `
        <div style="font-family:system-ui,sans-serif;padding:10px 12px;min-width:150px;">
          <div style="font-size:15px;font-weight:700;">${props.zip}</div>
          <div style="font-size:12px;color:#4b5563;margin-bottom:6px;">${props.town ?? ""}</div>
          <div style="font-size:13px;"><b>AQI ${props.aqi}</b> · ${props.category}</div>
          <div style="font-size:11px;color:#2563eb;margin-top:6px;">Click for details →</div>
        </div>`;
      popupRef.current = new mapboxgl.Popup({ closeButton: true, offset: 14 })
        .setLngLat(lngLat)
        .setHTML(html)
        .addTo(map);
      onSelectRef.current(props.zip);
    });
  };

  // ── Map initialisation ───────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const container = containerRef.current;
    let isDestroyed = false;
    let ro: ResizeObserver | null = null;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      throw new Error("[HFA] NEXT_PUBLIC_MAPBOX_TOKEN is not set.");
    }

    const rafId = requestAnimationFrame(() => {
      if (isDestroyed || mapRef.current) return;

      // Start at CA view when default tier is county
      const initCenter = tierRef.current === "county" ? CA_CENTER : FRESNO_CENTER;
      const initZoom = tierRef.current === "county" ? CA_ZOOM : FRESNO_ZOOM;

      const map = new mapboxgl.Map({
        accessToken: token,
        container,
        style: MAPBOX_OUTDOORS_STYLE,
        center: initCenter,
        zoom: initZoom,
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
        type TestWindow = Window & typeof globalThis & {
          __hfaMapLoaded?: boolean;
          __hfaMap?: mapboxgl.Map;
          __hfaProjectLngLat?: (lng: number, lat: number) => { x: number; y: number };
          __hfaTier?: MapTier;
        };
        const tw = window as TestWindow;
        tw.__hfaMapLoaded = true;
        tw.__hfaMap = map;
        tw.__hfaProjectLngLat = (lng, lat) => map.project([lng, lat]);
        tw.__hfaTier = tierRef.current;

        map.addSource(ZIP_CIRCLE_SOURCE, {
          type: "geojson",
          data: buildPointGeoJSON(dataRef.current),
        });
        map.addLayer({
          id: ZIP_CIRCLE_LAYER,
          type: "circle",
          source: ZIP_CIRCLE_SOURCE,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 6, 12, 10],
            "circle-color": ["get", "color"],
            "circle-opacity": 0.9,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
          },
          layout: { visibility: tierRef.current === "zip" ? "visible" : "none" },
        });
        readyRef.current = true;

        map.on("mouseenter", ZIP_CIRCLE_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", ZIP_CIRCLE_LAYER, () => { map.getCanvas().style.cursor = ""; });

        map.on("click", ZIP_CIRCLE_LAYER, (e: mapboxgl.MapLayerMouseEvent) => {
          const feature = e.features?.[0] as mapboxgl.GeoJSONFeature | undefined;
          if (!feature) return;
          const props = feature.properties as ZipFeatureProps;
          const zip = props.zip;
          const centroid = ZIP_CENTROIDS[zip];
          if (!centroid) return;
          const [lat, lon] = centroid;

          popupRef.current?.remove();
          const html = `
            <div style="font-family:system-ui,sans-serif;padding:10px 12px;min-width:150px;">
              <div style="font-size:15px;font-weight:700;">${props.zip}</div>
              <div style="font-size:12px;color:#4b5563;margin-bottom:6px;">${props.town ?? ""}</div>
              <div style="font-size:13px;"><b>AQI ${props.aqi}</b> · ${props.category}</div>
              <div style="font-size:11px;color:#2563eb;margin-top:6px;">Click for details →</div>
            </div>`;
          popupRef.current = new mapboxgl.Popup({ closeButton: true, offset: 14 })
            .setLngLat([lon, lat])
            .setHTML(html)
            .addTo(map);
          onSelectRef.current(zip);
        });

        if (boundariesRef.current) syncZipBoundaries();
        if (countyBoundariesRef.current) syncCountyBoundaries();
      });
    });

    return () => {
      isDestroyed = true;
      cancelAnimationFrame(rafId);
      ro?.disconnect();
      tooltipRef.current?.remove();
      tooltipRef.current = null;
      type CleanWindow = Window & typeof globalThis & {
        __hfaProjectLngLat?: unknown;
        __hfaMap?: unknown;
        __hfaTier?: unknown;
      };
      (window as CleanWindow).__hfaProjectLngLat = undefined;
      (window as CleanWindow).__hfaMap = undefined;
      (window as CleanWindow).__hfaTier = undefined;
      popupRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync ZIP data on change
  useEffect(() => {
    syncPoints();
    if (boundariesRef.current) syncZipBoundaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Sync ZIP boundaries when they arrive
  useEffect(() => {
    if (boundaries) syncZipBoundaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundaries]);

  // Sync county boundaries when they arrive
  useEffect(() => {
    if (countyBoundaries) syncCountyBoundaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countyBoundaries]);

  // Update county data when fresnoAvgAqi changes (data has loaded)
  useEffect(() => {
    if (countyBoundariesRef.current) syncCountyBoundaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresnoAvgAqi]);

  // Apply layer visibility + camera when tier changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyTierVisibility(map, tier);
    // Update tier for test automation
    type TierWin = Window & typeof globalThis & { __hfaTier?: MapTier };
    (window as TierWin).__hfaTier = tier;
  }, [tier]);

  return (
    <div ref={containerRef} className="h-full w-full" />
  );
});

export default MapView;
