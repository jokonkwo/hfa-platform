{{ config(materialized="table") }}

with base as (
  select
    sensor_id,
    -- floor to 10-minute bucket (UTC)
    date_trunc('minute', ts) - (extract(minute from ts) % 10) * interval '1 minute' as ts_10m,
    pm2_5 as pm2_5_raw,
    temperature_f,
    humidity,
    pressure,
    lat,
    lon,
    ingested_at
  from {{ ref('raw_purpleair_readings') }}
),

dedup as (
  -- If multiple readings exist for the same (sensor_id, ts_10m), keep the latest ingested
  select
    *,
    row_number() over (
      partition by sensor_id, ts_10m
      order by ingested_at desc
    ) as rn
  from base
),

final as (
  select
    d.sensor_id,
    d.ts_10m,
    d.pm2_5_raw,
    {{ purpleair_pm25_correction('pm2_5_raw') }} as pm2_5_corrected,
    cast({{ pm25_to_aqi(purpleair_pm25_correction('pm2_5_raw')) }} as integer) as aqi,
    case
      when {{ pm25_to_aqi(purpleair_pm25_correction('pm2_5_raw')) }} is null then null
      when {{ pm25_to_aqi(purpleair_pm25_correction('pm2_5_raw')) }} <= 50 then 'Good'
      when {{ pm25_to_aqi(purpleair_pm25_correction('pm2_5_raw')) }} <= 100 then 'Moderate'
      when {{ pm25_to_aqi(purpleair_pm25_correction('pm2_5_raw')) }} <= 150 then 'Unhealthy for Sensitive Groups'
      when {{ pm25_to_aqi(purpleair_pm25_correction('pm2_5_raw')) }} <= 200 then 'Unhealthy'
      when {{ pm25_to_aqi(purpleair_pm25_correction('pm2_5_raw')) }} <= 300 then 'Very Unhealthy'
      else 'Hazardous'
    end as aqi_category,
    s.zip,
    s.county_name,
    current_timestamp as updated_at
  from dedup d
  left join {{ ref('dim_sensors') }} s
    on d.sensor_id = s.sensor_id
  where d.rn = 1
)

select * from final
