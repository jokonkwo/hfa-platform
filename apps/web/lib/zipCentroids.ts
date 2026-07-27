// Hardcoded ZIP -> [lat, lon] centroids for Fresno County ZIPs.
// ZIPs not present here are skipped (with a console warning).
export const ZIP_CENTROIDS: Record<string, [number, number]> = {
  "93650": [36.8389, -119.9348],
  "93701": [36.7354, -119.8132],
  "93702": [36.7479, -119.7772],
  "93703": [36.7749, -119.7772],
  "93704": [36.8053, -119.8132],
  "93705": [36.7749, -119.8132],
  "93706": [36.7174, -119.8341],
  "93710": [36.8053, -119.7772],
  "93711": [36.8215, -119.8341],
  "93720": [36.8782, -119.7458],
  "93721": [36.7354, -119.7897],
  "93722": [36.7749, -119.9033],
  "93723": [36.7479, -119.9033],
  "93725": [36.6994, -119.7458],
  "93726": [36.7749, -119.7458],
  "93727": [36.7479, -119.7127],
  "93728": [36.7593, -119.8341],
  "93730": [36.9040, -119.7127],
};

export const FRESNO_CENTER: [number, number] = [-119.7871, 36.7378]; // [lon, lat]
// zoom 12 = first zoom where place_hamlet/place_suburbs layers render (neighborhood names).
// zoom 13 adds roadname_major. Confirmed via Playwright layer audit (2026-07-27).
export const FRESNO_ZOOM = 12;
