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
