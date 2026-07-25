from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pipelines.common.http import get_json
from pipelines.common.logging_setup import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class PurpleAirReading:
    sensor_index: int
    ts_utc: int       # unix seconds (poll wall-clock time)
    last_seen: int    # unix seconds (sensor's last transmission time)
    pm25_cf1_a: float | None
    pm25_cf1_b: float | None
    humidity_a: float | None
    temperature_f: float | None


class PurpleAirClient:
    """Minimal PurpleAir client — fetches outdoor/public sensor readings."""

    BASE_URL = "https://api.purpleair.com/v1"

    def __init__(self, api_key: str):
        if not api_key:
            raise ValueError("PURPLEAIR_API_KEY is required")
        self.api_key = api_key

    def _headers(self) -> dict[str, str]:
        return {"X-API-Key": self.api_key}

    def fetch_sensors(self, sensor_ids: list[int] | None = None) -> dict[str, Any]:
        if not sensor_ids:
            raise ValueError(
                "sensor_ids must be provided for v1 ingestion. "
                "We will add search-by-region later."
            )

        fields = [
            "sensor_index",
            "last_seen",
            "pm2.5_cf_1_a",
            "pm2.5_cf_1_b",
            "humidity",
            "temperature",
        ]

        params: dict[str, Any] = {
            "fields": ",".join(fields),
            "show_only": "outdoor",
            "sensor_index": ",".join(str(sid) for sid in sensor_ids),
        }

        url = f"{self.BASE_URL}/sensors"
        logger.info("Fetching PurpleAir sensors", extra={"count": len(sensor_ids)})
        return get_json(url, headers=self._headers(), params=params)

    def parse_readings(
        self, payload: dict[str, Any], poll_ts: int
    ) -> list[PurpleAirReading]:
        """
        Convert PurpleAir API payload into normalized readings.

        poll_ts: unix seconds for the wall-clock time this poll ran (ts_utc).
        """
        data = payload.get("data")
        fields = payload.get("fields")

        if not isinstance(data, list) or not isinstance(fields, list):
            raise RuntimeError("Unexpected PurpleAir response shape: missing data/fields")

        idx = {name: i for i, name in enumerate(fields)}

        def _get(row: list[Any], key: str) -> Any:
            i = idx.get(key)
            return row[i] if i is not None else None

        readings: list[PurpleAirReading] = []
        for row in data:
            if not isinstance(row, list):
                continue

            sensor_index = _get(row, "sensor_index")
            last_seen = _get(row, "last_seen")

            if sensor_index is None or last_seen is None:
                continue

            readings.append(
                PurpleAirReading(
                    sensor_index=int(sensor_index),
                    ts_utc=poll_ts,
                    last_seen=int(last_seen),
                    pm25_cf1_a=_safe_float(_get(row, "pm2.5_cf_1_a")),
                    pm25_cf1_b=_safe_float(_get(row, "pm2.5_cf_1_b")),
                    humidity_a=_safe_float(_get(row, "humidity")),
                    temperature_f=_safe_float(_get(row, "temperature")),
                )
            )

        return readings


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None
