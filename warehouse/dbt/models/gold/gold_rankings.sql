{{ config(materialized="table") }}

-- Worst ZIPs over the last 7 days (by avg AQI)
-- v1: CA only, depends on zip mapping being present.

with s as (
  select
    zip,
    county_name,
    ts_10m,
    aqi
  from {{ ref('silver_sensor_readings_10min') }}
  where zip is not null
    and ts_10m >= (current_timestamp - interval '7 days')
),

agg as (
  select
    zip,
    county_name,
    cast(round(avg(aqi)) as integer) as aqi_avg_7d,
    cast(max(aqi) as integer) as aqi_max_7d,
    min(ts_10m) as window_start,
    max(ts_10m) as window_end,
    current_timestamp as updated_at
  from s
  group by 1,2
),

ranked as (
  select
    *,
    row_number() over (order by aqi_avg_7d desc, aqi_max_7d desc) as rank_avg_7d
  from agg
)

select * from ranked
