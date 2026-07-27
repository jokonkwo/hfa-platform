"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import * as maplibregl from "maplibre-gl";
import type {
  GeoJSONSource,
  MapGeoJSONFeature,
} from "maplibre-gl";
import type { ZipNow } from "@/lib/types";
import { categoryColor } from "@/lib/aqi";
import {
  ZIP_CENTROIDS,
  FRESNO_CENTER,
  FRESNO_ZOOM,
} from "@/lib/zipCentroids";

const CARTO_VOYAGER_STYLE =
  "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";

// MapLibre v6 derives its worker URL from the absolute bundle path, which
// Next.js cannot serve. Point it at the copy we placed in public/ instead.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

const SOURCE_ID = "zips";
const LAYER_ID = "zip-circles";
const BOUNDARY_SOURCE_ID = "zip-boundaries";
const BOUNDARY_FILL_ID = "zip-boundary-fill";
const BOUNDARY_OUTLINE_ID = "zip-boundary-outline";

export interface MapViewHandle {
  flyToZip: (zip: string) => void;
}

// Accepts raw GeoJSON from GET /v1/zips/boundaries
export type BoundaryCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  { ZCTA5: string }
>;

interface MapViewProps {
  data: ZipNow[];
  boundaries: BoundaryCollection | null;
  onSelectZip: (zip: string) => void;
}

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
    if (!centroid) {
      console.warn(`[MapView] no centroid for ZIP ${row.zip} — skipping marker`);
      continue;
    }
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

// Join boundary polygons with current AQI data so each polygon carries a color.
// ZIPs with no current data are given opacity 0 via color "transparent".
function buildBoundaryGeoJSON(
  boundaries: BoundaryCollection,
  data: ZipNow[],
): GeoJSON.FeatureCollection {
  const aqiByZip = new Map(data.map((r) => [r.zip, r]));
  const features: GeoJSON.Feature[] = boundaries.features.map((ft) => {
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
  });
  return { type: "FeatureCollection", features };
}

