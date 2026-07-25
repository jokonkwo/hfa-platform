{{ config(materialized='table') }}

with agg as (
    select
        date_trunc('hour', ts_utc)  as hour_utc,
        zip,
        town,
        avg(pm25_corr)              as pm25_corr,
        count(*)                    as sample_size,
        count(distinct ts_utc)      as coverage_bins
    from {{ ref('silver_sensor_corrected_10min') }}
    group by 1, 2, 3
)

select
    hour_utc,
    zip,
    town,
    pm25_corr,
    {{ pm25_to_aqi('pm25_corr') }} as aqi,
    sample_size,
    coverage_bins
from agg
