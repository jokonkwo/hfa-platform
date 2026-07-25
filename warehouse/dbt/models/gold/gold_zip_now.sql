{{ config(materialized='table') }}

with latest_ts as (
    select max(ts_utc) as ts from {{ ref('silver_zip_now_10min') }}
)

select
    s.ts_utc at time zone 'UTC' as updated_ts,
    s.zip,
    s.town,
    s.pm25_corr                 as pm25,
    s.aqi,
    case
        when s.aqi <= 50  then 'Good'
        when s.aqi <= 100 then 'Moderate'
        when s.aqi <= 150 then 'Unhealthy for Sensitive Groups'
        when s.aqi <= 200 then 'Unhealthy'
        when s.aqi <= 300 then 'Very Unhealthy'
        else 'Hazardous'
    end                         as category,
    s.sample_size,
    s.freshness_pct,
    s.qc_badge
from {{ ref('silver_zip_now_10min') }} s
cross join latest_ts
where s.ts_utc = latest_ts.ts
