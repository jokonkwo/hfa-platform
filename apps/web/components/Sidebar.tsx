"use client";

import { useEffect, useRef, useState } from "react";
import type { DemographicsData } from "@/lib/types";
import {
  DEMO_FIELD_LABELS,
  DEMO_NUMERIC_FIELDS,
  type DemoNumericField,
} from "@/lib/demographics";

// ── Metric info catalog ──────────────────────────────────────────────────────
type Metric = "aqi" | DemoNumericField;

interface MetricInfo {
  title: string;
  description: string;
  source: string;
}

const METRIC_INFO: Record<Metric, MetricInfo> = {
  aqi: {
    title: "Current PM2.5 AQI",
    description:
      "Real-time fine particulate matter (PM2.5) readings from PurpleAir sensors, corrected using the EPA/Barkjohn formula to align with regulatory-grade monitors. Updated approximately every 10 minutes.",
    source: "PurpleAir sensors · EPA/Barkjohn correction",
  },
  population: {
    title: "Population",
    description:
      "The total number of people residing in the area based on the most recent American Community Survey 5-year estimates.",
    source: "US Census Bureau · ACS 5-Year 2024",
  },
  median_hh_income: {
    title: "Median Household Income",
    description:
      "The income of the median, or middle, household in the area according to the most recent year of the US Census Bureau American Community Survey (ACS).",
    source: "US Census Bureau · ACS 5-Year 2024",
  },
  median_age: {
    title: "Median Age",
    description:
      "The age of the median, or middle, resident in the area, where half the population is older and half is younger, based on ACS estimates.",
    source: "US Census Bureau · ACS 5-Year 2024",
  },
  poverty_rate_pct: {
    title: "Poverty Rate",
    description:
      "The percentage of individuals living below the official federal poverty threshold, as defined by the US Census Bureau based on household size and income.",
    source: "US Census Bureau · ACS 5-Year 2024",
  },
  ed_less_than_hs_pct: {
    title: "Less Than HS Diploma",
    description:
      "The share of adults aged 25 and older who have not earned a high school diploma or equivalency credential, reflecting educational attainment in the area.",
    source: "US Census Bureau · ACS 5-Year 2024",
  },
  unemployment_rate_pct: {
    title: "Unemployment Rate",
    description:
      "The percentage of people in the civilian labor force who are jobless, actively seeking work, and available for employment, based on ACS estimates.",
    source: "US Census Bureau · ACS 5-Year 2024",
  },
  limited_english_pct: {
    title: "Limited English Proficiency",
    description:
      "The percentage of residents aged 5 and older who speak English less than 'very well,' indicating limited ability to communicate in English in daily life.",
    source: "US Census Bureau · ACS 5-Year 2024",
  },
  housing_cost_burden_pct: {
    title: "Housing Cost Burden",
    description:
      "The share of households spending 30% or more of their gross income on housing costs (rent or mortgage plus utilities), a standard indicator of affordability stress.",
    source: "US Census Bureau · ACS 5-Year 2024",
  },
  pop_density_per_sq_mi: {
    title: "Population Density",
    description:
      "The number of residents per square mile, calculated from ACS population estimates and Census geographic area measurements.",
    source: "US Census Bureau · ACS 5-Year 2024",
  },
  pop_growth_pct: {
    title: "Population Growth",
    description:
      "The percentage change in total population from the prior ACS 5-year estimate period, reflecting net migration, births, and deaths over the measured interval.",
    source: "US Census Bureau · ACS 5-Year 2024",
  },
  income_growth_pct: {
    title: "Income Growth",
    description:
      "The percentage change in median household income from the prior ACS 5-year estimate period, reflecting real changes in household earnings in the area.",
    source: "US Census Bureau · ACS 5-Year 2024",
  },
};

// ── Full metric catalog (for search) ────────────────────────────────────────
const ALL_METRICS: { value: Metric; label: string }[] = [
  { value: "aqi", label: "Current PM2.5 AQI" },
  ...DEMO_NUMERIC_FIELDS.map((f) => ({ value: f as Metric, label: DEMO_FIELD_LABELS[f] ?? f })),
];

