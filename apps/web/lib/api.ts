import type { ZipNow, ZipHourly, ZipDaily, SearchResult } from "./types";
import type { BoundaryCollection, CountyBoundaryCollection, StateBoundaryCollection } from "@/components/MapView";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// Fetch current ZIP-level AQI. Returns [] cleanly for an empty backend;
// throws ApiError on network failure / non-2xx so the UI can show the
// "could not reach API" state.
export async function fetchZipsNow(signal?: AbortSignal): Promise<ZipNow[]> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/v1/zips/now`, {
      signal,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Could not reach HFA API. Is the server running?");
  }

  if (!res.ok) {
    throw new ApiError(`HFA API returned ${res.status}`);
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data as ZipNow[];
}

export async function fetchZipDaily(zip: string): Promise<ZipDaily[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/zips/${zip}/daily`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as ZipDaily[]) : [];
  } catch {
    return [];
  }
}

export async function fetchZipHourly(zip: string): Promise<ZipHourly[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/zips/${zip}/hourly`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as ZipHourly[]) : [];
  } catch {
    return [];
  }
}

// Fetch county boundary polygons. Pass a stateGeoid for full-detail single-state data;
// omit (or pass "") for all US counties with simplified geometry (~0.7 MB).
export async function fetchCountyBoundaries(stateGeoid = ""): Promise<CountyBoundaryCollection | null> {
  try {
    const params = stateGeoid ? `?state=${stateGeoid}` : "";
    const res = await fetch(`${API_BASE_URL}/v1/counties/boundaries${params}`);
    if (!res.ok) return null;
    return (await res.json()) as CountyBoundaryCollection;
  } catch {
    return null;
  }
}

// Fetch ZIP boundary polygons for a given county (default: Fresno "06019").
export async function fetchZipBoundaries(countyGeoid = "06019"): Promise<BoundaryCollection | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/zips/boundaries?county=${countyGeoid}`);
    if (!res.ok) return null;
    return (await res.json()) as BoundaryCollection;
  } catch {
    return null;
  }
}

// Search states, counties, and ZIP codes.
export async function fetchSearch(q: string, signal?: AbortSignal): Promise<SearchResult[]> {
  if (!q.trim()) return [];
  try {
    const res = await fetch(
      `${API_BASE_URL}/v1/search?q=${encodeURIComponent(q.trim())}`,
      { signal, cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as SearchResult[]) : [];
  } catch {
    return [];
  }
}

// Fetch US state boundary polygons. Returns null on any failure (non-critical).
export async function fetchStateBoundaries(): Promise<StateBoundaryCollection | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/states/boundaries`);
    if (!res.ok) return null;
    return (await res.json()) as StateBoundaryCollection;
  } catch {
    return null;
  }
}
