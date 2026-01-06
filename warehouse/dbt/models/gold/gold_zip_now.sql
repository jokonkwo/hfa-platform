{{ config(materialized="table") }}

-- v1 note:
-- This model assumes `zip` is populated in silver_sensor_readings_10min.
-- Until dim_sensors/zip mapping is implemented, this will produce 0 rows.
-- That's fine for now; it will "turn on" as soon as zip keys are present.

with s as (
  select
    zip,
    county_name,
    ts_10m,
    aqi,
    sensor_id
  from {{ ref('silver_sensor_readings_10min') }}
  where zip is not null
),

latest_per_zip as (
  select
    zip,
    max(ts_10m) as ts_10m
  from s
  group by 1
),

zip_now as (
  select
    s.zip,
    s.county_name,
    l.ts_10m,
    -- ZIP-level AQI is the average across sensors in that zip at that ts bucket
    cast(round(avg(s.aqi)) as integer) as aqi,
    case
      when cast(round(avg(s.aqi)) as integer) <= 50 then 'Good'
      when cast(round(avg(s.aqi)) as integer) <= 100 then 'Moderate'
      when cast(round(avg(s.aqi)) as integer) <= 150 then 'Unhealthy for Sensitive Groups'
      when cast(round(avg(s.aqi)) as integer) <= 200 then 'Unhealthy'
      when cast(round(avg(s.aqi)) as integer) <= 300 then 'Very Unhealthy'
      else 'Hazardous'
    end as aqi_category,
    count(distinct s.sensor_id) as sensor_count,
    current_timestamp as updated_at
  from s
  join latest_per_zip l
    on s.zip = l.zip and s.ts_10m = l.ts_10m
  group by 1,2,3
)

select * from zip_now
