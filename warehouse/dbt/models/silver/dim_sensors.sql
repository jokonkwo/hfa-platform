{{ config(materialized="table") }}

-- silver.dim_sensors
-- Source of truth: raw.raw_sensors (pipeline) + raw.raw_zip_boundaries (geo ingestion)
--
-- Mapping rule:
--   zip = the ZCTA polygon that contains the sensor point (lon, lat)
--
-- NOTE:
--   This requires DuckDB spatial functions (ST_Point, ST_Contains).
--   We'll add a dbt on-run-start hook next to LOAD spatial for dbt connections.

with sensors as (
  select
    cast(sensor_id as integer) as sensor_id,
    cast(name as varchar) as name,
    cast(lat as double) as lat,
    cast(lon as double) as lon,
    cast(is_active as boolean) as is_active,
    cast(first_seen_at as timestamp) as first_seen_at,
    cast(last_seen_at as timestamp) as last_seen_at,
    cast(updated_at as timestamp) as updated_at
  from {{ source('raw', 'raw_sensors') }}
  where lat is not null and lon is not null
),

zips as (
  select
    cast(zip as varchar) as zip,
    geometry
  from {{ source('raw', 'raw_zip_boundaries') }}
  where zip is not null and geometry is not null
),

zip_county as (
  select
    zip,
    county_name
  from {{ ref('dim_zip_county') }}
)

matches as (
  select
    s.*,
    z.zip,
    zc.county_name,
    row_number() over (
      partition by s.sensor_id
      order by z.zip
    ) as rn
  from sensors s
  left join zips z
    on ST_Contains(z.geometry, ST_Point(s.lon, s.lat))
  left join zip_county zc
    on z.zip = zc.zip
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
from matches
where rn = 1
