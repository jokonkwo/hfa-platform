"use client";

import { useState, useEffect, useCallback } from "react";
import type { ZipNow, ZipHourly, ZipDaily } from "@/lib/types";
import { CategoryBadge } from "./CategoryBadge";
import { categoryColor, aqiToCategory, pm25ToAqi } from "@/lib/aqi";
import { fetchZipDaily, fetchZipHourly } from "@/lib/api";

// ─── existing panel utilities ────────────────────────────────────────────────

function formatLocal(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function QcIndicator({ badge }: { badge: string }) {
  const map: Record<string, { color: string; label: string }> = {
    ok: { color: "bg-green-500", label: "Good quality" },
    good: { color: "bg-green-500", label: "Good quality" },
    verified: { color: "bg-green-500", label: "Verified" },
    warning: { color: "bg-amber-500", label: "Warning" },
    warn: { color: "bg-amber-500", label: "Warning" },
    poor: { color: "bg-red-400", label: "Poor quality" },
    stale: { color: "bg-gray-400", label: "Stale" },
    error: { color: "bg-red-500", label: "Error" },
  };
  const cfg = map[(badge ?? "").toLowerCase()] ?? {
    color: "bg-gray-400",
    label: badge || "Unknown",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
      <span className={`h-2.5 w-2.5 rounded-full ${cfg.color}`} />
      {cfg.label}
    </span>
  );
}

// ─── cigarette equivalence ───────────────────────────────────────────────────

function CigaretteCard({ zip, pm25 }: { zip: string; pm25: number }) {
  if (!(pm25 > 0)) return null;

  const cigs = pm25 / 22;
  const fillPct = Math.min(cigs / 30, 1);

  const cigStr =
    cigs < 0.1
      ? "< 0.1"
      : cigs < 10
        ? cigs.toFixed(1)
        : Math.round(cigs).toString();
  const cigWord = Math.abs(cigs - 1) < 0.05 ? "cigarette" : "cigarettes";

  const W = 200, H = 20;
  const EMBER_X = 6;
  const BODY_X = 10, BODY_W = 164;
  const FILTER_X = 174, FILTER_W = 26;
  const burnW = Math.round(fillPct * BODY_W);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="mb-3">
        <span className="text-4xl font-bold text-gray-900">≈ {cigStr}</span>
        <span className="ml-2 text-sm font-medium text-amber-700">
          cigarettes/day
        </span>
      </div>

      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Cigarette severity fill: ${Math.round(fillPct * 100)}%`}
        className="mb-3"
      >
        <defs>
          <linearGradient id="hfa-cig-burn" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#F97316" />
            <stop offset="70%" stopColor="#FCD34D" />
            <stop offset="100%" stopColor="#E5C840" />
          </linearGradient>
        </defs>
        <rect x={BODY_X} y={4} width={BODY_W} height={H - 8} rx={2} fill="#F5F1E8" stroke="#D6D3D1" strokeWidth={0.5} />
        {burnW > 0 && <rect x={BODY_X} y={4} width={burnW} height={H - 8} rx={2} fill="url(#hfa-cig-burn)" />}
        <rect x={FILTER_X} y={3} width={FILTER_W} height={H - 6} rx={2} fill="#D4A574" stroke="#C09060" strokeWidth={0.5} />
        <circle cx={EMBER_X} cy={H / 2} r={6} fill="#FF6B35" opacity={0.12 + fillPct * 0.25} />
        <circle cx={EMBER_X} cy={H / 2} r={3} fill="#FF8C42" opacity={0.55 + fillPct * 0.35} />
        <circle cx={EMBER_X} cy={H / 2} r={1.5} fill="#FBBF24" opacity={0.9} />
      </svg>

      <p className="text-xs leading-relaxed text-gray-600">
        {`Air in ${zip} today carries about the same long-term health risk as smoking ${cigStr} ${cigWord} — based on Berkeley Earth's PM2.5 research. This reflects long-term exposure risk, not how today will feel.`}
      </p>
    </div>
  );
}

// ─── history section ─────────────────────────────────────────────────────────

// ZIPs that have continuous pilot data (Oct 7 2025 – Jan 21 2026).
// Others show the honest empty state.
const PILOT_ZIPS = new Set([
  "93701", "93702", "93711", "93720", "93727", "93728", "93730",
]);

