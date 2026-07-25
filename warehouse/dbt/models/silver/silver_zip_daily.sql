{{ config(materialized='table') }}

select
    cast(hour_utc as date)                                             as date,
    zip,
    town,
    avg(pm25_corr)                                                     as pm25_mean,
    percentile_cont(0.95) within group (order by pm25_corr)           as pm25_p95,
    max(pm25_corr)                                                     as pm25_max,
    sum(case when aqi > 100 then 1 else 0 end)                        as aqi_exceed_101,
    sum(case when aqi > 150 then 1 else 0 end)                        as aqi_exceed_151,
    count(distinct hour_utc)                                           as coverage_hours
from {{ ref('silver_zip_hourly') }}
group by 1, 2, 3
