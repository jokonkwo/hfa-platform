{{ config(materialized="table") }}

-- Map ZCTA ZIP polygons to CA counties using centroid containment.
-- This creates a stable ZIP -> county_name relationship for the product.

with zips as (
  select
    cast(zip as varchar) as zip,
    geometry as zip_geom
  from {{ source('raw', 'raw_zip_boundaries') }}
  where zip is not null and geometry is not null
),

counties as (
  select
    cast(name as varchar) as county_name,
    geometry as county_geom
  from {{ source('raw', 'raw_county_boundaries') }}
  where statefp = '06' and geometry is not null
),

matched as (
  select
    z.zip,
    c.county_name,
    row_number() over (
      partition by z.zip
      order by c.county_name
    ) as rn
  from zips z
  left join counties c
    on ST_Contains(c.county_geom, ST_Centroid(z.zip_geom))
)

select
  zip,
  county_name
from matched
where rn = 1