// ── InfoCard — click-triggered overlay ──────────────────────────────────────
function InfoButton({ metric }: { metric: Metric }) {
  const [open, setOpen] = useState(false);
  const [cardPos, setCardPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const info = METRIC_INFO[metric];

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const cardWidth = 256;
      const left = rect.right + 8 + cardWidth > window.innerWidth
        ? rect.left - cardWidth - 8
        : rect.right + 8;
      setCardPos({ top: rect.top, left });
    }
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (
        cardRef.current && !cardRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  return (
    <span className="ml-1 inline-flex">
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-600 hover:bg-gray-300"
        aria-label={`Info: ${info.title}`}
        aria-expanded={open}
      >
        i
      </button>

      {open && (
        <div
          ref={cardRef}
          style={{ position: "fixed", top: cardPos.top, left: cardPos.left }}
          className="z-[9999] w-64 rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
          role="dialog"
          aria-label={info.title}
        >
          <button
            onClick={() => setOpen(false)}
            className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            ×
          </button>

          <p className="pr-5 text-sm font-semibold text-gray-900">{info.title}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{info.description}</p>
          <p className="mt-3 text-[10px] text-gray-400">
            <span className="font-medium text-gray-500">Source:</span>{" "}
            {info.source}
          </p>
        </div>
      )}
    </span>
  );
}

// ── MetricSearchBox ──────────────────────────────────────────────────────────
function MetricSearchBox({
  activeMetric,
  onMetricChange,
}: {
  activeMetric: Metric;
  onMetricChange: (m: Metric) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = query.trim()
    ? ALL_METRICS.filter((m) => m.label.toLowerCase().includes(query.toLowerCase()))
    : [];

  function select(m: Metric) {
    onMetricChange(m);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="relative border-b border-gray-200 px-3 py-2">
      <div className="flex items-center gap-2 rounded border border-gray-300 bg-white px-2.5 py-1.5 focus-within:border-gray-500 focus-within:ring-1 focus-within:ring-gray-300">
        <svg className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="SEARCH DATA POINTS"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="w-full bg-transparent text-[11px] font-semibold uppercase tracking-wider text-gray-500 placeholder:text-gray-400 focus:outline-none"
          aria-label="Search data points"
          aria-autocomplete="list"
          aria-expanded={open && results.length > 0}
        />
        {query && (
          <button
            onMouseDown={(e) => { e.preventDefault(); setQuery(""); inputRef.current?.focus(); }}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-3 right-3 top-full z-50 mt-0.5 max-h-60 overflow-y-auto rounded border border-gray-200 bg-white shadow-lg"
        >
          {results.map((m) => (
            <li key={m.value} role="option" aria-selected={activeMetric === m.value}>
              <button
                onMouseDown={(e) => { e.preventDefault(); select(m.value); }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-gray-50 ${activeMetric === m.value ? "font-semibold text-blue-700" : "text-gray-700"}`}
              >
                {activeMetric === m.value && (
                  <svg className="h-3 w-3 flex-shrink-0 text-blue-600" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
                <span className={activeMetric === m.value ? "" : "ml-5"}>{m.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────
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

// ── Sidebar ──────────────────────────────────────────────────────────────────
interface SidebarProps {
  onTableView?: () => void;
  activeMetric: "aqi" | DemoNumericField;
  onMetricChange: (metric: "aqi" | DemoNumericField) => void;
}

export function Sidebar({ onTableView, activeMetric, onMetricChange }: SidebarProps) {
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

      {/* Search data points */}
      <MetricSearchBox activeMetric={activeMetric} onMetricChange={onMetricChange} />

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
          <InfoButton metric="aqi" />
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
              <InfoButton metric={field} />
            </label>
          ))}
        </div>
      </Section>
    </div>
  );
}
