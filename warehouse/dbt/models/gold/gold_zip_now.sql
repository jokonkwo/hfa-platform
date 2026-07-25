{{
  config(
    materialized='incremental',
    unique_key='zip',
    tags=['realtime']
  )
}}

-- Pull only unprocessed silver rows before computing latest_ts so the incremental
-- filter gates what "latest" means, rather than always resolving to the full table max.
with source as (
    select *
    from {{ ref('silver_zip_now_10min') }}
    {% if is_incremental() %}
    where ts_utc > (select max(updated_ts)::timestamp from {{ this }})
    {% endif %}
),

latest_ts as (
    select max(ts_utc) as ts from source
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
from source s
cross join latest_ts
where s.ts_utc = latest_ts.ts
