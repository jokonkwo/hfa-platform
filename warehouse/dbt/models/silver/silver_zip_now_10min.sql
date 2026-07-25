{{
  config(
    materialized='incremental',
    unique_key=['zip', 'ts_utc'],
    tags=['realtime']
  )
}}

with zip_agg as (
    select
        ts_utc,
        zip,
        town,
        avg(pm25_corr)                                                    as pm25_corr,
        count(*)                                                           as sample_size,
        100.0 * sum(case when fresh_minutes <= 30 then 1 else 0 end)
              / count(*)                                                   as freshness_pct,
        sum(case when not ab_agree then 1 else 0 end)                     as disagree_count
    from {{ ref('silver_sensor_corrected_10min') }}
    {% if is_incremental() %}
    where ts_utc > (select max(ts_utc) from {{ this }})
    {% endif %}
    group by ts_utc, zip, town
)

select
    ts_utc,
    zip,
    town,
    pm25_corr,
    {{ pm25_to_aqi('pm25_corr') }} as aqi,
    sample_size,
    freshness_pct,
    case
        when freshness_pct >= 80 and disagree_count = 0 then 'good'
        when freshness_pct >= 40                        then 'warning'
        else 'poor'
    end as qc_badge
from zip_agg
