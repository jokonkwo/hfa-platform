import type { ZipNow } from "./types";

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
