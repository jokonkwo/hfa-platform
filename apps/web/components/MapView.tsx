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
  StyleSpecification,
} from "maplibre-gl";
import type { ZipNow } from "@/lib/types";
import { categoryColor } from "@/lib/aqi";
import {
  ZIP_CENTROIDS,
  FRESNO_CENTER,
  FRESNO_ZOOM,
} from "@/lib/zipCentroids";

const SOURCE_ID = "zips";
const LAYER_ID = "zip-circles";

// Minimal MapLibre style using free OSM raster tiles.
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
    },
  ],
};

export interface MapViewHandle {
  flyToZip: (zip: string) => void;
}

interface MapViewProps {
  // ZIPs already filtered by the active AQI range.
  data: ZipNow[];
  onSelectZip: (zip: string) => void;
}

type ZipFeatureProps = {
  zip: string;
  town: string;
  aqi: number;
  category: string;
  color: string;
};

function buildGeoJSON(
  data: ZipNow[],
): GeoJSON.FeatureCollection<GeoJSON.Point, ZipFeatureProps> {
  const features: GeoJSON.Feature<GeoJSON.Point, ZipFeatureProps>[] = [];
  for (const row of data) {
    const centroid = ZIP_CENTROIDS[row.zip];
    if (!centroid) {
      console.warn(
        `[MapView] no centroid for ZIP ${row.zip} — skipping marker`,
      );
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

const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { data, onSelectZip },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const readyRef = useRef(false);
  const dataRef = useRef<ZipNow[]>(data);
  const onSelectRef = useRef(onSelectZip);

  dataRef.current = data;
  onSelectRef.current = onSelectZip;

  useImperativeHandle(ref, () => ({
    flyToZip(zip: string) {
      const centroid = ZIP_CENTROIDS[zip];
      const map = mapRef.current;
      if (!centroid || !map) return;
      const [lat, lon] = centroid;
      map.flyTo({ center: [lon, lat], zoom: 12, duration: 900 });
    },
  }));

  // Update the source data whenever `data` changes.
  const syncData = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (src) src.setData(buildGeoJSON(dataRef.current));
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: FRESNO_CENTER,
      zoom: FRESNO_ZOOM,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-left");

    map.on("load", () => {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: buildGeoJSON(dataRef.current),
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
            8,
            7,
            12,
            14,
          ],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.85,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#1f2937",
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

        // Tier-1 tooltip
        popupRef.current?.remove();
        const html = `
          <div style="font-family: system-ui, sans-serif; padding: 10px 12px; min-width: 150px;">
            <div style="font-size: 15px; font-weight: 700;">${props.zip}</div>
            <div style="font-size: 12px; color: #4b5563; margin-bottom: 6px;">${props.town ?? ""}</div>
            <div style="font-size: 13px;"><b>AQI ${props.aqi}</b> · ${props.category}</div>
            <div style="font-size: 11px; color: #2563eb; margin-top: 6px;">Click marker for details →</div>
          </div>`;
        popupRef.current = new maplibregl.Popup({
          closeButton: true,
          offset: 14,
        })
          .setLngLat([lon, lat])
          .setHTML(html)
          .addTo(map);

        onSelectRef.current(zip);
      });
    });

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  useEffect(() => {
    syncData();
  }, [data]);

  return <div ref={containerRef} className="h-full w-full" />;
});

export default MapView;