function parseDateStr(d: string): string {
  return d.substring(0, 10); // normalize "2026-01-21T00:00:00" → "2026-01-21"
}

function fmtDate(iso10: string): string {
  return new Date(iso10 + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function meanOf(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

// ── Pacific-time formatters ───────────────────────────────────────────────────

function fmtHourPacific(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: true,
    timeZone: "America/Los_Angeles",
  }).format(new Date(ms));
}

function fmtDateLabel(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(ms));
}

function fmtHourTooltip(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    hour12: true,
    timeZone: "America/Los_Angeles",
  }).format(new Date(ms));
}

function fmtDateTooltip(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(ms));
}

// ── Mini SVG chart ────────────────────────────────────────────────────────────

interface ChartPt {
  t: number; // ms since epoch (UTC)
  aqi: number;
}

const EPA_TICKS = [50, 100, 150, 200, 300];

function MiniChart({
  points,
  gapMs,
  ariaLabel,
  timeLabel,
}: {
  points: ChartPt[];
  gapMs: number;
  ariaLabel: string;
  timeLabel: "hour" | "day";
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const sorted = [...points].sort((a, b) => a.t - b.t);

  const W = 300, H = 124;
  const PL = 26, PR = 6, PT = 8, PB = 24;
  const PW = W - PL - PR;
  const PH = H - PT - PB;

  const tMin = sorted.length > 0 ? sorted[0].t : 0;
  const tMax = sorted.length > 0 ? sorted[sorted.length - 1].t : 1;
  const rawMax = sorted.length > 0 ? Math.max(...sorted.map((p) => p.aqi)) : 0;
  const aqiMin = 0;
  const aqiMax = Math.max(Math.ceil(rawMax / 10) * 10, 30);

  const xOf = useCallback((t: number): number => {
    if (tMax === tMin) return PL + PW / 2;
    return PL + ((t - tMin) / (tMax - tMin)) * PW;
  }, [tMin, tMax]);

  const yOf = useCallback((aqi: number): number => {
    return PT + PH - ((aqi - aqiMin) / Math.max(1, aqiMax - aqiMin)) * PH;
  }, [aqiMax]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGRectElement>) => {
    const svgEl = (e.currentTarget as SVGElement).closest("svg") as SVGSVGElement | null;
    if (!svgEl || sorted.length === 0) return;
    const { left, width } = svgEl.getBoundingClientRect();
    const mouseX = ((e.clientX - left) / width) * W;
    let nearestIdx = 0, nearestDist = Infinity;
    sorted.forEach((p, i) => {
      const dist = Math.abs(xOf(p.t) - mouseX);
      if (dist < nearestDist) { nearestDist = dist; nearestIdx = i; }
    });
    setHoverIdx(nearestIdx);
  }, [sorted, xOf]);

  if (points.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-gray-400">No data</div>
    );
  }

  // Split into continuous segments at gaps
  type Seg = ChartPt[];
  const segs: Seg[] = [];
  let cur: Seg = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].t - sorted[i - 1].t > gapMs) {
      if (cur.length > 0) segs.push(cur);
      cur = [];
    }
    cur.push(sorted[i]);
  }
  if (cur.length > 0) segs.push(cur);

  const avgAqi = Math.round(meanOf(sorted.map((p) => p.aqi)));
  const lineColor = categoryColor(aqiToCategory(avgAqi));
  const bottom = yOf(aqiMin);

  // Y reference lines
  const yRefs = [0, ...EPA_TICKS.filter((v) => v > 0 && v <= aqiMax)];

  // X-axis tick times
  const xTicks: number[] = [];
  if (timeLabel === "day") {
    sorted.forEach((p) => xTicks.push(p.t));
  } else {
    // 4-hour UTC boundaries within [tMin, tMax]
    const fourH = 4 * 3600 * 1000;
    const firstBoundary = Math.ceil(tMin / fourH) * fourH;
    for (let t = firstBoundary; t <= tMax; t += fourH) xTicks.push(t);
    if (xTicks.length === 0 || xTicks[0] > tMin) xTicks.unshift(tMin);
    if (xTicks[xTicks.length - 1] < tMax) xTicks.push(tMax);
  }

  const safeIdx = hoverIdx !== null && hoverIdx < sorted.length ? hoverIdx : null;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel}
      className="overflow-visible"
    >
      <defs>
        <filter id="hfa-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#00000020" />
        </filter>
      </defs>

      {/* Y reference lines + labels */}
      {yRefs.map((v) => (
        <g key={v}>
          <line
            x1={PL} y1={yOf(v)} x2={PL + PW} y2={yOf(v)}
            stroke={v === 0 ? "#d1d5db" : "#e5e7eb"}
            strokeWidth={v === 0 ? 0.75 : 0.5}
            strokeDasharray={v === 0 ? undefined : "2 3"}
          />
          <text
            x={PL - 3} y={yOf(v)}
            textAnchor="end" fontSize={7} fill="#9ca3af"
            dominantBaseline="middle"
          >
            {v}
          </text>
        </g>
      ))}

      {/* Per-segment area + line */}
      {segs.map((s, i) => {
        const pts = s.map((p) => ({ x: xOf(p.t), y: yOf(p.aqi) }));
        const areaD =
          `M ${pts[0].x} ${bottom} ` +
          pts.map((p) => `L ${p.x} ${p.y}`).join(" ") +
          ` L ${pts[pts.length - 1].x} ${bottom} Z`;
        const lineD = pts
          .map((p, j) => `${j === 0 ? "M" : "L"} ${p.x} ${p.y}`)
          .join(" ");
        return (
          <g key={i}>
            <path d={areaD} fill={lineColor} fillOpacity={0.15} />
            <path
              d={lineD}
              stroke={lineColor}
              strokeWidth={1.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      })}

      {/* X-axis labels inside SVG */}
      {xTicks.map((t, i) => {
        const cx = Math.min(Math.max(xOf(t), PL + 12), PL + PW - 12);
        const label = timeLabel === "hour" ? fmtHourPacific(t) : fmtDateLabel(t);
        return (
          <text
            key={i}
            x={cx}
            y={H - 6}
            textAnchor="middle"
            fontSize={7}
            fill="#9ca3af"
          >
            {label}
          </text>
        );
      })}

      {/* Invisible overlay for hover detection — must be after paths, before tooltip */}
      <rect
        x={PL} y={PT} width={PW} height={PH}
        fill="transparent"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
        style={{ cursor: "crosshair" }}
      />

      {/* Hover indicator */}
      {safeIdx !== null && (() => {
        const pt = sorted[safeIdx];
        const cx = xOf(pt.t);
        const cy = yOf(pt.aqi);
        const tipLabel = timeLabel === "hour" ? fmtHourTooltip(pt.t) : fmtDateTooltip(pt.t);
        const tipW = 76, tipH = 40;
        const tipX = cx + 4 + tipW > PL + PW ? cx - 4 - tipW : cx + 4;
        const tipY = Math.min(Math.max(cy - tipH / 2, PT), PT + PH - tipH);
        return (
          <g style={{ pointerEvents: "none" }}>
            <line x1={cx} y1={PT} x2={cx} y2={PT + PH} stroke="#9ca3af" strokeWidth={0.75} />
            <circle cx={cx} cy={cy} r={3.5} fill={lineColor} stroke="white" strokeWidth={1.5} />
            <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={3}
              fill="white" stroke="#e5e7eb" strokeWidth={0.75}
              filter="url(#hfa-shadow)" />
            <text x={tipX + tipW / 2} y={tipY + 15} textAnchor="middle"
              fontSize={14} fontWeight={700} fill="#111827">{pt.aqi}</text>
            <text x={tipX + tipW / 2} y={tipY + 29} textAnchor="middle"
              fontSize={6.5} fill="#6b7280">{tipLabel}</text>
          </g>
        );
      })()}
    </svg>
  );
}

