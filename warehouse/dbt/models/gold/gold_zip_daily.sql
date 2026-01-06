{{ config(materialized="table") }}

-- Daily ZIP-level rollup computed from sensor 10-min readings.
-- v1 note: requires zip to be populated in silver_sensor_readings_10min.

with s as (
  select
    zip,
    county_name,
    cast(ts_10m as date) as date,
    aqi,
    sensor_id
  from {{ ref('silver_sensor_readings_10min') }}
  where zip is not null
),

agg as (
  select
    zip,
    county_name,
    date,
    cast(round(avg(aqi)) as integer) as aqi_avg,
    cast(max(aqi) as integer) as aqi_max,
    count(distinct sensor_id) as sensor_count,
    current_timestamp as updated_at
  from s
  group by 1,2,3
)

select * from agg
