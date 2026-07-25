{{ config(materialized='view') }}

select date, zip, town, pm25_mean, pm25_p95, pm25_max,
       aqi_exceed_101, aqi_exceed_151, coverage_hours
from {{ ref('silver_zip_daily') }}
