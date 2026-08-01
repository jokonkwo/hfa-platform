// Shape returned by GET /v1/zips/now (defined by the api_zip_now view in HFA_DEV)
export interface ZipNow {
  zip: string;
  town: string;
  pm25: number;
  aqi: number;
  category: string;
  population: number | null; // Census ACS hookup — always null until phase 2
  sample_size: number;
  freshness_pct: number;
  qc_badge: string;
  updated_ts: string;
}

// Shape returned by GET /v1/zips/{zip}/hourly (api_zip_hourly view)
export interface ZipHourly {
  hour_utc: string;
  zip: string;
  town: string;
  pm25: number;
  aqi: number;
  sample_size: number;
  coverage_bins: number;
}

// Shape returned by GET /v1/search?q=
export interface SearchResult {
  type: "state" | "county" | "zip" | "place";
  identifier: string;   // state GEOID ("06"), county GEOID ("06019"), zip5 ("93701"), or place_geoid ("0619000")
  display_name: string; // "California", "Fresno County, CA", "93701", "Fresno, CA"
  abbr?: string;        // "CA" for states
  state_fp?: string;    // "06" for counties and places (parent state FIPS)
  county_geoid?: string; // "06019" for places (containing county — drives ZIP boundary fetch)
  bbox?: [number, number, number, number] | null; // [west, south, east, north]
  lon: number;
  lat: number;
}

// Shape returned by GET /v1/zips/{zip}/daily (api_zip_daily view)
export interface ZipDaily {
  date: string; // "2026-01-21" or "2026-01-21T00:00:00" depending on DuckDB type
  zip: string;
  town: string;
  pm25_mean: number;
  pm25_p95: number;
  pm25_max: number;
  aqi_exceed_101: number;
  aqi_exceed_151: number;
  coverage_hours: number;
}
