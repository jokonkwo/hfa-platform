"use client";

import { useState } from "react";
import type { ZipNow } from "@/lib/types";
import { AQI_CATEGORIES, categoryColor } from "@/lib/aqi";
import { CategoryBadge } from "./CategoryBadge";

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
      >
        <span className="flex items-center gap-2">
          {title}
          {chip && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              {chip}
            </span>
          )}
        </span>
        <span className="text-gray-400">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

interface SidebarProps {
  data: ZipNow[]; // filtered rows
  onSelectZip: (zip: string) => void;
  ingestionEmpty: boolean;
}

export function Sidebar({ data, onSelectZip, ingestionEmpty }: SidebarProps) {
  const ranked = [...data].sort((a, b) => a.aqi - b.aqi);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Air Quality */}
      <Section title="Air Quality" defaultOpen>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
          <input type="radio" name="aq-metric" checked readOnly />
          <span>Current PM2.5 AQI</span>
          <InfoTip text="EPA/Barkjohn corrected PM2.5, updated every 10 minutes" />
        </label>
      </Section>

      {/* Community Context */}
      <Section title="Community Context" chip="Coming Soon" defaultOpen={false}>
        <div className="space-y-2">
          {["Poverty Rate", "Median Age", "Population Density", "Asthma Rate"].map(
            (label) => (
              <div
                key={label}
                className="pointer-events-none flex items-center gap-2 text-sm text-gray-400 select-none"
                aria-disabled="true"
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 bg-gray-100" />
                <span>{label}</span>
              </div>
            ),
          )}
          <p className="pt-1 text-[11px] italic text-gray-400">
            CalEnviroScreen &amp; ACS data — planned for v2
          </p>
        </div>
      </Section>

      {/* AQI Legend */}
      <Section title="AQI Legend" defaultOpen>
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
      </Section>

      {/* Rankings */}
      <Section title="ZIP Rankings — Current AQI" defaultOpen>
        {ingestionEmpty ? (
          <p className="text-xs text-gray-500">
            No ZIP data — check back after ingestion resumes.
          </p>
        ) : ranked.length === 0 ? (
          <p className="text-xs text-gray-500">
            No ZIPs match the current filter.
          </p>
        ) : (
          <ul className="space-y-1">
            {ranked.map((row) => (
              <li key={row.zip}>
                <button
                  onClick={() => onSelectZip(row.zip)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-50"
                >
                  <span
                    className="h-3 w-3 flex-shrink-0 rounded-full border border-gray-300"
                    style={{ backgroundColor: categoryColor(row.category) }}
                  />
                  <span className="text-sm font-medium text-gray-800">
                    {row.zip}
                  </span>
                  <span className="truncate text-xs text-gray-500">
                    {row.town}
                  </span>
                  <span className="ml-auto text-sm font-semibold text-gray-900">
                    {row.aqi}
                  </span>
                  <CategoryBadge category={row.category} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
