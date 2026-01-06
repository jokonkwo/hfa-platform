{{ config(materialized="table") }}

-- Hourly ZIP-level rollup computed from sensor 10-min readings.
-- v1 note: requires zip to be populated in silver_sensor_readings_10min.

with s as (
  select
    zip,
    county_name,
    date_trunc('hour', ts_10m) as hour_ts,
    aqi,
    sensor_id
  from {{ ref('silver_sensor_readings_10min') }}
  where zip is not null
),

agg as (
  select
    zip,
    county_name,
    hour_ts,
    cast(round(avg(aqi)) as integer) as aqi_avg,
    case
      when cast(round(avg(aqi)) as integer) <= 50 then 'Good'
      when cast(round(avg(aqi)) as integer) <= 100 then 'Moderate'
      when cast(round(avg(aqi)) as integer) <= 150 then 'Unhealthy for Sensitive Groups'
      when cast(round(avg(aqi)) as integer) <= 200 then 'Unhealthy'
      when cast(round(avg(aqi)) as integer) <= 300 then 'Very Unhealthy'
      else 'Hazardous'
    end as aqi_category,
    count(distinct sensor_id) as sensor_count,
    current_timestamp as updated_at
  from s
  group by 1,2,3
)

select * from agg
