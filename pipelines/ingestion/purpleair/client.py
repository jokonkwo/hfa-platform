from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pipelines.common.http import get_json
from pipelines.common.logging_setup import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class PurpleAirReading:
    sensor_id: int
    ts: int  # unix seconds
    pm2_5: float | None
    temperature_f: float | None
    humidity: float | None
    pressure: float | None
    lat: float | None
    lon: float | None


class PurpleAirClient:
    """
    Minimal PurpleAir client for v1.

    Notes:
    - PurpleAir has multiple endpoints and field options.
    - We keep this client narrow: fetch outdoor/public sensor readings.
    - We store RAW "as received" and let dbt handle standardization/corrections.
    """

    BASE_URL = "https://api.purpleair.com/v1"

    def __init__(self, api_key: str):
        if not api_key:
            raise ValueError("PURPLEAIR_API_KEY is required")
        self.api_key = api_key

    def _headers(self) -> dict[str, str]:
        return {"X-API-Key": self.api_key}

    def fetch_sensors(self, sensor_ids: list[int] | None = None) -> dict[str, Any]:
        """
        Fetch sensor data.

        If sensor_ids provided, we request only those sensors.
        Otherwise, caller must define a search strategy (future).

        Returns the raw PurpleAir JSON payload.
        """
        if not sensor_ids:
            raise ValueError(
                "sensor_ids must be provided for v1 ingestion. "
                "We will add search-by-region later."
            )

        # PurpleAir supports a "sensors" endpoint with fields selection.
        # We request only the fields we need for RAW contract.
        fields = [
            "sensor_index",
            "last_seen",
            "pm2.5",
            "temperature",
            "humidity",
            "pressure",
            "latitude",
            "longitude",
        ]

        params: dict[str, Any] = {
            "fields": ",".join(fields),
            "show_only": "outdoor",  # focus on outdoor sensors where possible
            "sensor_index": ",".join(str(sid) for sid in sensor_ids),
        }

        url = f"{self.BASE_URL}/sensors"
        logger.info("Fetching PurpleAir sensors", extra={"count": len(sensor_ids)})
        return get_json(url, headers=self._headers(), params=params)

    def parse_readings(self, payload: dict[str, Any]) -> list[PurpleAirReading]:
        """
        Convert PurpleAir payload into a normalized list of readings.
        """
        data = payload.get("data")
        fields = payload.get("fields")

        if not isinstance(data, list) or not isinstance(fields, list):
            raise RuntimeError("Unexpected PurpleAir response shape: missing data/fields")

        # Map field name -> index in each data row
        idx = {name: i for i, name in enumerate(fields)}

        def _get(row: list[Any], key: str) -> Any:
            i = idx.get(key)
            if i is None:
                return None
            return row[i]

        readings: list[PurpleAirReading] = []
        for row in data:
            if not isinstance(row, list):
                continue

            sensor_id = _get(row, "sensor_index")
            last_seen = _get(row, "last_seen")

            if sensor_id is None or last_seen is None:
                continue

            readings.append(
                PurpleAirReading(
                    sensor_id=int(sensor_id),
                    ts=int(last_seen),
                    pm2_5=_safe_float(_get(row, "pm2.5")),
                    temperature_f=_safe_float(_get(row, "temperature")),
                    humidity=_safe_float(_get(row, "humidity")),
                    pressure=_safe_float(_get(row, "pressure")),
                    lat=_safe_float(_get(row, "latitude")),
                    lon=_safe_float(_get(row, "longitude")),
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
