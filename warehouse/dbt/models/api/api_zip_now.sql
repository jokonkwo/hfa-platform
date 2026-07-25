{{ config(materialized='view') }}

select zip, town, pm25, aqi, category, sample_size, freshness_pct, qc_badge, updated_ts
from {{ ref('gold_zip_now') }}
