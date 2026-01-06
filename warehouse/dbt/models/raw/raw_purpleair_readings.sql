-- RAW wrapper model
-- Purpose: provide a stable ref() target and consistent column naming.

select
  sensor_id,
  ts,
  pm2_5,
  temperature_f,
  humidity,
  pressure,
  lat,
  lon,
  source,
  ingested_at
from {{ source('raw', 'raw_purpleair_readings') }}
