"use client";

import { useState } from "react";
import type { DemographicsData } from "@/lib/types";
import { AQI_CATEGORIES } from "@/lib/aqi";
import {
  DEMO_BINS,
  DEMO_FIELD_LABELS,
  DEMO_NUMERIC_FIELDS,
  type DemoNumericField,
  formatDemoValue,
  getFieldRange,
} from "@/lib/demographics";

function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-flex">
      <span className="flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-gray-300 text-[10px] font-bold text-gray-700">
        i
      </span>
      <span className="pointer-events-none absolute left-5 top-0 z-20 hidden w-52 rounded-md bg-gray-900 px-2 py-1.5 text-[11px] leading-snug text-white group-hover:block">
        {text}
      </span>
    </span>
  );
}

function Section({
  title,
  chip,
  defaultOpen,
  children,
}: {
  title: string;
  chip?: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-200">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-gray-800 hover:bg-gray-50"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          {title}
          {chip && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              {chip}
            </span>
          )}
        </span>
        <svg
          className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

interface SidebarProps {
  onTableView?: () => void;
  activeMetric: "aqi" | DemoNumericField;
  onMetricChange: (metric: "aqi" | DemoNumericField) => void;
  allZctaDemographics: DemographicsData[];
}

export function Sidebar({ onTableView, activeMetric, onMetricChange, allZctaDemographics }: SidebarProps) {
  const activeRange = activeMetric !== "aqi" ? getFieldRange(activeMetric, allZctaDemographics) : null;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Branding */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
        <div>
          <span className="text-sm font-bold text-gray-900">Healthy Fresno Air</span>
          <span className="ml-2 text-[11px] text-gray-400">v1 POC</span>
        </div>
        {onTableView && (
          <button
            onClick={onTableView}
            className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
            title="Table View"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" d="M3 5h18M3 10h18M3 15h18M3 20h18" />
            </svg>
            Table
          </button>
        )}
      </div>

      {/* Air Quality metric */}
      <Section title="Air Quality" defaultOpen>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
          <input
            type="radio"
            name="map-metric"
            value="aqi"
            checked={activeMetric === "aqi"}
            onChange={() => onMetricChange("aqi")}
          />
          <span>Current PM2.5 AQI</span>
          <InfoTip text="EPA/Barkjohn corrected PM2.5, updated every 10 minutes" />
        </label>
      </Section>

      {/* Demographic — ACS fields */}
      <Section title="Demographic" defaultOpen={false}>
        <div className="space-y-0.5">
          {DEMO_NUMERIC_FIELDS.map((field) => (
            <label key={field} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-gray-700 hover:bg-gray-50">
              <input
                type="radio"
                name="map-metric"
                value={field}
                checked={activeMetric === field}
                onChange={() => onMetricChange(field)}
              />
              <span>{DEMO_FIELD_LABELS[field] ?? field}</span>
            </label>
          ))}
        </div>
      </Section>

      {/* Legend — dynamic: AQI or 5-bin */}
      <Section title="Legend" defaultOpen>
        {activeMetric === "aqi" ? (
          <ul className="space-y-1.5">
            {AQI_CATEGORIES.map((c) => (
              <li key={c.name} className="flex items-center gap-2 text-xs">
                <span
                  className="h-3.5 w-3.5 flex-shrink-0 rounded-sm border border-gray-300"
                  style={{ backgroundColor: c.color }}
                />
                <span className="text-gray-700">{c.name}</span>
                <span className="ml-auto text-gray-400">{c.range}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="select-none">
            <p className="mb-2 text-xs font-medium text-gray-700">
              {DEMO_FIELD_LABELS[activeMetric] ?? activeMetric}
            </p>
            <div className="flex h-4 overflow-hidden rounded">
              {DEMO_BINS.map((color, i) => (
                <div key={i} className="flex-1" style={{ backgroundColor: color }} />
              ))}
            </div>
            {activeRange ? (
              <div className="mt-0.5 flex justify-between text-[10px] text-gray-500">
                <span>{formatDemoValue(activeMetric, activeRange.min)}</span>
                <span>{formatDemoValue(activeMetric, activeRange.max)}</span>
              </div>
            ) : (
              <p className="mt-1 text-[10px] text-gray-400 italic">Range loads with ZIP data</p>
            )}
            <p className="mt-1.5 text-[10px] text-gray-400">
              <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-gray-200" />
              Gray = no data
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}