// ── Trend arrow ───────────────────────────────────────────────────────────────

function TrendArrow({ delta }: { delta: number }) {
  if (delta === 0)
    return <span className="text-gray-400 text-xs">&#x2192; no change</span>;
  if (delta > 0)
    return (
      <span className="text-xs text-red-600">
        &#x2197; {Math.abs(delta)} vs prior
      </span>
    );
  return (
    <span className="text-xs text-green-700">
      &#x2198; {Math.abs(delta)} vs prior
    </span>
  );
}

// ── Summary tile ──────────────────────────────────────────────────────────────

function SummaryTile({
  label,
  dateRange,
  aqi,
  delta,
  onClick,
}: {
  label: string;
  dateRange: string;
  aqi: number;
  delta: number | null;
  onClick: () => void;
}) {
  const color = categoryColor(aqiToCategory(aqi));
  return (
    <button
      onClick={onClick}
      className="flex-1 rounded-lg border border-gray-200 bg-white p-3 text-left transition-all hover:border-gray-300 hover:shadow-sm"
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-gray-900">{aqi}</span>
        <span className="text-xs text-gray-400">AQI</span>
      </div>
      {delta !== null && (
        <div className="mt-0.5">
          <TrendArrow delta={delta} />
        </div>
      )}
      <div className="mt-2 text-[10px] leading-tight text-gray-500">{dateRange}</div>
      <div
        className="mt-2 h-1 w-full rounded-full"
        style={{ backgroundColor: color, opacity: 0.75 }}
      />
    </button>
  );
}

