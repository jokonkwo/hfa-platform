{{
  config(
    materialized='incremental',
    unique_key=['sensor_index', 'ts_utc'],
    tags=['realtime']
  )
}}

-- As-of join: for each bronze reading, use the most recent panel entry on or
-- before the reading date. This handles readings on dates when the discovery
-- job did not run (e.g. Nov 2025 readings against an Oct 2025 panel).
with readings as (
    select
        ts_utc,
        sensor_index,
        last_seen,
        pm25_cf1_a,
        pm25_cf1_b,
        humidity_a,
        temperature_f
    from {{ source('bronze', 'bronze_sensor_now_raw_10min') }}
    where pm25_cf1_a is not null
      and pm25_cf1_b is not null
      and humidity_a is not null
    {% if is_incremental() %}
      and ts_utc > (select max(ts_utc) from {{ this }})
    {% endif %}
),

joined as (
    select
        r.ts_utc,
        r.sensor_index,
        r.last_seen,
        r.pm25_cf1_a,
        r.pm25_cf1_b,
        r.humidity_a,
        r.temperature_f,
        p.zip,
        p.town
    from readings r
    join {{ source('bronze', 'bronze_panel_zipmap_daily') }} p
        on  p.sensor_index = r.sensor_index
        and p.date <= cast(r.ts_utc as date)
    qualify row_number() over (
        partition by r.ts_utc, r.sensor_index
        order by p.date desc
    ) = 1
)

select
    ts_utc,
    sensor_index,
    zip,
    town,
    last_seen,
    {{ purpleair_pm25_correction('pm25_cf1_a', 'pm25_cf1_b', 'humidity_a', 'temperature_f') }} as pm25_corr,
    case
        when (pm25_cf1_a + pm25_cf1_b) / 2.0 < 0.5 then false
        when abs(pm25_cf1_a - pm25_cf1_b)
             / ((pm25_cf1_a + pm25_cf1_b) / 2.0) < 0.30 then true
        else false
    end as ab_agree,
    (epoch(ts_utc) - epoch(last_seen)) / 60.0 as fresh_minutes
from joined
