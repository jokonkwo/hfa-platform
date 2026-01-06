{{ config(materialized="table") }}

-- Sensor dimension (silver)
-- Source of truth: pipeline-maintained RAW sensor registry table: raw.raw_sensors
--
-- This model:
-- - enforces stable typing
-- - keeps one row per sensor_id (latest updated_at wins)
-- - provides zip/county mapping for downstream joins

with base as (
  select
    cast(sensor_id as integer) as sensor_id,
    cast(name as varchar) as name,
    cast(lat as double) as lat,
    cast(lon as double) as lon,
    cast(zip as varchar) as zip,
    cast(county_name as varchar) as county_name,
    cast(is_active as boolean) as is_active,
    cast(first_seen_at as timestamp) as first_seen_at,
    cast(last_seen_at as timestamp) as last_seen_at,
    cast(updated_at as timestamp) as updated_at
  from {{ source('raw', 'raw_sensors') }}
),

dedup as (
  select
    *,
    row_number() over (
      partition by sensor_id
      order by updated_at desc
    ) as rn
  from base
)

select
  sensor_id,
  name,
  lat,
  lon,
  zip,
  county_name,
  is_active,
  first_seen_at,
  last_seen_at,
  updated_at
from dedup
where rn = 1