// ── Main history section ──────────────────────────────────────────────────────

type HistoryView = "summary" | "daily" | "hourly";

function HistorySection({ zip }: { zip: string }) {
  const [dailyData, setDailyData] = useState<ZipDaily[]>([]);
  const [hourlyData, setHourlyData] = useState<ZipHourly[] | null>(null);
  const [view, setView] = useState<HistoryView>("summary");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDailyData([]);
    setHourlyData(null);
    setView("summary");

    fetchZipDaily(zip).then((d) => {
      if (!cancelled) {
        setDailyData(d);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [zip]);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-center">
        <span className="text-xs text-gray-400">Loading pilot data…</span>
      </div>
    );
  }

  if (!PILOT_ZIPS.has(zip) || dailyData.length < 7) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-5 text-center">
        <p className="text-sm font-medium text-gray-500">
          Not enough historical data yet
        </p>
        <p className="mt-1 text-xs text-gray-400">
          A trend chart will appear here once air quality readings accumulate
          over multiple days. Check back as more data comes in.
        </p>
      </div>
    );
  }

  // Sort DESC (most recent first)
  const sorted = [...dailyData].sort((a, b) =>
    parseDateStr(b.date).localeCompare(parseDateStr(a.date)),
  );

  const last7 = sorted.slice(0, 7);
  const prior7 = sorted.slice(7, 14);
  const lastDayAqi = pm25ToAqi(sorted[0].pm25_mean);
  const prevDayAqi = sorted[1] ? pm25ToAqi(sorted[1].pm25_mean) : null;
  const lastDayDelta = prevDayAqi !== null ? lastDayAqi - prevDayAqi : null;
  const last7Avg = Math.round(meanOf(last7.map((r) => pm25ToAqi(r.pm25_mean))));
  const prior7Avg =
    prior7.length >= 7
      ? Math.round(meanOf(prior7.map((r) => pm25ToAqi(r.pm25_mean))))
      : null;
  const last7Delta = prior7Avg !== null ? last7Avg - prior7Avg : null;

  const lastDate = fmtDate(parseDateStr(sorted[0].date));
  const first7Date = fmtDate(parseDateStr(last7[last7.length - 1].date));
  const last7Range = `${first7Date} – ${lastDate}`;

  // ── Drill-down: hourly chart for the last day ──────────────────────────────
  if (view === "hourly") {
    const lastDate10 = parseDateStr(sorted[0].date);
    const dayHours = (hourlyData ?? [])
      .filter((h) => h.hour_utc.startsWith(lastDate10))
      .map((h) => ({ t: new Date(h.hour_utc + "Z").getTime(), aqi: h.aqi }));

    return (
      <div className="space-y-2">
        <button
          onClick={() => setView("summary")}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
        >
          ← Back
        </button>
        <p className="text-xs font-medium text-gray-700">
          {zip} AQI — {lastDate}
        </p>
        {hourlyData === null ? (
          <div className="py-6 text-center text-xs text-gray-400">
            Loading…
          </div>
        ) : (
          <MiniChart
            points={dayHours}
            gapMs={2 * 3600 * 1000}
            ariaLabel={`Hourly AQI for ZIP ${zip} on ${lastDate}`}
            timeLabel="hour"
          />
        )}
        <p className="text-center text-[10px] text-gray-400">
          Pilot data · Oct 7, 2025 – Jan 21, 2026
        </p>
      </div>
    );
  }

  // ── Drill-down: daily chart for the last 7 days ────────────────────────────
  if (view === "daily") {
    const dailyPts = last7.map((r) => ({
      t: new Date(parseDateStr(r.date) + "T12:00:00Z").getTime(),
      aqi: pm25ToAqi(r.pm25_mean),
    }));

    return (
      <div className="space-y-2">
        <button
          onClick={() => setView("summary")}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
        >
          ← Back
        </button>
        <p className="text-xs font-medium text-gray-700">
          {zip} AQI — {last7Range}
        </p>
        <MiniChart
          points={dailyPts}
          gapMs={2 * 24 * 3600 * 1000}
          ariaLabel={`Daily AQI for ZIP ${zip}, last 7 days of pilot`}
          timeLabel="day"
        />
        <p className="text-center text-[10px] text-gray-400">
          Pilot data · Oct 7, 2025 – Jan 21, 2026
        </p>
      </div>
    );
  }

  // ── Summary view ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-700">Pilot Data History</p>
      <div className="flex gap-2">
        <SummaryTile
          label="Last 24 Hours"
          dateRange={lastDate}
          aqi={lastDayAqi}
          delta={lastDayDelta !== null ? Math.round(lastDayDelta) : null}
          onClick={() => {
            setView("hourly");
            if (!hourlyData) {
              fetchZipHourly(zip).then((h) => setHourlyData(h));
            }
          }}
        />
        <SummaryTile
          label="Last 7 Days"
          dateRange={last7Range}
          aqi={last7Avg}
          delta={last7Delta}
          onClick={() => setView("daily")}
        />
      </div>
      <p className="text-[10px] text-gray-400">
        Pilot data · Oct 7, 2025 – Jan 21, 2026 · Tap a tile to explore
      </p>
    </div>
  );
}

