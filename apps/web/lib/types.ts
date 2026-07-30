// Shape returned by GET /v1/zips/now (defined by the api_zip_now view in HFA_DEV)
export interface ZipNow {
  zip: string;
  town: string;
  pm25: number;
  aqi: number;
  category: string;
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
