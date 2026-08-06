"use client";

import { useState } from "react";
import type { DemographicsData } from "@/lib/types";
import {
  DEMO_BINS,
  DEMO_FIELD_LABELS,
  DEMO_NUMERIC_FIELDS,
  type DemoNumericField,
  demoBinColor,
  formatDemoValue,
  getFieldRange,
  getQuantileBreakpoints,
} from "@/lib/demographics";

interface DemographicsPanelProps {
  data: DemographicsData;
  allData: DemographicsData[];
  compact?: boolean;
}

export function DemographicsPanel({ data, allData, compact = false }: DemographicsPanelProps) {
  const [activeField, setActiveField] = useState<DemoNumericField>("population");

  const activeRange = getFieldRange(activeField, allData);

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {/* 5-bin legend bar — shows for the active field */}
      {activeRange && (
        <div className="select-none">
          <div className="flex h-4 overflow-hidden rounded">
            {DEMO_BINS.map((color, i) => (
              <div key={i} className="flex-1" style={{ backgroundColor: color }} />
            ))}
          </div>
          <div className="mt-0.5 flex justify-between text-[10px] text-gray-500">
            <span>{formatDemoValue(activeField, activeRange.min)}</span>
            <span>{formatDemoValue(activeField, activeRange.max)}</span>
          </div>
        </div>
      )}

      {/* Field rows */}
      <div className={compact ? "space-y-0.5" : "space-y-1"}>
        {DEMO_NUMERIC_FIELDS.map((field) => {
          const value = data[field] as number | null;
          const breakpoints = getQuantileBreakpoints(field, allData);
          const color = demoBinColor(value, breakpoints);
          const isActive = field === activeField;

          return (
            <button
              key={field}
              onClick={() => setActiveField(field)}
              className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors ${
                isActive ? "bg-gray-100" : "hover:bg-gray-50"
              }`}
            >
              <span
                className="h-3 w-3 flex-shrink-0 rounded-sm border border-gray-300"
                style={{ backgroundColor: color }}
              />
              <span className="min-w-0 flex-1 text-gray-600">
                {DEMO_FIELD_LABELS[field]}
              </span>
              <span className={`tabular-nums ${value === null ? "text-gray-400" : "font-medium text-gray-800"}`}>
                {formatDemoValue(field, value)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