const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { data, boundaries, onSelectZip },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const readyRef = useRef(false);
  const dataRef = useRef<ZipNow[]>(data);
  const boundariesRef = useRef<BoundaryCollection | null>(boundaries);
  const onSelectRef = useRef(onSelectZip);

  dataRef.current = data;
  boundariesRef.current = boundaries;
  onSelectRef.current = onSelectZip;

  useImperativeHandle(ref, () => ({
    flyToZip(zip: string) {
      const centroid = ZIP_CENTROIDS[zip];
      const map = mapRef.current;
      if (!centroid || !map) return;
      const [lat, lon] = centroid;
      map.flyTo({ center: [lon, lat], zoom: 12, duration: 450 });
    },
  }));

  const syncPoints = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (src) src.setData(buildPointGeoJSON(dataRef.current));
  };

  const syncBoundaries = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const bounds = boundariesRef.current;
    if (!bounds) return;
    const src = map.getSource(BOUNDARY_SOURCE_ID) as GeoJSONSource | undefined;
    if (src) {
      src.setData(buildBoundaryGeoJSON(bounds, dataRef.current));
    } else {
      // First time boundaries arrive — add source + layers + interaction handlers.
      // generateId: true assigns stable numeric IDs needed for setFeatureState hover.
      map.addSource(BOUNDARY_SOURCE_ID, {
        type: "geojson",
        data: buildBoundaryGeoJSON(bounds, dataRef.current),
        generateId: true,
      });
      // Signal for test automation: boundaries are added to the map.
      type BoundaryWindow = Window & typeof globalThis & { __hfaBoundariesLoaded?: boolean };
      (window as BoundaryWindow).__hfaBoundariesLoaded = true;
      map.addLayer(
        {
          id: BOUNDARY_FILL_ID,
          type: "fill",
          source: BOUNDARY_SOURCE_ID,
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
        },
        LAYER_ID,
      );
      map.addLayer(
        {
          id: BOUNDARY_OUTLINE_ID,
          type: "line",
          source: BOUNDARY_SOURCE_ID,
          paint: {
            "line-color": ["get", "color"],
            "line-width": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              2.5,
              1.5,
            ],
            "line-opacity": [
              "case",
              ["==", ["get", "hasData"], 1],
              0.7,
              0.2,
            ],
          },
        },
        LAYER_ID,
      );

      let hoveredFeatureId: string | number | null = null;
      const tooltip = tooltipRef.current;
      type HoverWindow = Window & typeof globalThis & { __hfaHoveredZip?: string };

      // Cursor-following tooltip on mousemove (distinct from click popup).
      map.on("mousemove", BOUNDARY_FILL_ID, (e: maplibregl.MapLayerMouseEvent) => {
        const feature = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (!feature || feature.id === undefined) return;

        if (hoveredFeatureId !== null && hoveredFeatureId !== feature.id) {
          map.setFeatureState(
            { source: BOUNDARY_SOURCE_ID, id: hoveredFeatureId },
            { hover: false },
          );
        }
        hoveredFeatureId = feature.id;
        map.setFeatureState(
          { source: BOUNDARY_SOURCE_ID, id: hoveredFeatureId },
          { hover: true },
        );
        map.getCanvas().style.cursor = "pointer";

        const props = feature.properties as {
          zip: string;
          town: string;
          aqi: number | null;
          category: string | null;
          hasData: number;
        };

        if (tooltip) {
          if (props.hasData) {
            const pt = e.point;
            tooltip.style.display = "block";
            tooltip.style.left = `${pt.x + 14}px`;
            tooltip.style.top = `${pt.y - 12}px`;
            tooltip.innerHTML = `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:7px 10px;background:#fff;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.15);border:1px solid #e5e7eb;white-space:nowrap;"><span style="font-weight:700">${props.zip}</span><span style="color:#6b7280;margin-left:4px">${props.town ?? ""}</span><br/><span style="font-weight:600">AQI ${props.aqi}</span><span style="color:#6b7280"> · ${props.category ?? ""}</span></div>`;
          } else {
            tooltip.style.display = "none";
          }
        }
        (window as HoverWindow).__hfaHoveredZip = props.hasData ? props.zip : undefined;
      });

      map.on("mouseleave", BOUNDARY_FILL_ID, () => {
        if (hoveredFeatureId !== null) {
          map.setFeatureState(
            { source: BOUNDARY_SOURCE_ID, id: hoveredFeatureId },
            { hover: false },
          );
          hoveredFeatureId = null;
        }
        map.getCanvas().style.cursor = "";
        if (tooltip) tooltip.style.display = "none";
        (window as HoverWindow).__hfaHoveredZip = undefined;
      });

      map.on("click", BOUNDARY_FILL_ID, (e: maplibregl.MapLayerMouseEvent) => {
        const feature = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (!feature) return;
        const props = feature.properties as {
          zip: string;
          town: string;
          aqi: number;
          category: string;
          hasData: number;
        };
        if (!props.hasData) return;
        const centroid = ZIP_CENTROIDS[props.zip];
        const lngLat = centroid
          ? ([centroid[1], centroid[0]] as [number, number])
          : e.lngLat;

        popupRef.current?.remove();
        const html = `
          <div style="font-family: system-ui, sans-serif; padding: 10px 12px; min-width: 150px;">
            <div style="font-size: 15px; font-weight: 700;">${props.zip}</div>
            <div style="font-size: 12px; color: #4b5563; margin-bottom: 6px;">${props.town ?? ""}</div>
            <div style="font-size: 13px;"><b>AQI ${props.aqi}</b> · ${props.category}</div>
            <div style="font-size: 11px; color: #2563eb; margin-top: 6px;">Click for details →</div>
          </div>`;
        popupRef.current = new maplibregl.Popup({ closeButton: true, offset: 14 })
          .setLngLat(lngLat)
          .setHTML(html)
          .addTo(map);

        onSelectRef.current(props.zip);
      });
    }
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const container = containerRef.current;
    let isDestroyed = false;
    let ro: ResizeObserver | null = null;

    // Defer map construction until after the browser's first layout pass so
    // that the flex container has resolved its dimensions before MapLibre reads
    // them to size the WebGL canvas.
    const rafId = requestAnimationFrame(() => {
      if (isDestroyed || mapRef.current) return;

      const map = new maplibregl.Map({
        container,
        style: CARTO_VOYAGER_STYLE,
        center: FRESNO_CENTER,
        zoom: FRESNO_ZOOM,
        attributionControl: { compact: true },
        // Preserves the WebGL back buffer so readPixels works in automated tests.
        // Headless Chrome clears the buffer after each frame without this.
        canvasContextAttributes: { preserveDrawingBuffer: true },
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl(), "top-left");

      // Tooltip element: follows cursor on boundary hover, hidden by default.
      const tooltipEl = document.createElement("div");
      tooltipEl.id = "hfa-hover-tooltip";
      tooltipEl.style.cssText =
        "position:absolute;z-index:10;display:none;pointer-events:none;top:0;left:0";
      container.appendChild(tooltipEl);
      tooltipRef.current = tooltipEl;

      // Redraw canvas whenever the container changes size (handles flex layout
      // settling after initial render).
      ro = new ResizeObserver(() => { mapRef.current?.resize(); });
      ro.observe(container);

      map.on("load", () => {
        // Expose to test automation — 'load' fires reliably even in headless environments.
        type TestWindow = Window & typeof globalThis & {
          __hfaMapLoaded?: boolean;
          __hfaMap?: maplibregl.Map;
          __hfaProjectLngLat?: (lng: number, lat: number) => { x: number; y: number };
        };
        const tw = window as TestWindow;
        tw.__hfaMapLoaded = true;
        tw.__hfaMap = map;
        tw.__hfaProjectLngLat = (lng, lat) => map.project([lng, lat]);
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: buildPointGeoJSON(dataRef.current),
        });
        map.addLayer({
          id: LAYER_ID,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8, 6,
              12, 10,
            ],
            "circle-color": ["get", "color"],
            "circle-opacity": 0.9,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
          },
        });
        readyRef.current = true;

        map.on("mouseenter", LAYER_ID, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", LAYER_ID, () => {
          map.getCanvas().style.cursor = "";
        });

        map.on("click", LAYER_ID, (e: maplibregl.MapLayerMouseEvent) => {
          const feature = e.features?.[0] as MapGeoJSONFeature | undefined;
          if (!feature) return;
          const props = feature.properties as ZipFeatureProps;
          const zip = props.zip;
          const centroid = ZIP_CENTROIDS[zip];
          if (!centroid) return;
          const [lat, lon] = centroid;

          popupRef.current?.remove();
          const html = `
            <div style="font-family: system-ui, sans-serif; padding: 10px 12px; min-width: 150px;">
              <div style="font-size: 15px; font-weight: 700;">${props.zip}</div>
              <div style="font-size: 12px; color: #4b5563; margin-bottom: 6px;">${props.town ?? ""}</div>
              <div style="font-size: 13px;"><b>AQI ${props.aqi}</b> · ${props.category}</div>
              <div style="font-size: 11px; color: #2563eb; margin-top: 6px;">Click for details →</div>
            </div>`;
          popupRef.current = new maplibregl.Popup({ closeButton: true, offset: 14 })
            .setLngLat([lon, lat])
            .setHTML(html)
            .addTo(map);

          onSelectRef.current(zip);
        });

        if (boundariesRef.current) syncBoundaries();
      });
    });

    return () => {
      isDestroyed = true;
      cancelAnimationFrame(rafId);
      ro?.disconnect();
      tooltipRef.current?.remove();
      tooltipRef.current = null;
      type CleanWindow = Window & typeof globalThis & { __hfaProjectLngLat?: unknown; __hfaMap?: unknown };
      (window as CleanWindow).__hfaProjectLngLat = undefined;
      (window as CleanWindow).__hfaMap = undefined;
      popupRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync point data when AQI data changes.
  useEffect(() => {
    syncPoints();
    // Also re-color boundaries when data/filter changes.
    if (boundariesRef.current) syncBoundaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Sync boundaries when they first arrive (async fetch).
  useEffect(() => {
    if (boundaries) syncBoundaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundaries]);

  return <div ref={containerRef} className="h-full w-full" />;
});

export default MapView;
