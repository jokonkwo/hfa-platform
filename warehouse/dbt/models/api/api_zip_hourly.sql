{{ config(materialized='view') }}

select hour_utc, zip, town, pm25_corr as pm25, aqi, sample_size, coverage_bins
from {{ ref('silver_zip_hourly') }}
