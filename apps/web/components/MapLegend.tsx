"use client";

import { AQI_CATEGORIES } from "@/lib/aqi";
import {
  DEMO_BINS,
  DEMO_FIELD_LABELS,
  formatDemoValue,
  getFieldRange,
  type DemoNumericField,
} from "@/lib/demographics";
import type { DemographicsData } from "@/lib/types";

interface MapLegendProps {
  activeMetric: "aqi" | DemoNumericField;
  allZctaDemographics: DemographicsData[];
}

export function MapLegend({ activeMetric, allZctaDemographics }: MapLegendProps) {
  return (
    <div className="pointer-events-none absolute bottom-8 right-2 z-20 select-none rounded-lg border border-gray-200 bg-white/95 px-3 py-2.5 shadow-md">
      {activeMetric === "aqi" ? (
        <AqiLegend />
      ) : (
        <DemoLegend field={activeMetric} allData={allZctaDemographics} />
      )}
    </div>
  );
}

function AqiLegend() {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        PM2.5 AQI
      </p>
      <ul className="space-y-1">
        {AQI_CATEGORIES.map((c) => (
          <li key={c.name} className="flex items-center gap-2 text-[11px]">
            <span
              className="h-3 w-3 flex-shrink-0 rounded-sm border border-gray-200"
              style={{ backgroundColor: c.color }}
            />
            <span className="text-gray-700">{c.name}</span>
            <span className="ml-auto pl-4 text-gray-400">{c.range}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DemoLegend({
  field,
  allData,
}: {
  field: DemoNumericField;
  allData: DemographicsData[];
}) {
  const range = getFieldRange(field, allData);
  const label = DEMO_FIELD_LABELS[field] ?? field;

  return (
    <div className="w-44">
      <p className="mb-1.5 truncate text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <div className="flex h-3 overflow-hidden rounded">
        {DEMO_BINS.map((color, i) => (
          <div key={i} className="flex-1" style={{ backgroundColor: color }} />
        ))}
      </div>
      {range ? (
        <div className="mt-0.5 flex justify-between text-[10px] text-gray-500">
          <span>{formatDemoValue(field, range.min)}</span>
          <span>{formatDemoValue(field, range.max)}</span>
        </div>
      ) : (
        <p className="mt-0.5 text-[10px] italic text-gray-400">
          Range loads with data
        </p>
      )}
      <p className="mt-1 text-[10px] text-gray-400">
        <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-gray-200 align-middle" />
        Gray = no data
      </p>
    </div>
  );
}