// ─── Main detail panel ────────────────────────────────────────────────────────

interface DetailPanelProps {
  zip: ZipNow | null;
  onClose: () => void;
}

export function DetailPanel({ zip, onClose }: DetailPanelProps) {
  const open = zip !== null;
  return (
    <aside
      className={`fixed right-0 top-14 z-30 h-[calc(100vh-3.5rem)] w-full max-w-sm transform border-l border-gray-200 bg-white shadow-2xl transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
      aria-hidden={!open}
    >
      {zip && (
        <div className="flex h-full flex-col overflow-y-auto">
          <div className="flex items-start justify-between border-b border-gray-200 p-5">
            <div>
              <h2 className="text-3xl font-bold text-gray-900">{zip.zip}</h2>
              <p className="text-sm text-gray-500">{zip.town}</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close details"
              className="rounded-md p-1 text-2xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              ×
            </button>
          </div>

          <div className="space-y-5 p-5">
            <div>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-bold text-gray-900">
                  {zip.aqi}
                </span>
                <span className="text-sm text-gray-500">AQI</span>
              </div>
              <div className="mt-2">
                <CategoryBadge
                  category={zip.category}
                  className="text-sm px-3 py-1"
                />
              </div>
            </div>

            <CigaretteCard zip={zip.zip} pm25={zip.pm25} />

            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-gray-500">PM2.5</dt>
                <dd className="font-medium text-gray-900">
                  {zip.pm25.toFixed(1)} µg/m³
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Sensors</dt>
                <dd className="font-medium text-gray-900">{zip.sample_size}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Freshness</dt>
                <dd className="font-medium text-gray-900">
                  {zip.freshness_pct.toFixed(0)}%
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Quality</dt>
                <dd>
                  <QcIndicator badge={zip.qc_badge} />
                </dd>
              </div>
            </dl>

            <div className="text-sm">
              <span className="text-gray-500">Updated: </span>
              <span className="font-medium text-gray-900">
                {formatLocal(zip.updated_ts)}
              </span>
            </div>

            <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
              PurpleAir sensors · EPA/Barkjohn corrected
            </p>

            <HistorySection zip={zip.zip} />
          </div>
        </div>
      )}
    </aside>
  );
}
