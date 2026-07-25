{{ config(materialized='table') }}

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
),

panel as (
    select
        sensor_index,
        zip,
        town,
        "date" as panel_date
    from {{ source('bronze', 'bronze_panel_zipmap_daily') }}
)

select
    r.ts_utc,
    r.sensor_index,
    p.zip,
    p.town,
    {{ purpleair_pm25_correction('r.pm25_cf1_a', 'r.pm25_cf1_b', 'r.humidity_a', 'r.temperature_f') }} as pm25_corr,
    case
        when (r.pm25_cf1_a + r.pm25_cf1_b) / 2.0 < 0.5 then false
        when abs(r.pm25_cf1_a - r.pm25_cf1_b)
             / ((r.pm25_cf1_a + r.pm25_cf1_b) / 2.0) < 0.30 then true
        else false
    end as ab_agree,
    (epoch(r.ts_utc) - epoch(r.last_seen)) / 60.0 as fresh_minutes
from readings r
inner join panel p
    on  r.sensor_index = p.sensor_index
    and cast(r.ts_utc as date) = p.panel_date
